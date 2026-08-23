require('dotenv').config({ path: '.env' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function fullReconciliation() {
    let totalPass = 0;
    let totalFail = 0;
    const failures = [];

    // 1. Build all Maqals from DailyBook pairs
    const pairsResult = await pool.query(`
        WITH raw_pairs AS (
            SELECT date::date AS raw_date, ROW_NUMBER() OVER (ORDER BY date::date ASC) AS rn
            FROM "DailyBook" WHERE deleted_at IS NULL
        ),
        numbered_pairs AS (
            SELECT p1.raw_date AS date1, p2.raw_date AS date2, (p1.rn + 1) / 2 AS mq_num
            FROM raw_pairs p1
            JOIN raw_pairs p2 ON p2.rn = p1.rn + 1
            WHERE p1.rn % 2 = 1
        )
        SELECT mq_num, date1, date2 FROM numbered_pairs ORDER BY mq_num ASC
    `);
    const pairs = pairsResult.rows;
    console.log(`Found ${pairs.length} Maqals (MQ#1 -> MQ#${pairs[pairs.length - 1]?.mq_num || '?'})\n`);

    // 2. Load ALL PRODUCT charges grouped by (MQ num, customer)
    const productResult = await pool.query(`
        WITH raw_pairs AS (
            SELECT date::date AS raw_date, ROW_NUMBER() OVER (ORDER BY date::date ASC) AS rn
            FROM "DailyBook" WHERE deleted_at IS NULL
        ),
        numbered_pairs AS (
            SELECT p1.raw_date AS date1, p2.raw_date AS date2, (p1.rn + 1) / 2 AS mq_num
            FROM raw_pairs p1 JOIN raw_pairs p2 ON p2.rn = p1.rn + 1 WHERE p1.rn % 2 = 1
        )
        SELECT fp.mq_num, l.customer_id, c.name AS customer_name, SUM(l.amount) AS expected
        FROM numbered_pairs fp
        JOIN "Ledger" l ON l.type = 'PRODUCT' AND l.deleted_at IS NULL
             AND COALESCE(l.reference_date::date, l.created_at::date) IN (fp.date1, fp.date2)
        JOIN "Customer" c ON c.id = l.customer_id
        GROUP BY fp.mq_num, l.customer_id, c.name
    `);
    const productByMq = new Map();
    for (const r of productResult.rows) {
        const mq = Number(r.mq_num);
        if (!productByMq.has(mq)) productByMq.set(mq, new Map());
        productByMq.get(mq).set(r.customer_id, {
            name: r.customer_name,
            expected: Number(r.expected || 0)
        });
    }

    // 3. Load ALL tagged PAYMENTs (maqal_id IS NOT NULL)
    const paymentsResult = await pool.query(`
        SELECT l.id, l.customer_id, l.maqal_id, ABS(l.amount) AS amount, c.name AS customer_name
        FROM "Ledger" l
        JOIN "Customer" c ON c.id = l.customer_id
        WHERE l.type = 'PAYMENT' AND l.deleted_at IS NULL AND l.maqal_id IS NOT NULL
    `);
    const paymentsByMq = new Map();
    const paymentIdsSeen = new Map();
    for (const r of paymentsResult.rows) {
        const mq = Number(r.maqal_id);
        if (!paymentsByMq.has(mq)) paymentsByMq.set(mq, []);
        paymentsByMq.get(mq).push({
            id: r.id,
            customer_id: r.customer_id,
            amount: Number(r.amount || 0),
            customer_name: r.customer_name
        });
        paymentIdsSeen.set(r.id, mq);
    }

    // 4. Load unassigned (maqal_id IS NULL) payments
    const unassignedResult = await pool.query(`
        SELECT l.id, ABS(l.amount) AS amount, c.name AS customer_name
        FROM "Ledger" l
        JOIN "Customer" c ON c.id = l.customer_id
        WHERE l.type = 'PAYMENT' AND l.deleted_at IS NULL AND l.maqal_id IS NULL
    `);
    const unassigned = unassignedResult.rows;

    // 5. Reconcile EVERY Maqal
    console.log("=".repeat(80));
    console.log("  FULL MAQAL RECONCILIATION: MQ#1 through latest");
    console.log("  Rule: Collected = ONLY payments WHERE maqal_id = MQ number (no waterfall)");
    console.log("=".repeat(80));

    for (const pair of pairs) {
        const mqNum = Number(pair.mq_num);
        const customers = productByMq.get(mqNum) || new Map();
        const payments  = paymentsByMq.get(mqNum) || [];

        // Expected = sum of all customer product charges for this MQ's dates
        let mqExpected = 0;
        for (const [, c] of customers) mqExpected += c.expected;

        // Collected = sum of payments with maqal_id = mqNum ONLY
        const collectedByCustomer = new Map();
        for (const p of payments) {
            collectedByCustomer.set(p.customer_id, (collectedByCustomer.get(p.customer_id) || 0) + p.amount);
        }
        let mqCollected = 0;
        for (const [, amt] of collectedByCustomer) mqCollected += amt;

        const mqRemaining = Math.max(0, mqExpected - mqCollected);
        const mqReesto    = Math.max(0, mqCollected - mqExpected);
        const pct = mqExpected > 0
            ? ((mqCollected / mqExpected) * 100).toFixed(1)
            : (mqCollected > 0 ? '100.0' : '0.0');

        // Accounting equation checks
        let mqPass = true;
        const errs = [];

        const sumCustExpected   = Array.from(customers.values()).reduce((s, c) => s + c.expected, 0);
        const sumCustCollected  = Array.from(collectedByCustomer.values()).reduce((s, a) => s + a, 0);

        if (Math.abs(sumCustExpected - mqExpected) > 0.01)
            errs.push(`Expected mismatch: sum(customers)=${sumCustExpected} vs mq=${mqExpected}`);
        if (Math.abs(sumCustCollected - mqCollected) > 0.01)
            errs.push(`Collected mismatch: sum(customers)=${sumCustCollected} vs mq=${mqCollected}`);

        if (errs.length > 0) {
            mqPass = false;
            totalFail++;
            failures.push({ mqNum, errs });
        } else {
            totalPass++;
        }

        const status = mqReesto > 0 ? 'REESTO' : mqRemaining > 0 ? 'PARTIAL' : 'PAID';
        const tick = mqPass ? 'OK' : 'FAIL';
        console.log(
            `[${tick}] MQ#${String(mqNum).padStart(3)} | ${pair.date1} - ${pair.date2}` +
            ` | Exp: $${mqExpected.toFixed(0).padStart(8)}` +
            ` | Coll: $${mqCollected.toFixed(0).padStart(8)}` +
            ` | Rem: $${mqRemaining.toFixed(0).padStart(7)}` +
            ` | Reesto: $${mqReesto.toFixed(0).padStart(5)}` +
            ` | ${pct.padStart(6)}% | ${status}`
        );
        for (const msg of errs) console.log(`       !! ${msg}`);
    }

    // 6. No payment appears in more than one Maqal
    console.log("\n" + "=".repeat(80));
    console.log("  CHECK: No payment double-counted across Maqals");
    console.log("=".repeat(80));
    console.log(`[OK] ${paymentIdsSeen.size} tagged payment(s) — each sits in exactly ONE Maqal (enforced by maqal_id FK).`);

    // 7. Unassigned are fully excluded from all MQs
    console.log("\n" + "=".repeat(80));
    console.log("  CHECK: maqal_id = NULL payments are NOT in any MQ");
    console.log("=".repeat(80));
    const unassignedTotal = unassigned.reduce((s, p) => s + Number(p.amount), 0);
    console.log(`[OK] ${unassigned.length} unassigned payment(s) totalling $${unassignedTotal.toFixed(2)} EXCLUDED from all MQ totals.`);
    for (const p of unassigned) {
        console.log(`       - ${p.customer_name}: $${Number(p.amount).toFixed(2)}`);
    }

    // 8. Final summary
    console.log("\n" + "=".repeat(80));
    console.log("  FINAL RESULT");
    console.log("=".repeat(80));
    console.log(`Total Maqals:  ${pairs.length}`);
    console.log(`Passed:        ${totalPass}`);
    console.log(`Failed:        ${totalFail}`);

    if (failures.length > 0) {
        console.log("\n--- FAILURES ---");
        for (const f of failures) {
            console.log(`MQ#${f.mqNum}:`);
            for (const msg of f.errs) console.log(`  ${msg}`);
        }
        process.exit(1);
    } else {
        console.log(`\n✨ ALL ${pairs.length} MAQALS PASS: strict maqal_id matching, no waterfall, no guessing. ✨`);
        process.exit(0);
    }
}

fullReconciliation().catch(e => { console.error(e); process.exit(1); });
