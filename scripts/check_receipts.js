require('dotenv').config({ path: '.env' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
    const res = await pool.query(`
        SELECT COUNT(*) as count 
        FROM "Ledger" 
        WHERE type = 'PAYMENT' AND deleted_at IS NULL AND maqal_id IS NULL AND receipt_id IS NOT NULL
    `);
    console.log('Payments with NULL maqal_id but NOT NULL receipt_id:', res.rows[0].count);

    const res2 = await pool.query(`
        SELECT l1.id, l1.amount, l1.receipt_id, l2.reference_date, l2.type, l2.id as product_id
        FROM "Ledger" l1
        JOIN "Ledger" l2 ON l1.receipt_id = l2.receipt_id AND l2.type = 'PRODUCT'
        WHERE l1.type = 'PAYMENT' AND l1.deleted_at IS NULL AND l1.maqal_id IS NULL AND l1.receipt_id IS NOT NULL
        LIMIT 5
    `);
    console.log('Sample linked via receipt_id:', res2.rows);

    process.exit(0);
}
check();
