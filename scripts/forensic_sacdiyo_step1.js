require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
    const client = await pool.connect();
    try {
        // Get Customer table columns
        const { rows: cols } = await client.query(
            `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='Customer' ORDER BY ordinal_position`
        );
        console.log('=== Customer TABLE COLUMNS ===');
        cols.forEach(c => console.log(`  ${c.column_name} (${c.data_type})`));

        // Get Ledger table columns
        const { rows: lcols } = await client.query(
            `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='Ledger' ORDER BY ordinal_position`
        );
        console.log('\n=== Ledger TABLE COLUMNS ===');
        lcols.forEach(c => console.log(`  ${c.column_name} (${c.data_type})`));

        // Find Sacdiyo
        const { rows: customers } = await client.query(
            `SELECT * FROM "Customer" WHERE LOWER(name) LIKE '%sacdiyo%' ORDER BY created_at ASC`
        );
        console.log('\n=== SACDIYO CUSTOMER RECORD(S) ===');
        console.log(JSON.stringify(customers, null, 2));

    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(console.error);
