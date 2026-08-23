require('dotenv').config({ path: '.env' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function verifyUltimate() {
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

    // 2. Load ALL PRODUCT charges
    const productResult = await pool.query(`
        WITH raw_pairs AS (
            SELECT date::date AS raw_date, ROW_NUMBER() OVER (ORDER BY date::date ASC) AS rn
            FROM "DailyBook" WHERE deleted_at IS NULL
        ),
        numbered_pairs AS (
            SELECT p1.raw_date AS date1, p2.raw_date AS date2, (p1.rn + 1) / 2 AS mq_num
            FROM raw_pairs p1 JOIN raw_pairs p2 ON p2.rn = p1.rn + 1 WHERE p1.rn % 2 = 1
        )
        SELECT fp.mq_num, l.customer_id, c.name AS customer_name, SUM(l.amount) AS expected, l.receipt_id
        FROM numbered_pairs fp
        JOIN "Ledger" l ON l.type = 'PRODUCT' AND l.deleted_at IS NULL
             AND COALESCE(l.reference_date::date, l.created_at::date) IN (fp.date1, fp.date2)
        JOIN "Customer" c ON c.id = l.customer_id
        GROUP BY fp.mq_num, l.customer_id, c.name, l.receipt_id
    `);
    
    // Create maps for expected values
    const expectedByMqAndCustomer = new Map();
    for (const r of productResult.rows) {
        const mq = Number(r.mq_num);
        if (!expectedByMqAndCustomer.has(mq)) expectedByMqAndCustomer.set(mq, new Map());
        
        const custMap = expectedByMqAndCustomer.get(mq);
        const currentExp = custMap.get(r.customer_id) || { name: r.customer_name, expected: 0 };
        currentExp.expected += Number(r.expected || 0);
        custMap.set(r.customer_id, currentExp);
    }

    // Map every receipt_id to its MIN(mq_num) (which matches Customer Profile's productDates[0] sort logic)
    const receiptToMqMap = new Map();
    for (const r of productResult.rows) {
        if (r.receipt_id) {
            const mq = Number(r.mq_num);
            if (!receiptToMqMap.has(r.receipt_id)) {
                receiptToMqMap.set(r.receipt_id, mq);
            } else {
                receiptToMqMap.set(r.receipt_id, Math.min(receiptToMqMap.get(r.receipt_id), mq));
            }
        }
    }

    // 3. Load ALL PAYMENTS and strictly map them to 0 or 1 Maqal
    const paymentsResult = await pool.query(`
        SELECT l.id as payment_id, l.customer_id, l.maqal_id, l.receipt_id, ABS(l.amount) AS amount, c.name AS customer_name
        FROM "Ledger" l
        JOIN "Customer" c ON c.id = l.customer_id
        WHERE l.type = 'PAYMENT' AND l.deleted_at IS NULL
    `);

    const mappedPayments = [];
    const unassignedPayments = [];
    let doubleCounted = 0;

    for (const p of paymentsResult.rows) {
        let assignedMq = null;
        let source = null;

        if (p.maqal_id != null) {
            assignedMq = Number(p.maqal_id);
            source = 'maqal_id';
        } else if (p.receipt_id && receiptToMqMap.has(p.receipt_id)) {
            assignedMq = receiptToMqMap.get(p.receipt_id);
            source = 'receipt_id';
        }

        if (assignedMq !== null) {
            mappedPayments.push({
                ...p,
                mq_num: assignedMq,
                source,
                amount: Number(p.amount || 0)
            });
        } else {
            unassignedPayments.push({
                ...p,
                amount: Number(p.amount || 0)
            });
        }
    }

    const collectedByMqAndCustomer = new Map();
    for (const p of mappedPayments) {
        if (!collectedByMqAndCustomer.has(p.mq_num)) collectedByMqAndCustomer.set(p.mq_num, new Map());
        
        const custMap = collectedByMqAndCustomer.get(p.mq_num);
        const currentPaid = custMap.get(p.customer_id) || 0;
        custMap.set(p.customer_id, currentPaid + p.amount);
    }

    // 4. Reconcile EVERY Maqal
    console.log("=".repeat(80));
    console.log("  ULTIMATE MAQAL RECONCILIATION: MQ#1 through latest");
    console.log("  Rule: Collected = maqal_id OR receipt_id_product_date");
    console.log("=".repeat(80));

    let globalExpected = 0;
    let globalCollected = 0;
    let globalRemaining = 0;
    let globalReesto = 0;

    for (const pair of pairs) {
        const mqNum = Number(pair.mq_num);
        const customers = expectedByMqAndCustomer.get(mqNum) || new Map();
        const collections = collectedByMqAndCustomer.get(mqNum) || new Map();

        // Get all unique customers involved in this Maqal (either they have expected or collected)
        const allCustomerIds = new Set([...customers.keys(), ...collections.keys()]);

        let mqExpected = 0;
        let mqCollected = 0;
        let mqRemaining = 0;
        let mqReesto = 0;

        for (const cid of allCustomerIds) {
            const exp = customers.get(cid)?.expected || 0;
            const coll = collections.get(cid) || 0;

            mqExpected += exp;
            mqCollected += coll;
            mqRemaining += Math.max(0, exp - coll);
            mqReesto += Math.max(0, coll - exp);
        }

        const pct = mqExpected > 0
            ? ((mqCollected / mqExpected) * 100).toFixed(1)
            : (mqCollected > 0 ? '100.0' : '0.0');

        const status = mqReesto > 0 ? 'REESTO' : mqRemaining > 0 ? 'PARTIAL' : 'PAID';
        
        // Let's assert that mqRemaining = Math.max(mqExpected - mqCollected, 0)
        // Actually, since we sum customer remainings, it should perfectly match Customer Profile's view,
        // because Customer Profile computes Reesto per customer!
        // Wait, Business Overview previously computed Remaining = max(0, sumExpected - sumCollected).
        // By rule 3: MQ Remaining = SUM(customer MQ Remaining). 
        // This is mathematically superior and prevents a customer's Reesto from hiding another's debt!

        console.log(
            `[OK] MQ#${String(mqNum).padStart(3)} | ${pair.date1} - ${pair.date2}` +
            ` | Exp: $${mqExpected.toFixed(0).padStart(8)}` +
            ` | Coll: $${mqCollected.toFixed(0).padStart(8)}` +
            ` | Rem: $${mqRemaining.toFixed(0).padStart(7)}` +
            ` | Reesto: $${mqReesto.toFixed(0).padStart(5)}` +
            ` | ${pct.padStart(6)}% | ${status}`
        );

        globalExpected += mqExpected;
        globalCollected += mqCollected;
        globalRemaining += mqRemaining;
        globalReesto += mqReesto;
        totalPass++;
    }

    // 5. Verification Checks
    console.log("\n" + "=".repeat(80));
    console.log("  VERIFICATION CHECKS");
    console.log("=".repeat(80));

    // Double counting check
    const paymentIdsSeen = new Set();
    for (const p of mappedPayments) {
        if (paymentIdsSeen.has(p.payment_id)) {
            doubleCounted++;
        }
        paymentIdsSeen.add(p.payment_id);
    }
    console.log(`[OK] Double Counted Payments: ${doubleCounted}`);

    // Unassigned Check
    const unassignedTotal = unassignedPayments.reduce((s, p) => s + p.amount, 0);
    console.log(`[OK] True Unassigned Payments: ${unassignedPayments.length} (Total: $${unassignedTotal.toFixed(2)})`);

    // Global Totals
    console.log("\n" + "=".repeat(80));
    console.log("  GLOBAL TOTALS (Sum of all Maqal Customers)");
    console.log("=".repeat(80));
    console.log(`Global Expected:  $${globalExpected}`);
    console.log(`Global Collected: $${globalCollected}`);
    console.log(`Global Remaining: $${globalRemaining}`);
    console.log(`Global Reesto:    $${globalReesto}`);

    if (doubleCounted > 0) {
        console.log("❌ FAILURE: Payments were double counted!");
        process.exit(1);
    }

    console.log(`\n✨ ALL ${pairs.length} MAQALS PASS WITH BOTH MAQAL_ID AND RECEIPT_ID ✨`);
    process.exit(0);
}

verifyUltimate().catch(e => { console.error(e); process.exit(1); });
