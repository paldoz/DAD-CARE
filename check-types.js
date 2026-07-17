const { Client } = require('pg');

const PROD_DB = 'postgresql://postgres.omjmjihinxbtilnirsco:ki6pw8TKnb4bqrjC@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true';

async function check() {
    const client = new Client({ connectionString: PROD_DB, ssl: { rejectUnauthorized: false } });
    await client.connect();

    const tables = ['Customer', 'Ledger', 'DailyBook', 'DailyBookItem'];
    
    for (const table of tables) {
        try {
            const { rows } = await client.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = $1 AND column_name IN ('id', 'customer_id', 'daily_book_id', 'receipt_id')
            `, [table]);
            console.log(`\n📋 "${table}":`);
            rows.forEach(r => console.log(`  - ${r.column_name}: ${r.data_type}`));
        } catch (e) {
            console.log(`❌ "${table}": ${e.message}`);
        }
    }

    await client.end();
}

check();
