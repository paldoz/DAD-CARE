const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function findPhones() {
  try {
    const res = await pool.query(`SELECT id, name, phone FROM "Customer" WHERE phone IS NOT NULL AND phone != ''`);
    console.log('Customers with phones:', res.rows.length);
    if(res.rows.length > 0) {
      console.log(res.rows.slice(0, 5));
    }
    
    // Also let's check all customers to see their structure
    const all = await pool.query(`SELECT id, name, phone FROM "Customer" LIMIT 5`);
    console.log("Sample customers:", all.rows);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

findPhones();
