require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function r() {
    const c = await pool.connect();
    try {
        console.log('--- FADXI CUSTOMER RECORD ---');
        const custRes = await c.query(`SELECT id, name, customer_code FROM "Customer" WHERE id = 'f34f6e92-f53d-4aad-993c-82d504beb1c0'`);
        console.log(custRes.rows[0]);

        console.log('\n--- FADXI OLD RECEIPT ROWS ---');
        const oldRec = await c.query(`SELECT id, type, amount, reference_date, receipt_id, maqal_id, created_at, note FROM "Ledger" WHERE receipt_id = '2ce1fcf9-f56e-4346-86ce-23363a5c6cf0' AND deleted_at IS NULL`);
        console.table(oldRec.rows);

        console.log('\n--- FADXI NEW RECEIPT ROWS ---');
        const newRec = await c.query(`SELECT id, type, amount, reference_date, receipt_id, maqal_id, created_at, note FROM "Ledger" WHERE receipt_id = 'c708cc04-5e1c-413c-90cd-1672aa6e2598' AND deleted_at IS NULL`);
        console.table(newRec.rows);

        console.log('\n--- ALL AUDIT LOGS FOR FADXI ---');
        const alRes = await c.query(`SELECT action, username, details, created_at FROM "AuditLog" WHERE details ILIKE '%f34f6e92%' OR details ILIKE '%fadxi%' ORDER BY created_at DESC LIMIT 10`);
        console.table(alRes.rows);

    } finally {
        c.release();
        await pool.end();
    }
}
r().catch(console.error);
