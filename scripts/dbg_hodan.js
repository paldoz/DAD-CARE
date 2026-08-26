const { Pool } = require('pg');
const pool = new Pool({ 
    connectionString: "postgresql://postgres.omjmjihinxbtilnirsco:ki6pw8TKnb4bqrjC@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
    ssl: { rejectUnauthorized: false } 
});

async function main() {
    const client = await pool.connect();
    const hodanId = '96ee6785-ff35-4a40-9a06-a33186550004';
    
    const r1 = await client.query(`SELECT count(*) FROM "Ledger" WHERE customer_id = $1`, [hodanId]);
    console.log('Total rows for Hodan:', r1.rows[0].count);

    const r2 = await client.query(`SELECT count(*) FROM "Ledger" WHERE customer_id = $1 AND deleted_at IS NULL`, [hodanId]);
    console.log('Active rows for Hodan:', r2.rows[0].count);

    try {
        const r3 = await client.query(`
            SELECT id, type, TO_CHAR(reference_date AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD') as reference_date
            FROM "Ledger"
            WHERE customer_id = $1 AND deleted_at IS NULL
            LIMIT 5
        `, [hodanId]);
        console.log('Sample rows with AT TIME ZONE:', r3.rows);
    } catch (e) {
        console.error('Error with AT TIME ZONE query:', e.message);
    }

    try {
        const r4 = await client.query(`
            SELECT id, type, TO_CHAR(reference_date, 'YYYY-MM-DD') as reference_date
            FROM "Ledger"
            WHERE customer_id = $1 AND deleted_at IS NULL
            LIMIT 5
        `, [hodanId]);
        console.log('Sample rows without AT TIME ZONE:', r4.rows);
    } catch (e) {
        console.error('Error without AT TIME ZONE query:', e.message);
    }

    client.release();
    await pool.end();
}

main().catch(console.error);
