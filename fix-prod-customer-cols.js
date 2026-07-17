/**
 * Adds missing columns to the Customer table in PRODUCTION
 * Run: node fix-prod-customer-cols.js
 */
const { Client } = require('pg');

const PROD_DB = 'postgresql://postgres.omjmjihinxbtilnirsco:ki6pw8TKnb4bqrjC@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true';

async function fix() {
    const client = new Client({ connectionString: PROD_DB, ssl: { rejectUnauthorized: false } });
    console.log('🔌 Connecting to PRODUCTION Supabase...');
    await client.connect();
    console.log('✅ Connected!\n');

    try {
        await client.query(`
            ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS gender TEXT;
            ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS phone TEXT;
        `);
        console.log('✅ Added gender and phone columns to Customer table!');
        
        // Verify
        const { rows } = await client.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'Customer' ORDER BY ordinal_position
        `);
        console.log('\n📋 Customer table columns now:', rows.map(r => r.column_name).join(', '));
        console.log('\n🎉 Done! Your customers page will now work on Vercel.');
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await client.end();
    }
}

fix();
