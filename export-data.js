/**
 * DATA EXPORT SCRIPT
 * Run: node export-data.js
 * 
 * Exports:
 *  - All admin users (User table)
 *  - All customers (Customer table)
 *  - Last 3 Daily Book dates + their items
 *  - Audit logs (last 500)
 *  - Final customer balances
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = 'postgresql://postgres.jaylgsinerhwcdydcgpa:5627BumG6rfHDimX@aws-0-eu-central-1.pooler.supabase.com:6543/postgres';

async function exportData() {
    const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

    console.log('🔌 Connecting to Supabase...');
    await client.connect();
    console.log('✅ Connected!\n');

    const backup = {};

    // 1. Export all Users (admins)
    console.log('📦 Exporting Users (admins)...');
    const users = await client.query(`SELECT * FROM "User" ORDER BY created_at ASC`);
    backup.users = users.rows;
    console.log(`   ✅ ${users.rows.length} users exported`);

    // 2. Export all Customers
    console.log('📦 Exporting Customers...');
    const customers = await client.query(`SELECT * FROM "Customer" WHERE deleted_at IS NULL ORDER BY created_at ASC`);
    backup.customers = customers.rows;
    console.log(`   ✅ ${customers.rows.length} customers exported`);

    // 3. Export last 3 Daily Book dates + their items
    console.log('📦 Exporting last 3 Daily Book entries...');
    const books = await client.query(
        `SELECT * FROM "DailyBook" WHERE deleted_at IS NULL ORDER BY date DESC LIMIT 3`
    );
    backup.dailyBooks = books.rows;

    const bookIds = books.rows.map(b => b.id);
    let dailyItems = { rows: [] };
    if (bookIds.length > 0) {
        dailyItems = await client.query(
            `SELECT * FROM "DailyBookItem" WHERE daily_book_id = ANY($1::uuid[]) AND deleted_at IS NULL`,
            [bookIds]
        );
    }
    backup.dailyBookItems = dailyItems.rows;
    console.log(`   ✅ ${books.rows.length} daily books exported (${dailyItems.rows.length} items)`);

    // 4. Export Audit Logs (last 500)
    console.log('📦 Exporting Audit Logs (last 500)...');
    const auditLogs = await client.query(`SELECT * FROM "AuditLog" ORDER BY created_at DESC LIMIT 500`);
    backup.auditLogs = auditLogs.rows;
    console.log(`   ✅ ${auditLogs.rows.length} audit logs exported`);

    // 5. Export current customer balances (final balance per customer)
    console.log('📦 Exporting final customer balances...');
    const balances = await client.query(`
        SELECT DISTINCT ON (customer_id) 
            customer_id, new_debt as balance, created_at
        FROM "Ledger"
        WHERE deleted_at IS NULL
        ORDER BY customer_id, created_at DESC
    `);
    backup.customerBalances = balances.rows;
    console.log(`   ✅ ${balances.rows.length} customer balances exported`);

    await client.end();

    // Save to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}.json`;
    const filepath = path.join(__dirname, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(backup, null, 2), 'utf8');

    console.log('\n🎉 BACKUP COMPLETE!');
    console.log(`📁 File saved: ${filepath}`);
    console.log('\nSummary:');
    console.log(`  👤 Users:           ${backup.users.length}`);
    console.log(`  🏪 Customers:       ${backup.customers.length}`);
    console.log(`  📅 Daily Books:     ${backup.dailyBooks.length} (last 3 dates)`);
    console.log(`  📝 Daily Items:     ${backup.dailyBookItems.length}`);
    console.log(`  💰 Balances:        ${backup.customerBalances.length}`);
    console.log(`  📋 Audit Logs:      ${backup.auditLogs.length}`);
    console.log('\n✅ Your data is safe. You can now proceed with the migration.');
}

exportData().catch(err => {
    console.error('❌ Export failed:', err.message);
    process.exit(1);
});
