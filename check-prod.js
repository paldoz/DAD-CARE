const { Client } = require('pg');

const prodUrl = 'postgresql://postgres.omjmjihinxbtilnirsco:ki6pw8TKnb4bqrjC@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true';

async function check() {
    const client = new Client({ connectionString: prodUrl, ssl: { rejectUnauthorized: false } });
    await client.connect();
    
    const countRes = await client.query('SELECT COUNT(*) FROM "Customer"');
    console.log("Total Customers:", countRes.rows[0].count);
    
    const nullRes = await client.query('SELECT COUNT(*) FROM "Customer" WHERE deleted_at IS NULL');
    console.log("Customers with deleted_at IS NULL:", nullRes.rows[0].count);
    
    await client.end();
}

check();
