require('dotenv').config();
const { Client } = require('pg');

async function run() {
    console.log('Connecting to database...');
    // Use DIRECT_URL for schema/DDL modifications to bypass PgBouncer
    const client = new Client({
        connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log('Connected! Creating indexes...');

        // 1. Customer Ledger Index
        console.log('Creating idx_ledger_customer_active...');
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_ledger_customer_active 
            ON "Ledger" (customer_id, created_at DESC, id DESC) 
            WHERE deleted_at IS NULL;
        `);

        // 2. Global Dashboard Index
        console.log('Creating idx_ledger_active_desc...');
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_ledger_active_desc 
            ON "Ledger" (created_at DESC) 
            WHERE deleted_at IS NULL;
        `);

        // 3. Product/Receipt Type Index
        console.log('Creating idx_ledger_type_active...');
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_ledger_type_active 
            ON "Ledger" (type, created_at DESC) 
            WHERE deleted_at IS NULL;
        `);

        // 4. Daily Book Index
        console.log('Creating idx_daily_book_active...');
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_daily_book_active 
            ON "DailyBook" (date DESC) 
            WHERE deleted_at IS NULL;
        `);

        console.log('All indexes created successfully! This will immediately drop the Supabase row scan metrics.');
    } catch (err) {
        console.error('Error creating indexes:', err);
    } finally {
        await client.end();
    }
}

run();
