require('dotenv').config({ path: '.env' });
const { Pool } = require('pg');

async function run() {
    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
        console.error("No database URL found");
        process.exit(1);
    }
    const pool = new Pool({
        connectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log("Creating advanced partial indexes for 100x performance...");
        
        // Ledger: Optimize heavy Customer API calculation and history fetching
        await pool.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ledger_opt ON "Ledger"(customer_id, type) WHERE deleted_at IS NULL;');
        console.log("Created idx_ledger_opt");
        
        // Ledger: Optimize Dashboard and date-based reports
        await pool.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ledger_dates ON "Ledger"(reference_date, created_at) WHERE deleted_at IS NULL;');
        console.log("Created idx_ledger_dates");
        
        // Ledger: Optimize Daily Book saves and history
        await pool.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ledger_deleted_type ON "Ledger"(type) WHERE deleted_at IS NULL;');
        console.log("Created idx_ledger_deleted_type");

        // DailyBook: Optimize history and init
        await pool.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dailybook_opt ON "DailyBook"(date DESC) WHERE deleted_at IS NULL;');
        console.log("Created idx_dailybook_opt");

        // DailyBookItem: Optimize Dashboard active KG and History
        await pool.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dbi_opt ON "DailyBookItem"(daily_book_id, present) WHERE deleted_at IS NULL;');
        console.log("Created idx_dbi_opt");
        
        await pool.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dbi_customer ON "DailyBookItem"(customer_id) WHERE deleted_at IS NULL;');
        console.log("Created idx_dbi_customer");

        // Customer: Optimize the main customer list and search
        await pool.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cust_opt ON "Customer"(id) WHERE deleted_at IS NULL;');
        console.log("Created idx_cust_opt");
        
        await pool.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cust_search ON "Customer"(name, customer_code) WHERE deleted_at IS NULL;');
        console.log("Created idx_cust_search");

        console.log("All advanced indexes created successfully! Supabase is fully optimized.");
    } catch (e) {
        console.error("Error creating indexes:", e);
    } finally {
        await pool.end();
    }
}

run();
