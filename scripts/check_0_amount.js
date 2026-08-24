const { Pool } = require('pg');
require('dotenv').config({ path: '.env' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function run() {
    const res = await pool.query(`SELECT id, type, amount, kg, created_at, reference_date, customer_id, note FROM "Ledger" WHERE amount = 0 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 10`);
    console.log(res.rows);
    await pool.end();
}
run();
