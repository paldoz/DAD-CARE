/**
 * Checks all table columns in PRODUCTION to find missing ones
 * Run: node check-prod-cols.js
 */
const { Client } = require('pg');

const PROD_DB = 'postgresql://postgres.omjmjihinxbtilnirsco:ki6pw8TKnb4bqrjC@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true';

async function check() {
    const client = new Client({ connectionString: PROD_DB, ssl: { rejectUnauthorized: false } });
    await client.connect();

    const tables = ['Customer', 'Ledger', 'DailyBook', 'DailyBookItem', 'User', 'AdminSession', 'AuditLog'];
    
    for (const table of tables) {
        try {
            const { rows } = await client.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = $1 
                ORDER BY ordinal_position
            `, [table]);
            console.log(`\n📋 "${table}" columns: ${rows.map(r => r.column_name).join(', ')}`);
        } catch (e) {
            console.log(`❌ "${table}": ${e.message}`);
        }
    }

    await client.end();
}

check();
