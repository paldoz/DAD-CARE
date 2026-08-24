const { Pool } = require('pg');
require('dotenv').config({ path: '.env' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
    console.log("--- LATEST 10 PAYMENTS IN LEDGER ---");
    const payments = await pool.query(`
        SELECT l.id, l.type, l.amount, l.kg, l.created_at, l.reference_date, l.maqal_id, l.receipt_id, c.name as customer_name
        FROM "Ledger" l
        JOIN "Customer" c ON c.id = l.customer_id
        WHERE l.deleted_at IS NULL AND l.type = 'PAYMENT'
        ORDER BY l.created_at DESC
        LIMIT 10
    `);
    console.table(payments.rows);

    console.log("\n--- LATEST 10 OF ANY TYPE IN LEDGER ---");
    const anyRows = await pool.query(`
        SELECT l.id, l.type, l.amount, l.kg, l.created_at, l.reference_date, l.maqal_id, l.receipt_id, c.name as customer_name
        FROM "Ledger" l
        JOIN "Customer" c ON c.id = l.customer_id
        WHERE l.deleted_at IS NULL
        ORDER BY l.created_at DESC
        LIMIT 10
    `);
    console.table(anyRows.rows);

    await pool.end();
}

run().catch(console.error);
