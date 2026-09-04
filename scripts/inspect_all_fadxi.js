require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function r() {
    const c = await pool.connect();
    try {
        const rows = await c.query(`
            SELECT id, type, amount, reference_date, receipt_id, maqal_id, created_at, deleted_at, note
            FROM "Ledger"
            WHERE customer_id = 'f34f6e92-f53d-4aad-993c-82d504beb1c0'
            ORDER BY created_at ASC
        `);
        console.log(`Total rows for Fadxi: ${rows.rows.length}`);
        console.table(rows.rows);
    } finally {
        c.release();
        await pool.end();
    }
}
r().catch(console.error);
