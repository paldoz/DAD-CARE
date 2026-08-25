const { Pool } = require('pg');
require('dotenv').config({ path: '.env' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
    console.log("--- DailyBookItems for Saleyman and Ciilaay (all dates) ---");
    const dbi = await pool.query(`
        SELECT dbi.id, db.date, c.name, c.customer_code, dbi.kg, dbi.note, dbi.present
        FROM "DailyBookItem" dbi
        JOIN "Customer" c ON c.id = dbi.customer_id
        LEFT JOIN "DailyBook" db ON db.id = dbi.daily_book_id
        WHERE c.name ILIKE '%Saleyman%' OR c.name ILIKE '%Ciilaay%'
        ORDER BY db.date DESC
        LIMIT 30
    `);
    console.table(dbi.rows);

    console.log("\n--- Ledger for Saleyman and Ciilaay (all records) ---");
    const ledger = await pool.query(`
        SELECT l.id, l.type, l.amount, l.kg, l.price, l.type_price, l.note, l.reference_date, l.maqal_id, c.name, c.customer_code
        FROM "Ledger" l
        JOIN "Customer" c ON c.id = l.customer_id
        WHERE c.name ILIKE '%Saleyman%' OR c.name ILIKE '%Ciilaay%'
        ORDER BY l.reference_date DESC, l.created_at DESC
        LIMIT 30
    `);
    console.table(ledger.rows);

    await pool.end();
}

run().catch(console.error);
