/**
 * Creates the missing Session table in the PRODUCTION database
 * Run: node fix-prod-session.js
 */
const { Client } = require('pg');

// PRODUCTION database
const PROD_DB = 'postgresql://postgres.omjmjihinxbtilnirsco:ki6pw8TKnb4bqrjC@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true';

async function fix() {
    const client = new Client({ connectionString: PROD_DB, ssl: { rejectUnauthorized: false } });
    console.log('🔌 Connecting to PRODUCTION Supabase...');
    await client.connect();
    console.log('✅ Connected!\n');

    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS "Session" (
                id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
                user_id TEXT NOT NULL,
                username TEXT NOT NULL,
                role TEXT NOT NULL,
                token TEXT UNIQUE NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                expires_at TIMESTAMPTZ NOT NULL,
                last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                ip_address TEXT,
                user_agent TEXT
            );
            CREATE INDEX IF NOT EXISTS "Session_token_idx" ON "Session"(token);
            CREATE INDEX IF NOT EXISTS "Session_user_id_idx" ON "Session"(user_id);
        `);
        console.log('✅ Session table created successfully in PRODUCTION!');
        console.log('\n🎉 Now log out and log back in on your Vercel site.');
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await client.end();
    }
}

fix();
