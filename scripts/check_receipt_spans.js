require('dotenv').config({ path: '.env' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
    const res = await pool.query(`
        WITH raw_pairs AS (
            SELECT date::date AS raw_date, ROW_NUMBER() OVER (ORDER BY date::date ASC) AS rn
            FROM "DailyBook" WHERE deleted_at IS NULL
        ),
        numbered_pairs AS (
            SELECT p1.raw_date AS date1, p2.raw_date AS date2, (p1.rn + 1) / 2 AS mq_num
            FROM raw_pairs p1
            JOIN raw_pairs p2 ON p2.rn = p1.rn + 1
            WHERE p1.rn % 2 = 1
        ),
        product_mqs AS (
            SELECT 
                l.id as product_id,
                l.receipt_id,
                COALESCE(l.reference_date::date, l.created_at::date) as date,
                np.mq_num
            FROM "Ledger" l
            JOIN numbered_pairs np ON COALESCE(l.reference_date::date, l.created_at::date) IN (np.date1, np.date2)
            WHERE l.type = 'PRODUCT' AND l.deleted_at IS NULL AND l.receipt_id IS NOT NULL
        ),
        receipt_mq_counts AS (
            SELECT 
                receipt_id, 
                COUNT(DISTINCT mq_num) as num_mqs,
                ARRAY_AGG(DISTINCT mq_num) as mqs,
                MIN(mq_num) as min_mq
            FROM product_mqs
            GROUP BY receipt_id
        )
        SELECT * FROM receipt_mq_counts WHERE num_mqs > 1;
    `);
    console.log(`Receipts spanning multiple Maqals: ${res.rows.length}`);
    if (res.rows.length > 0) {
        console.log(res.rows);
    }
    process.exit(0);
}
check();
