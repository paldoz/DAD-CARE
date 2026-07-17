/**
 * SCHEMA SETUP SCRIPT — Run this FIRST on the new Supabase
 * Run: node setup-new-db.js
 */

const { Client } = require('pg');

const NEW_DB = 'postgresql://postgres.cfepckoviapjbxpauldr:0frWmNafDE1JzS6E@aws-1-eu-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true';

async function setup() {
    const client = new Client({ connectionString: NEW_DB, ssl: { rejectUnauthorized: false } });
    console.log('🔌 Connecting to NEW Supabase...');
    await client.connect();
    console.log('✅ Connected!\n');

    const sql = `
        -- Enums
        DO $$ BEGIN
            CREATE TYPE "Role" AS ENUM ('ADMIN', 'CUSTOMER', 'SUPER_ADMIN');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        DO $$ BEGIN
            CREATE TYPE "LedgerType" AS ENUM ('PRODUCT', 'PAYMENT', 'ADJUSTMENT');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        -- User table
        CREATE TABLE IF NOT EXISTS "User" (
            id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            name TEXT,
            password TEXT NOT NULL,
            role "Role" NOT NULL DEFAULT 'CUSTOMER',
            is_active BOOLEAN NOT NULL DEFAULT true,
            gender TEXT,
            phone TEXT,
            avatar_url TEXT,
            assigned_customer_ids TEXT[] NOT NULL DEFAULT '{}',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS "User_created_at_idx" ON "User"(created_at);

        -- Customer table
        CREATE TABLE IF NOT EXISTS "Customer" (
            id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
            customer_code TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            avatar_url TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS "Customer_customer_code_idx" ON "Customer"(customer_code);
        CREATE INDEX IF NOT EXISTS "Customer_created_at_idx" ON "Customer"(created_at);

        -- DailyBook table
        CREATE TABLE IF NOT EXISTS "DailyBook" (
            id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
            date DATE UNIQUE NOT NULL,
            is_closed BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at TIMESTAMPTZ,
            deleted_by TEXT
        );
        CREATE INDEX IF NOT EXISTS "DailyBook_date_idx" ON "DailyBook"(date);

        -- DailyBookItem table
        CREATE TABLE IF NOT EXISTS "DailyBookItem" (
            id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
            daily_book_id TEXT NOT NULL REFERENCES "DailyBook"(id),
            customer_id TEXT NOT NULL REFERENCES "Customer"(id),
            kg DOUBLE PRECISION NOT NULL,
            present BOOLEAN NOT NULL DEFAULT true,
            note TEXT,
            deleted_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS "DailyBookItem_daily_book_id_idx" ON "DailyBookItem"(daily_book_id);
        CREATE INDEX IF NOT EXISTS "DailyBookItem_customer_id_idx" ON "DailyBookItem"(customer_id);

        -- Ledger table
        CREATE TABLE IF NOT EXISTS "Ledger" (
            id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
            customer_id TEXT NOT NULL REFERENCES "Customer"(id),
            type "LedgerType" NOT NULL,
            reference_date DATE,
            kg DOUBLE PRECISION,
            price_per_kg DOUBLE PRECISION,
            amount DOUBLE PRECISION NOT NULL,
            previous_debt DOUBLE PRECISION NOT NULL,
            new_debt DOUBLE PRECISION NOT NULL,
            note TEXT,
            receipt_id TEXT,
            maqal_id INTEGER,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at TIMESTAMPTZ,
            deleted_by TEXT
        );
        CREATE INDEX IF NOT EXISTS "Ledger_customer_id_idx" ON "Ledger"(customer_id);
        CREATE INDEX IF NOT EXISTS "Ledger_type_idx" ON "Ledger"(type);
        CREATE INDEX IF NOT EXISTS "Ledger_reference_date_idx" ON "Ledger"(reference_date);
        CREATE INDEX IF NOT EXISTS "Ledger_created_at_idx" ON "Ledger"(created_at);

        -- AdminSession table
        CREATE TABLE IF NOT EXISTS "AdminSession" (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            name TEXT,
            role TEXT NOT NULL,
            token TEXT UNIQUE NOT NULL,
            login_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL,
            ip_address TEXT,
            user_agent TEXT,
            avatar_url TEXT
        );
        CREATE INDEX IF NOT EXISTS "AdminSession_token_idx" ON "AdminSession"(token);
        CREATE INDEX IF NOT EXISTS "AdminSession_username_idx" ON "AdminSession"(username);

        -- AuditLog table
        CREATE TABLE IF NOT EXISTS "AuditLog" (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id TEXT,
            username TEXT NOT NULL,
            name TEXT,
            role TEXT NOT NULL,
            action TEXT NOT NULL,
            details TEXT NOT NULL,
            ip_address TEXT,
            user_agent TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS "AuditLog_username_idx" ON "AuditLog"(username);
        CREATE INDEX IF NOT EXISTS "AuditLog_action_idx" ON "AuditLog"(action);
        CREATE INDEX IF NOT EXISTS "AuditLog_created_at_idx" ON "AuditLog"(created_at);
    `;

    try {
        await client.query(sql);
        console.log('✅ All tables created successfully!');
    } catch (err) {
        console.error('❌ Schema error:', err.message);
        throw err;
    } finally {
        await client.end();
    }

    console.log('\n🎉 Schema setup complete! Run: node import-to-new-db.js');
}

setup().catch(err => {
    console.error('❌ Failed:', err.message);
    process.exit(1);
});
