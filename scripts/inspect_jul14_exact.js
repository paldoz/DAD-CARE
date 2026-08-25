require('dotenv').config({ path: '.env' });
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    const client = await pool.connect();
    try {
        const { rows } = await client.query(`
            SELECT id, type, amount, kg, price_per_kg, reference_date,
                   reference_date::text as ref_text,
                   created_at::text as created_text
            FROM "Ledger"
            WHERE id IN ('e34ce51a-ccb1-44cc-8dc8-c438c1621d82', '8a4c60ff-542a-4b30-a897-12cd7760b4da', '51af3525-9bbc-485d-bd6b-7312c6bcbb02', 'cd6e9c6f-6488-4ed2-9f29-7e9b668c455b');
        `);
        console.table(rows);
    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(console.error);
