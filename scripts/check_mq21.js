const { Pool } = require('pg');
require('dotenv').config({ path: '.env' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function run() {
    const res = await pool.query(`
        WITH
        past_dates AS (SELECT DISTINCT date::date AS db_date FROM "DailyBook" WHERE deleted_at IS NULL),
        numbered_dates AS (SELECT db_date, ROW_NUMBER() OVER (ORDER BY db_date DESC) AS rn FROM past_dates),
        pairs AS (
            SELECT n2.db_date AS date1, n1.db_date AS date2
            FROM numbered_dates n1 JOIN numbered_dates n2 ON n1.rn = n2.rn - 1 WHERE n1.rn % 2 = 1
        )
        SELECT ROW_NUMBER() OVER (ORDER BY date2 ASC) AS mq_num, date1::text, date2::text
        FROM pairs ORDER BY mq_num
    `);
    const pairs = res.rows;
    console.log('Pairs:', pairs.length);
    console.log('Last 2 pairs:', pairs.slice(-2));
    
    // check products for MQ 21
    if (pairs.length >= 21) {
        const mq21 = pairs[20];
        const p = await pool.query(`SELECT count(*) FROM "Ledger" WHERE type = 'PRODUCT' AND deleted_at IS NULL AND COALESCE(reference_date::date, created_at::date)::text IN ($1, $2)`, [mq21.date1, mq21.date2]);
        console.log('Products in MQ#21:', p.rows[0].count);
    }
    
    await pool.end();
}
run();
