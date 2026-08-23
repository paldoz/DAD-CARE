require('dotenv').config({ path: '.env' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
    const res = await pool.query(`
        SELECT p.id, p.amount, p.receipt_id, p.maqal_id, p.created_at, l.reference_date, c.name as customer_name
        FROM "Ledger" p
        JOIN "Ledger" l ON p.receipt_id = l.receipt_id AND l.type = 'PRODUCT'
        JOIN "Customer" c ON c.id = p.customer_id
        WHERE p.type = 'PAYMENT' AND p.deleted_at IS NULL AND p.maqal_id IS NULL 
        AND l.reference_date::date IN ('2026-07-14', '2026-07-15')
    `);
    console.log('Payments linked to MQ#1 products via receipt_id:');
    console.log(res.rows);
    process.exit(0);
}
check();
