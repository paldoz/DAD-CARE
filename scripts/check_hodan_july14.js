require('dotenv').config({ path: '.env' });
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    const client = await pool.connect();
    try {
        const customerId = '96ee6785-ff35-4a40-9a06-a33186550004';

        console.log("=== 1. DAILY BOOK ITEMS FOR HODAN ON JUL 14 & 15 ===");
        const { rows: dbItems } = await client.query(`
            SELECT db.id as db_id, db.date::text as db_date, dbi.id as item_id, dbi.kg, dbi.note, dbi.deleted_at
            FROM "DailyBook" db
            LEFT JOIN "DailyBookItem" dbi ON dbi.daily_book_id = db.id AND dbi.customer_id = $1
            WHERE db.date IN ('2026-07-14'::date, '2026-07-15'::date)
            ORDER BY db.date ASC;
        `, [customerId]);
        console.table(dbItems);

        console.log("\n=== 2. LEDGER ENTRIES FOR HODAN IN RECEIPT #1 (FIRST RECEIPT) ===");
        const { rows: firstReceiptRows } = await client.query(`
            SELECT id, type, amount, kg, price_per_kg, reference_date, created_at, receipt_id, maqal_id, note
            FROM "Ledger"
            WHERE customer_id = $1 AND deleted_at IS NULL
            ORDER BY created_at ASC
            LIMIT 6;
        `, [customerId]);
        console.table(firstReceiptRows.map(r => ({
            id: r.id,
            type: r.type,
            amount: Number(r.amount),
            kg: r.kg,
            price: r.price_per_kg,
            ref_date_raw: r.reference_date,
            ref_date_str: r.reference_date ? String(r.reference_date) : 'NULL/EMPTY',
            created_at: new Date(r.created_at).toISOString(),
            receipt_id: r.receipt_id,
            note: r.note
        })));

    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(console.error);
