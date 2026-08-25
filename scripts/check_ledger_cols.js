const { Pool } = require('pg');
require('dotenv').config({ path: '.env' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
    console.log("\n--- Ledger Columns ---");
    const cols = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'Ledger'
    `);
    console.table(cols.rows);

    console.log("\n--- Ledger Entries for Saleyman and Ciilaay for Aug 22, 2026 onwards ---");
    const entries = await pool.query(`
        SELECT l.id, l.type, l.amount, l.kg, l.price_per_kg, l.note, l.reference_date, l.maqal_id, c.name
        FROM "Ledger" l
        JOIN "Customer" c ON c.id = l.customer_id
        WHERE (c.name ILIKE '%Saleyman%' OR c.name ILIKE '%Ciilaay%')
          AND l.reference_date >= '2026-08-20'
        ORDER BY l.reference_date DESC, l.created_at DESC
    `);
    console.table(entries.rows);

    await pool.end();
}

run().catch(console.error);
