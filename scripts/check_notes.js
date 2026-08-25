const { Pool } = require('pg');
require('dotenv').config({ path: '.env' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
    console.log("--- DailyBookItems for Saleyman and Ciilaay ---");
    const res = await pool.query(`
        SELECT dbi.id, db.date, c.name, c.customer_code, dbi.kg, dbi.note, dbi.present
        FROM "DailyBookItem" dbi
        JOIN "Customer" c ON c.id = dbi.customer_id
        LEFT JOIN "DailyBook" db ON db.id = dbi.daily_book_id
        WHERE c.name ILIKE '%Saleyman%' OR c.name ILIKE '%Ciilaay%'
        ORDER BY db.date DESC, dbi.created_at DESC
        LIMIT 20
    `);
    console.table(res.rows);

    console.log("\n--- Ledger for Saleyman and Ciilaay ---");
    const lRes = await pool.query(`
        SELECT l.id, l.type, l.amount, l.kg, l.note, l.reference_date, l.maqal_id, c.name, c.customer_code
        FROM "Ledger" l
        JOIN "Customer" c ON c.id = l.customer_id
        WHERE c.name ILIKE '%Saleyman%' OR c.name ILIKE '%Ciilaay%'
        ORDER BY l.reference_date DESC, l.created_at DESC
        LIMIT 20
    `);
    console.table(lRes.rows);

    await pool.end();
}

run().catch(console.error);
