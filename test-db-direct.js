const { Client } = require('pg');

const client = new Client({
    connectionString: "postgresql://postgres.rygldymfndwtytykchwz:L2GgA2G8kHn2j6N@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require"
});

async function run() {
    await client.connect();
    console.log("Connected");
    const res = await client.query('SELECT count(*) as total, count(deleted_at) as deleted_count FROM "Customer"');
    console.log("Customer Stats:", res.rows[0]);
    const res2 = await client.query('SELECT id, name, deleted_at FROM "Customer" LIMIT 5');
    console.log("Sample:", res2.rows);
    
    // Test the specific query that is failing
    const res3 = await client.query(`
        SELECT count(*) 
        FROM "Customer" c
        WHERE c.deleted_at IS NULL
    `);
    console.log("Customers with deleted_at IS NULL:", res3.rows[0]);
    
    // Look at how deleted_at is stored exactly
    const res4 = await client.query(`SELECT deleted_at, pg_typeof(deleted_at) as type FROM "Customer" LIMIT 1`);
    console.log("deleted_at type:", res4.rows);
    
    await client.end();
}

run().catch(console.error);
