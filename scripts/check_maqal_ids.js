const pool = require('./lib/db').default;

async function checkMaqalIds() {
    try {
        console.log("=== 1. DAILY BOOK DATES & PAIRS ===");
        const pairsResult = await pool.query(`
            WITH past_dates AS (
                SELECT DISTINCT date::date AS db_date FROM "DailyBook" WHERE deleted_at IS NULL
            ),
            numbered_dates AS (
                SELECT db_date, ROW_NUMBER() OVER (ORDER BY db_date DESC) AS rn FROM past_dates
            ),
            pairs AS (
                SELECT n2.db_date AS date1, n1.db_date AS date2
                FROM numbered_dates n1
                JOIN numbered_dates n2 ON n1.rn = n2.rn - 1
                WHERE n1.rn % 2 = 1
            )
            SELECT ROW_NUMBER() OVER (ORDER BY date2 ASC) AS mq_num, date1::text, date2::text
            FROM pairs ORDER BY mq_num ASC
        `);
        console.table(pairsResult.rows);

        console.log("\n=== 2. DISTINCT maqal_id IN LEDGER BY TYPE ===");
        const mqLedger = await pool.query(`
            SELECT type, maqal_id, COUNT(*), MIN(reference_date::text) as min_date, MAX(reference_date::text) as max_date
            FROM "Ledger"
            WHERE deleted_at IS NULL
            GROUP BY type, maqal_id
            ORDER BY maqal_id ASC NULLS FIRST, type
        `);
        console.table(mqLedger.rows);

        console.log("\n=== 3. RECENT 10 PAYMENTS WITH MAQAL INFO ===");
        const recentPay = await pool.query(`
            SELECT l.id, l.created_at, l.reference_date, l.amount, l.maqal_id, l.receipt_id, c.name, c.customer_code
            FROM "Ledger" l
            JOIN "Customer" c ON c.id = l.customer_id
            WHERE l.type = 'PAYMENT' AND l.deleted_at IS NULL
            ORDER BY l.created_at DESC
            LIMIT 10
        `);
        console.table(recentPay.rows);

        console.log("\n=== 4. PAYMENTS FOR MQ#1 (Jul 14 - 15) ===");
        const mq1Prods = await pool.query(`
            SELECT DISTINCT l.customer_id, l.maqal_id, l.receipt_id, l.reference_date::text, c.name
            FROM "Ledger" l
            JOIN "Customer" c ON c.id = l.customer_id
            WHERE l.type = 'PRODUCT' AND l.deleted_at IS NULL
              AND l.reference_date::date IN ('2026-07-14', '2026-07-15')
        `);
        console.log("MQ#1 Products distinct count:", mq1Prods.rows.length);
        console.log("Sample MQ#1 Products:", mq1Prods.rows.slice(0, 5));

        const mq1MaqalIds = Array.from(new Set(mq1Prods.rows.map(r => r.maqal_id).filter(x => x != null)));
        const mq1ReceiptIds = Array.from(new Set(mq1Prods.rows.map(r => r.receipt_id).filter(x => x != null)));
        console.log("MQ#1 distinct product maqal_ids:", mq1MaqalIds);
        console.log("MQ#1 distinct product receipt_ids sample:", mq1ReceiptIds.slice(0, 5));

        const mq1Payments = await pool.query(`
            SELECT l.id, l.amount, l.created_at, l.reference_date, l.maqal_id, l.receipt_id, c.name
            FROM "Ledger" l
            JOIN "Customer" c ON c.id = l.customer_id
            WHERE l.type = 'PAYMENT' AND l.deleted_at IS NULL
              AND (l.maqal_id = ANY($1) OR l.receipt_id = ANY($2))
        `, [mq1MaqalIds, mq1ReceiptIds]);
        console.log(`MQ#1 matched payments count: ${mq1Payments.rows.length}`);
        console.table(mq1Payments.rows.slice(0, 10));

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

checkMaqalIds();
