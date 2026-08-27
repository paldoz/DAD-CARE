const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
if (!process.env.DATABASE_URL) {
    require('dotenv').config({ path: '.env' });
}

const pool = new Pool({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL
});

async function run() {
    try {
        const custRes = await pool.query(`
            SELECT id, name, customer_code FROM "Customer" 
            WHERE name ILIKE '%RUQIYO%' OR customer_code = '32'
        `);
        console.log('Customer:', custRes.rows);
        if (custRes.rows.length === 0) return;

        const customerId = custRes.rows[0].id;

        const ledgerRes = await pool.query(`
            SELECT id, type, amount, kg, price_per_kg, reference_date::text, maqal_id, receipt_id, deleted_at 
            FROM "Ledger" 
            WHERE customer_id = $1 AND deleted_at IS NULL
            ORDER BY reference_date ASC, created_at ASC
        `, [customerId]);
        console.log('\nLedger rows for customer:');
        console.table(ledgerRes.rows);

        const dbRes = await pool.query(`
            SELECT db.date::text as db_date, dbi.kg, dbi.note, dbi.deleted_at
            FROM "DailyBookItem" dbi
            JOIN "DailyBook" db ON dbi.daily_book_id = db.id
            WHERE dbi.customer_id = $1 AND dbi.deleted_at IS NULL AND db.deleted_at IS NULL
            ORDER BY db.date ASC
        `, [customerId]);
        console.log('\nDailyBook entries for customer:');
        console.table(dbRes.rows);

        // Check what /api/customer-daily-entries calculation does:
        const { MAQAL_PAIRS_CTE, validateMaqalPairs } = require('./lib/maqal-utils');
        const pairsRes = await pool.query(`
            ${MAQAL_PAIRS_CTE}
            SELECT mq_num, date1::text as date1, date2::text as date2, maqal_id
            FROM pairs
            ORDER BY mq_num ASC;
        `);
        console.log('\nAll pairs count:', pairsRes.rows.length);

        const processedRes = await pool.query(`
            SELECT DISTINCT
                (reference_date AT TIME ZONE 'Africa/Mogadishu')::date::text AS date_str,
                maqal_id
            FROM "Ledger"
            WHERE customer_id = $1
              AND type = 'PRODUCT'
              AND deleted_at IS NULL
              AND reference_date IS NOT NULL
            ORDER BY date_str ASC
        `, [customerId]);
        console.log('\nProcessed rows in Ledger:');
        console.table(processedRes.rows);

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}
run();
