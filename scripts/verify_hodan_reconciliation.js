/**
 * scripts/verify_hodan_reconciliation.js
 *
 * Verifies Hodan's (and all customers') customer profile header vs Maqal history.
 *
 * KEY INSIGHT:
 * - The customer header shows `summary.currentBalance` = the last `new_debt` value in the ledger.
 *   This is the RUNNING CUMULATIVE DEBT after ALL transactions (charges minus payments).
 * - Each Maqal card in the UI shows `receipt.closingBalance` = the running debt AFTER that Maqal's
 *   block of transactions (not the Maqal charge itself).
 * - The displayed "$695, $310, $310, $167" are NOT charges. They are snapshots of the running balance.
 *
 * ACCOUNTING IDENTITY:
 *   Header (currentBalance) = the closingBalance of the LATEST Maqal receipt (the most recent entry's new_debt)
 *   For the whole customer: SUM(all charges) - SUM(all payments) = currentBalance
 */

require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const pool = new Pool({ 
    connectionString: "postgresql://postgres.omjmjihinxbtilnirsco:ki6pw8TKnb4bqrjC@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
    ssl: { rejectUnauthorized: false } 
});

const MAQAL_PAIRS_CTE = `
    WITH past_dates AS (
        SELECT DISTINCT date::date AS db_date
        FROM "DailyBook"
        WHERE deleted_at IS NULL
    ),
    numbered_dates AS (
        SELECT db_date,
               ROW_NUMBER() OVER (ORDER BY db_date ASC) as rn
        FROM past_dates
    ),
    pairs AS (
        SELECT n1.db_date::date AS date1, n2.db_date::date AS date2,
               ((n1.rn + 1) / 2)::int AS mq_num
        FROM numbered_dates n1
        JOIN numbered_dates n2 ON n2.rn = n1.rn + 1
        WHERE n1.rn % 2 = 1
    )
`;

async function reconcileCustomer(client, customer, allPairs) {
    const cid = customer.id;

    // Fetch ALL ledger rows for this customer (not deleted)
    const { rows: txns } = await client.query(`
        SELECT id, type, amount, kg, price_per_kg, reference_date, created_at,
               maqal_id, receipt_id, previous_debt, new_debt, note
        FROM "Ledger"
        WHERE customer_id = $1 AND deleted_at IS NULL
        ORDER BY created_at ASC, id ASC
    `, [cid]);

    if (txns.length === 0) return null;

    // The authoritative header value = new_debt of the most recently created entry
    const latestTxn = [...txns].sort((a, b) => {
        const ta = new Date(a.created_at).getTime();
        const tb = new Date(b.created_at).getTime();
        if (ta !== tb) return tb - ta;
        return a.id < b.id ? 1 : -1;
    })[0];
    const headerBalance = Number(latestTxn.new_debt);

    // Calculate from raw numbers: SUM(PRODUCT amounts) - SUM(PAYMENT amounts)
    const totalCharged = txns.filter(t => t.type === 'PRODUCT').reduce((s, t) => s + Number(t.amount), 0);
    const totalPaid    = txns.filter(t => t.type === 'PAYMENT').reduce((s, t) => s + Number(t.amount), 0);
    const totalAdj     = txns.filter(t => t.type === 'ADJUSTMENT').reduce((s, t) => s + Number(t.amount), 0);
    const computedBalance = totalCharged + totalAdj - totalPaid;

    // Build a lookup: date string -> mq_num
    const dateToMq = new Map();
    for (const p of allPairs) {
        dateToMq.set(p.date1, p.mq_num);
        dateToMq.set(p.date2, p.mq_num);
    }

    // Build per-Maqal buckets using maqal_id first, then date cross-reference
    const mqBuckets = new Map(); // mq_num -> { products:[], payments:[], adjustments:[] }

    // Products
    for (const t of txns.filter(t => t.type === 'PRODUCT')) {
        let mqNum = t.maqal_id != null ? Number(t.maqal_id) : null;
        if (mqNum == null) {
            const dateStr = t.reference_date ? String(t.reference_date).split('T')[0] : null;
            if (dateStr) mqNum = dateToMq.get(dateStr) ?? null;
        }
        if (mqNum == null) mqNum = -1; // orphan
        if (!mqBuckets.has(mqNum)) mqBuckets.set(mqNum, { products: [], payments: [], adjustments: [] });
        mqBuckets.get(mqNum).products.push(t);
    }

    // Payments — attribute by maqal_id on the payment row
    for (const t of txns.filter(t => t.type === 'PAYMENT')) {
        let mqNum = t.maqal_id != null ? Number(t.maqal_id) : null;
        // If no maqal_id on the payment, attribute to the first unpaid Maqal (oldest-first waterfall)
        if (mqNum == null) {
            // Find first bucket where products exist and aren't fully paid
            let found = false;
            for (const [mq, bucket] of [...mqBuckets.entries()].sort((a, b) => a[0] - b[0])) {
                const exp = bucket.products.reduce((s, p) => s + Number(p.amount), 0);
                const paid = bucket.payments.reduce((s, p) => s + Number(p.amount), 0);
                if (exp > paid) {
                    mqNum = mq;
                    found = true;
                    break;
                }
            }
            if (!found) mqNum = mqBuckets.size > 0 ? Math.max(...mqBuckets.keys()) : -1;
        }
        if (!mqBuckets.has(mqNum)) mqBuckets.set(mqNum, { products: [], payments: [], adjustments: [] });
        mqBuckets.get(mqNum).payments.push(t);
    }

    // Adjustments
    for (const t of txns.filter(t => t.type === 'ADJUSTMENT')) {
        let mqNum = t.maqal_id != null ? Number(t.maqal_id) : null;
        if (mqNum == null) mqNum = mqBuckets.size > 0 ? Math.max(...mqBuckets.keys()) : -1;
        if (!mqBuckets.has(mqNum)) mqBuckets.set(mqNum, { products: [], payments: [], adjustments: [] });
        mqBuckets.get(mqNum).adjustments.push(t);
    }

    // Build per-Maqal summary
    const mqRows = [];
    let sumExpected = 0, sumCollected = 0, sumDebt = 0, sumDheeraad = 0, sumNet = 0;

    const sortedMqs = [...mqBuckets.keys()].sort((a, b) => a - b);
    for (const mqNum of sortedMqs) {
        const bucket = mqBuckets.get(mqNum);
        const expected = Math.round(bucket.products.reduce((s, t) => s + Number(t.amount), 0));
        const collected = Math.round(bucket.payments.reduce((s, t) => s + Number(t.amount), 0));
        const adjTotal = Math.round(bucket.adjustments.reduce((s, t) => s + Number(t.amount), 0));
        const net = expected + adjTotal - collected;
        const debt = Math.max(0, net);
        const dheeraad = Math.max(0, collected - expected - adjTotal);

        sumExpected  += expected;
        sumCollected += collected;
        sumDebt      += debt;
        sumDheeraad  += dheeraad;
        sumNet       += net;

        const pair = allPairs.find(p => p.mq_num === mqNum);
        mqRows.push({ mqNum, expected, collected, adjTotal, debt, dheeraad, net, pair });
    }

    return {
        customer,
        headerBalance,
        computedBalance: Math.round(computedBalance * 100) / 100,
        totalCharged: Math.round(totalCharged * 100) / 100,
        totalPaid: Math.round(totalPaid * 100) / 100,
        totalAdj: Math.round(totalAdj * 100) / 100,
        mqRows,
        sumExpected,
        sumCollected,
        sumNet,
        txns
    };
}

