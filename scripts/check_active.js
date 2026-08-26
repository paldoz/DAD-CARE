const { Pool } = require('pg');
const pool = new Pool({ 
    connectionString: "postgresql://postgres.omjmjihinxbtilnirsco:ki6pw8TKnb4bqrjC@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
    ssl: { rejectUnauthorized: false } 
});

async function main() {
    const client = await pool.connect();
    
    const r1 = await client.query(`
        SELECT c.id, c.customer_code, c.name, count(l.id) as total_txns, 
               count(case when l.deleted_at is null then 1 end) as active_txns,
               count(case when l.deleted_at is not null then 1 end) as deleted_txns
        FROM "Customer" c
        LEFT JOIN "Ledger" l ON l.customer_id = c.id
        WHERE c.deleted_at IS NULL
        GROUP BY c.id, c.customer_code, c.name
        ORDER BY active_txns DESC
        LIMIT 10
    `);
    console.log('Top active customers in DB:');
    console.table(r1.rows);

    const r2 = await client.query(`
        SELECT id, customer_code, name, deleted_at FROM "Customer" WHERE customer_code = '47' OR name ILIKE '%hodan%'
    `);
    console.log('Hodan rows in Customer table:');
    console.table(r2.rows);

    client.release();
    await pool.end();
}

main().catch(console.error);
