/**
 * MIGRATION SCRIPT: CustomerNoteStatus Table Creation
 * 
 * SAFEGUARDS IMPLEMENTED:
 * 1. Independent Table: Completely decoupled from Ledger, DailyBook, and financial calculations.
 * 2. Foreign Key with ON DELETE CASCADE: Deleting a customer safely removes only their note record.
 * 3. Matching Column Types: customer_id is TEXT to match "Customer".id type in PostgreSQL.
 * 4. Idempotent: Uses CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS.
 * 5. Zero Accounting Impact: Does not alter customer balances, Maqal dates, payments, receipts, or FIFO.
 * 6. Database Security Hardening: Enables Row Level Security (RLS) and revokes public/anon access.
 */

require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });
const { Pool } = require('pg');

async function migrate() {
    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
        console.error("❌ No database connection string found in .env or .env.local");
        process.exit(1);
    }

    const pool = new Pool({
        connectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log("🚀 Starting migration: CustomerNoteStatus...");

        // 1. Create table with matching TEXT foreign key type
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "CustomerNoteStatus" (
                id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
                customer_id TEXT NOT NULL UNIQUE REFERENCES "Customer"(id) ON DELETE CASCADE,
                priority_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                busy_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                note TEXT DEFAULT '',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_by TEXT
            );
        `);
        console.log("✅ Table 'CustomerNoteStatus' verified / created.");

        // 2. Create index on customer_id
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_customer_note_status_customer_id 
            ON "CustomerNoteStatus"(customer_id);
        `);
        console.log("✅ Index 'idx_customer_note_status_customer_id' verified / created.");

        // 3. Database Security Hardening: Enable RLS and revoke anon/authenticated
        await pool.query(`ALTER TABLE "CustomerNoteStatus" ENABLE ROW LEVEL SECURITY;`);
        await pool.query(`REVOKE ALL ON "CustomerNoteStatus" FROM anon, authenticated;`);
        console.log("🔒 Row Level Security enabled and anon/authenticated access revoked.");

        // 4. Verification check
        const res = await pool.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = 'CustomerNoteStatus'
            ORDER BY ordinal_position;
        `);
        console.log("\n📋 Table Structure:");
        console.table(res.rows);

        console.log("\n🎉 Migration completed safely! Zero accounting tables were touched.");
    } catch (error) {
        console.error("❌ Migration failed:", error);
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    migrate();
}

module.exports = { migrate };