async function main() {
    const client = await pool.connect();
    try {
        // 1. Fetch all authoritative Maqal pairs
        const { rows: allPairs } = await client.query(`
            ${MAQAL_PAIRS_CTE}
            SELECT mq_num, date1::text as date1, date2::text as date2
            FROM pairs ORDER BY mq_num ASC
        `);

        // 2. Find Hodan specifically first
        const { rows: hodanRows } = await client.query(`
            SELECT id, name, customer_code FROM "Customer"
            WHERE LOWER(name) LIKE '%hodan%' AND deleted_at IS NULL
            LIMIT 5
        `);

        if (hodanRows.length === 0) {
            console.log('⚠️  No customer named Hodan found.');
        } else {
            console.log(`\n${'═'.repeat(72)}`);
            console.log('  HODAN MAQAL RECONCILIATION');
            console.log(`${'═'.repeat(72)}\n`);

            for (const hodan of hodanRows) {
                const result = await reconcileCustomer(client, hodan, allPairs);
                if (!result) { console.log(`  ${hodan.name}: No transactions.`); continue; }

                console.log(`Customer: ${hodan.name} [${hodan.customer_code}]  ID: ${hodan.id}`);
                console.log(`${'─'.repeat(72)}`);

                // Per-Maqal table
                console.log(`  ${'MQ'.padEnd(6)} ${'Date Range'.padEnd(24)} ${'Expected'.padStart(10)} ${'Collected'.padStart(10)} ${'Debt'.padStart(10)} ${'Dheeraad'.padStart(10)} ${'Net'.padStart(10)}`);
                console.log(`  ${'─'.repeat(84)}`);
                for (const row of result.mqRows) {
                    const label = row.mqNum === -1 ? 'Orphan' : `MQ#${row.mqNum}`;
                    const dateRange = row.pair ? `${row.pair.date1} – ${row.pair.date2}` : 'Unknown';
                    console.log(`  ${label.padEnd(6)} ${dateRange.padEnd(24)} ${('$'+row.expected).padStart(10)} ${('$'+row.collected).padStart(10)} ${('$'+row.debt).padStart(10)} ${('$'+row.dheeraad).padStart(10)} ${('$'+row.net).padStart(10)}`);
                }
                console.log(`  ${'─'.repeat(84)}`);
                console.log(`  ${'TOTAL'.padEnd(30)} ${('$'+result.sumExpected).padStart(10)} ${('$'+result.sumCollected).padStart(10)} ${('$'+result.sumDebt).padStart(10)} ${('$'+result.sumDheeraad).padStart(10)} ${('$'+result.sumNet).padStart(10)}`);

                console.log(`\n  ─── HEADER RECONCILIATION ─────────────────────────────────────────`);
                console.log(`  Header shows (currentBalance / Lacagta Guud):  $${result.headerBalance}`);
                console.log(`  Computed from raw: SUM(charges) - SUM(payments): $${result.computedBalance}`);
                console.log(`    = SUM charges $${result.totalCharged} + SUM adj $${result.totalAdj} - SUM payments $${result.totalPaid}`);
                console.log(`  SUM of per-Maqal Net balances:                  $${result.sumNet}`);

                const headerMatchesComputed = Math.abs(result.headerBalance - result.computedBalance) < 0.01;
                const computedMatchesMqSum  = Math.abs(result.computedBalance - result.sumNet) < 1; // allow rounding

                console.log(`\n  IDENTITY CHECK 1 — Header === Raw Computed:  ${headerMatchesComputed ? '✅ PASS' : '❌ FAIL (DISCREPANCY!)'}`);
                console.log(`  IDENTITY CHECK 2 — Raw Computed === MQ Sum:  ${computedMatchesMqSum ? '✅ PASS' : '❌ FAIL'}`);

                // Explain what the per-Maqal card amounts represent
                console.log(`\n  ─── WHAT THE UI SHOWS PER MAQAL CARD ──────────────────────────────`);
                console.log(`  NOTE: Each Maqal card in the customer profile shows 'closingBalance'`);
                console.log(`  = the RUNNING CUMULATIVE DEBT after that Maqal's block.`);
                console.log(`  These are NOT the Maqal charge amounts. They are snapshots of debt.`);
                let runningDebt = 0;
                for (const row of result.mqRows) {
                    const label = row.mqNum === -1 ? 'Orphan' : `MQ#${row.mqNum}`;
                    runningDebt += row.expected + row.adjTotal - row.collected;
                    console.log(`  ${label}: closingBalance = $${Math.round(runningDebt)} (charge=$${row.expected}, paid=$${row.collected}, adj=$${row.adjTotal})`);
                }
                console.log(`  Final closingBalance (= Header): $${Math.round(runningDebt)}`);

                console.log(`\n`);
            }
        }

        // 3. Run reconciliation for ALL customers
        console.log(`\n${'═'.repeat(72)}`);
        console.log('  ALL CUSTOMERS RECONCILIATION');
        console.log(`${'═'.repeat(72)}\n`);

        const { rows: allCustomers } = await client.query(`
            SELECT id, name, customer_code FROM "Customer"
            WHERE deleted_at IS NULL ORDER BY name ASC
        `);

        let passed = 0, failed = 0, skipped = 0;
        const failures = [];

        for (const cust of allCustomers) {
            const result = await reconcileCustomer(client, cust, allPairs);
            if (!result) { skipped++; continue; }

            const headerMatchesComputed = Math.abs(result.headerBalance - result.computedBalance) < 0.01;
            if (headerMatchesComputed) {
                passed++;
            } else {
                failed++;
                failures.push({
                    name: cust.name,
                    code: cust.customer_code,
                    header: result.headerBalance,
                    computed: result.computedBalance,
                    diff: Math.abs(result.headerBalance - result.computedBalance)
                });
            }
        }

        if (failures.length > 0) {
            console.log(`❌ FAILURES (${failures.length}):`);
            for (const f of failures.sort((a, b) => b.diff - a.diff)) {
                console.log(`  ${f.name} [${f.code}]: header=$${f.header} computed=$${f.computed} (diff=$${f.diff.toFixed(2)})`);
            }
        }

        console.log(`\n${'═'.repeat(72)}`);
        console.log(`  SUMMARY: ${passed} passed, ${failed} failed, ${skipped} skipped (no txns)`);
        console.log(`  Total customers: ${allCustomers.length}`);
        if (failed === 0) {
            console.log(`  ✅ ALL CUSTOMERS PASS: Header = Raw Computed Balance`);
        } else {
            console.log(`  ❌ ${failed} customers have discrepancies between header and raw computed balance.`);
            console.log(`     This means their new_debt chain is out of sync and needs recalculation.`);
        }
        console.log(`${'═'.repeat(72)}\n`);

    } finally {
        client.release();
        await pool.end();
    }
}

main().catch(e => { console.error(e); process.exit(1); });
