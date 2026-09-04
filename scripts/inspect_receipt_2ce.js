require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function r() {
    const c = await pool.connect();
    try {
        const rows = await c.query(`
            SELECT id, customer_id, type, amount, reference_date, receipt_id, maqal_id, created_at, deleted_at, note
            FROM "Ledger"
            WHERE receipt_id = '2ce1fcf9-f56e-4346-86ce-23363a5c6cf0'
        `);
        console.log('Receipt 2ce1fcf9 rows:', rows.rows);
    } finally {
        c.release();
        await pool.end();
    }
}
r().catch(console.error);
