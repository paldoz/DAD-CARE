const { Pool } = require('pg');
require('dotenv').config({ path: '.env' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
    console.log("\n--- All Customers ---");
    const allC = await pool.query(`SELECT id, customer_code, name FROM "Customer" WHERE deleted_at IS NULL ORDER BY customer_code::int`);
    console.table(allC.rows);

    console.log("\n--- DailyBookItem Columns ---");
    const dbiCols = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'DailyBookItem'
    `);
    console.table(dbiCols.rows);

    console.log("\n--- DailyBookItem Sample ---");
    const dbiSample = await pool.query(`SELECT * FROM "DailyBookItem" WHERE deleted_at IS NULL LIMIT 5`);
    console.table(dbiSample.rows);

    await pool.end();
}

run().catch(console.error);
