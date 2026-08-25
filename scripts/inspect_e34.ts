import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    const client = await pool.connect();
    try {
        const { rows } = await client.query(`
            SELECT id, type, kg, price_per_kg, amount, reference_date,
                   pg_typeof(reference_date) as ref_col_type,
                   reference_date::text as ref_text,
                   created_at::text as created_text
            FROM "Ledger"
            WHERE id = 'e34ce51a-ccb1-44cc-8dc8-c438c1621d82';
        `);
        console.log('=== EXACT ROW FOR e34ce51a (July 14 product) ===');
        console.log(rows[0]);
    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(console.error);
