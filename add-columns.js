require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        console.log('Adding columns...');
        await pool.query('ALTER TABLE "Customer" ADD COLUMN is_unassignable BOOLEAN DEFAULT false;');
        console.log('Added is_unassignable');
        await pool.query('ALTER TABLE "Customer" ADD COLUMN is_kabarka BOOLEAN DEFAULT false;');
        console.log('Added is_kabarka');
        console.log('Done!');
    } catch (e) {
        if (e.message.includes('already exists')) {
            console.log('Columns already exist.');
        } else {
            console.error(e);
        }
    } finally {
        await pool.end();
    }
}
run();
