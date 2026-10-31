const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!connectionString) {
    console.error('No connection string found in .env.local');
    process.exit(1);
}

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    const client = await pool.connect();
    try {
        console.log('Connecting to database to apply migration 002...');
        await client.query(`
            ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "first_daily_book_date" DATE;
            CREATE INDEX IF NOT EXISTS "idx_customer_first_daily_book_date" ON "Customer"("first_daily_book_date");
        `);
        console.log('Migration 002 applied successfully!');

        const res = await client.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'Customer' AND column_name = 'first_daily_book_date';
        `);
        console.log('Verification check on column:');
        console.table(res.rows);
    } catch (e) {
        console.error('Error applying migration 002:', e);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
