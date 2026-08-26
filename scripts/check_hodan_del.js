const { Pool } = require('pg');
const pool = new Pool({ 
    connectionString: "postgresql://postgres.omjmjihinxbtilnirsco:ki6pw8TKnb4bqrjC@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
    ssl: { rejectUnauthorized: false } 
});

async function main() {
    const client = await pool.connect();
    const hodanId = '96ee6785-ff35-4a40-9a06-a33186550004';
    
    const r = await client.query(`
        SELECT deleted_at, deleted_by, count(*) 
        FROM "Ledger" 
        WHERE customer_id = $1 
        GROUP BY deleted_at, deleted_by
    `, [hodanId]);
    console.table(r.rows);

    client.release();
    await pool.end();
}

main().catch(console.error);
