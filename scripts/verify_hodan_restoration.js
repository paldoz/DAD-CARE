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

async function main() {
    const client = await pool.connect();
    try {
        console.log("===============================================================================");
        console.log("             HODAN (CUSTOMER 47) — COMPLETE DIAGNOSTIC & AUDIT REPORT          ");
        console.log("===============================================================================\n");

        const { rows: custRows } = await client.query(`
            SELECT id, name, customer_code, created_at 
            FROM "Customer" 
            WHERE customer_code = '47' OR LOWER(name) LIKE '%hodan%'
        `);

        if (custRows.length === 0) {
            console.log("❌ Customer Hodan not found.");
            return;
        }

        const customer = custRows[0];
        console.log(`Customer Name: ${customer.name}`);
        console.log(`Customer Code: ${customer.customer_code}`);
        console.log(`Customer ID:   ${customer.id}\n`);

        // 1. Authoritative pairs
        const { rows: allPairs } = await client.query(`
            ${MAQAL_PAIRS_CTE}
            SELECT mq_num, date1::text as date1, date2::text as date2
            FROM pairs ORDER BY mq_num ASC
        `);

        // 2. Fetch all Ledger rows
        const { rows: allTxns } = await client.query(`
            SELECT id, type, amount, kg, price_per_kg, reference_date, created_at, deleted_at,
                   maqal_id, receipt_id, previous_debt, new_debt, note, edit_count
            FROM "Ledger"
            WHERE customer_id = $1
            ORDER BY created_at ASC, id ASC
        `, [customer.id]);

        const activeTxns = allTxns.filter(t => !t.deleted_at);
        const deletedTxns = allTxns.filter(t => t.deleted_at);

        console.log(`Total Transactions Recorded: ${allTxns.length}`);
        console.log(`Active Transactions:         ${activeTxns.length}`);
        console.log(`Deleted (Undone) Txns:       ${deletedTxns.length}\n`);

        // 3. Diagnostic of Latest 10 Transactions
        console.log("-------------------------------------------------------------------------------");
        console.log("                      LATEST 10 TRANSACTIONS (CHRONOLOGICAL)                   ");
        console.log("-------------------------------------------------------------------------------");
        const latestTxns = [...allTxns].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10);
        console.table(latestTxns.map(t => ({
            id: t.id.substring(0, 8) + '...',
            type: t.type,
            amount: '$' + Number(t.amount),
            kg: t.kg || '-',
            price: t.price_per_kg || '-',
            ref_date: t.reference_date ? String(t.reference_date).split('T')[0] : 'null',
            created_at: new Date(t.created_at).toISOString(),
            status: t.deleted_at ? 'DELETED' : 'ACTIVE',
            maqal_id: t.maqal_id,
            new_debt: '$' + Number(t.new_debt)
        })));

        // 4. Audit Trail
        console.log("\n-------------------------------------------------------------------------------");
        console.log("                            RECENT AUDIT LOG ACTIONS                           ");
        console.log("-------------------------------------------------------------------------------");
        const { rows: audits } = await client.query(`
            SELECT id, action, details, created_at
            FROM "AuditLog"
            WHERE details LIKE '%' || $1 || '%' OR details LIKE '%' || $2 || '%'
            ORDER BY created_at DESC
            LIMIT 10
        `, [customer.id, customer.name]);
        console.table(audits.map(a => ({
            action: a.action,
            details: a.details,
            created_at: new Date(a.created_at).toISOString()
        })));

        // 5. Per-Maqal Breakdown
        console.log("\n-------------------------------------------------------------------------------");
        console.log("                     AUTHORITATIVE MAQAL-BY-MAQAL RECONCILIATION               ");
        console.log("-------------------------------------------------------------------------------");

        const dateToMq = new Map();
        for (const p of allPairs) {
            dateToMq.set(p.date1, p.mq_num);
            dateToMq.set(p.date2, p.mq_num);
        }

        const mqBuckets = new Map();
        for (const t of activeTxns) {
            let mq = t.maqal_id != null ? Number(t.maqal_id) : null;
            if (mq == null && t.reference_date) {
                const dStr = String(t.reference_date).split('T')[0];
                mq = dateToMq.get(dStr) ?? null;
            }
            if (mq == null) mq = 999; // unassigned
            if (!mqBuckets.has(mq)) mqBuckets.set(mq, { products: [], payments: [], adjustments: [] });
            if (t.type === 'PRODUCT') mqBuckets.get(mq).products.push(t);
            else if (t.type === 'PAYMENT') mqBuckets.get(mq).payments.push(t);
            else if (t.type === 'ADJUSTMENT') mqBuckets.get(mq).adjustments.push(t);
        }

        let totalExpected = 0;
        let totalCollected = 0;
        let totalAdjustments = 0;
        let runningDebt = 0;

        const tableRows = [];
        for (const [mqNum, bucket] of [...mqBuckets.entries()].sort((a, b) => a[0] - b[0])) {
            const exp = bucket.products.reduce((s, p) => s + Number(p.amount), 0);
            const col = bucket.payments.reduce((s, p) => s + Number(p.amount), 0);
            const adj = bucket.adjustments.reduce((s, p) => s + Number(p.amount), 0);
            const net = exp + adj - col;
            const debt = Math.max(0, net);
            const overpayment = Math.max(0, col - exp - adj);

            totalExpected += exp;
            totalCollected += col;
            totalAdjustments += adj;
            runningDebt += net;

            const pair = allPairs.find(p => p.mq_num === mqNum);
            const dateStr = pair ? `${pair.date1} – ${pair.date2}` : 'Unknown';

            tableRows.push({
                mq: mqNum === 999 ? 'Other' : `MQ#${mqNum}`,
                dates: dateStr,
                expected: '$' + exp,
                collected: '$' + col,
                adj: '$' + adj,
                debt: '$' + debt,
                overpayment: '$' + overpayment,
                net: '$' + net,
                closing_balance: '$' + runningDebt
            });
        }

        console.table(tableRows);

        console.log("-------------------------------------------------------------------------------");
        console.log("                         MATHEMATICAL ACCOUNTING IDENTITY                      ");
        console.log("-------------------------------------------------------------------------------");
        const totalCharged = activeTxns.filter(t => t.type === 'PRODUCT').reduce((s, t) => s + Number(t.amount), 0);
        const totalPaid = activeTxns.filter(t => t.type === 'PAYMENT').reduce((s, t) => s + Number(t.amount), 0);
        const totalAdj = activeTxns.filter(t => t.type === 'ADJUSTMENT').reduce((s, t) => s + Number(t.amount), 0);
        const currentBalance = totalCharged + totalAdj - totalPaid;

        const latestActiveTxn = activeTxns[activeTxns.length - 1];

        console.log(`SUM(All Products):      $${totalCharged}`);
        console.log(`SUM(All Adjustments):   +$${totalAdj}`);
        console.log(`SUM(All Payments):      -$${totalPaid}`);
        console.log(`Raw Net Balance:        $${currentBalance}`);
        console.log(`Header Total (DB):      $${Number(latestActiveTxn.new_debt)}`);
        console.log(`Cumulative MQ Balance:  $${runningDebt}`);

        const exactMatch = (currentBalance === Number(latestActiveTxn.new_debt)) && (currentBalance === runningDebt);
        console.log(`\nACCOUNTING INTEGRITY:   ${exactMatch ? '✅ 100% PERFECT MATCH' : '❌ MISMATCH'}`);
        console.log("===============================================================================\n");

    } finally {
        client.release();
        await pool.end();
    }
}

main().catch(console.error);
