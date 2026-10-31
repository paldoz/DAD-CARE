const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function check() {
  try {
    const { rows } = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Customer' AND column_name = 'first_daily_book_date'");
    console.log('first_daily_book_date column exists:', rows);
    const countRes = await pool.query('SELECT count(1) as total, count(first_daily_book_date) as has_date FROM "Customer"');
    console.log('Customer counts:', countRes.rows);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}
check();
