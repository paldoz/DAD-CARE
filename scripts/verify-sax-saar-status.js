const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function verify() {
    try {
        const { rows } = await pool.query(`
            SELECT 
                COUNT(*)::int AS total_active,
                COUNT(priority_pair_key)::int AS with_key,
                COUNT(DISTINCT priority_pair_key)::int AS distinct_keys,
                MAX(priority_pair_key) AS active_pair_key
            FROM "CustomerNoteStatus"
            WHERE priority_enabled = TRUE;
        `);
        console.log('--- Sax Saar DB Status ---');
        console.table(rows);
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

verify();

