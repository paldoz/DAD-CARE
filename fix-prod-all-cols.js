/**
 * Adds ALL missing columns to production tables
 * Run: node fix-prod-all-cols.js
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
            -- Ledger: add edit_count (used in history view)
            ALTER TABLE "Ledger" ADD COLUMN IF NOT EXISTS edit_count INTEGER NOT NULL DEFAULT 0;
            
            -- DailyBookItem: add created_at (may be needed for ordering)
            ALTER TABLE "DailyBookItem" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
            
            -- DailyBook: add updated_at (may be needed)
            ALTER TABLE "DailyBook" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
        `);
        console.log('✅ All missing columns added!');

        // Show final state
        const tables = ['Ledger', 'DailyBookItem', 'DailyBook'];
        for (const table of tables) {
            const { rows } = await client.query(`
                SELECT column_name FROM information_schema.columns 
                WHERE table_name = $1 ORDER BY ordinal_position
            `, [table]);
            console.log(`\n📋 "${table}": ${rows.map(r => r.column_name).join(', ')}`);
        }

        console.log('\n🎉 Done! Refresh your Vercel site — customer history will now load!');
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await client.end();
    }
}

fix();
