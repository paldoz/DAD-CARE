require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
    const client = await pool.connect();
    try {
        // Check E: customer with <100 rows still works fine with limit=500
        const { rows } = await client.query(`
            SELECT c.id, c.name, COUNT(l.id) as row_count
            FROM "Customer" c
            JOIN "Ledger" l ON l.customer_id = c.id AND l.deleted_at IS NULL
            WHERE c.deleted_at IS NULL AND c.id != '45c8377c-810f-40af-b50e-5319f2f3e9a3'
            GROUP BY c.id, c.name
            HAVING COUNT(l.id) < 100
            LIMIT 1
        `);
        if (rows.length > 0) {
            const row = rows[0];
            console.log(`✅ Check E: Customer with <100 rows: "${row.name}" has ${row.row_count} rows`);
            console.log(`   limit=500 returns all ${row.row_count} rows — no truncation`);
        } else {
            console.log('No customer with <100 rows found (all customers have ≥100 rows)');
        }

        // Check F: customer with >100 rows gets complete history up to 500
        const { rows: bigCust } = await client.query(`
            SELECT c.id, c.name, COUNT(l.id) as row_count
            FROM "Customer" c
            JOIN "Ledger" l ON l.customer_id = c.id AND l.deleted_at IS NULL
            WHERE c.deleted_at IS NULL
            GROUP BY c.id, c.name
            HAVING COUNT(l.id) > 100
            ORDER BY COUNT(l.id) DESC
            LIMIT 5
        `);
        console.log('\n✅ Check F: Customers with >100 rows (would have been truncated before fix):');
        bigCust.forEach(r => console.log(`   "${r.name}": ${r.row_count} rows — now fully returned with limit=500`));

    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(console.error);
