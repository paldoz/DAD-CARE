/**
 * DATA IMPORT SCRIPT — Run AFTER setup-new-db.js
 * Run: node import-to-new-db.js
 * 
 * Imports from the backup JSON file into the new Supabase.
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const NEW_DB = 'postgresql://postgres.omjmjihinxbtilnirsco:ki6pw8TKnb4bqrjC@aws-0-eu-west-1.pooler.supabase.com:6543/postgres';

async function importData() {
    // Find the most recent backup file
    const files = fs.readdirSync(__dirname)
        .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
        .sort()
        .reverse();

    if (files.length === 0) {
        console.error('❌ No backup file found! Run export-data.js first.');
        process.exit(1);
    }

    const backupFile = path.join(__dirname, files[0]);
    console.log(`📂 Loading backup: ${files[0]}`);
    const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8'));

    const client = new Client({ connectionString: NEW_DB, ssl: { rejectUnauthorized: false } });
    console.log('🔌 Connecting to NEW Supabase...');
    await client.connect();
    console.log('✅ Connected!\n');

    await client.query('BEGIN');

    try {
        // 1. Import Users
        console.log('👤 Importing users...');
        let userCount = 0;
        for (const user of backup.users) {
            await client.query(`
                INSERT INTO "User" (id, email, username, name, password, role, is_active, gender, phone, avatar_url, assigned_customer_ids, created_at, updated_at, deleted_at)
                VALUES ($1,$2,$3,$4,$5,$6::\"Role\",$7,$8,$9,$10,$11,$12,$13,$14)
                ON CONFLICT DO NOTHING
            `, [
                user.id, user.email, user.username, user.name, user.password,
                user.role || 'ADMIN',
                user.is_active !== false,
                user.gender, user.phone, user.avatar_url,
                user.assigned_customer_ids || [],
                user.created_at, user.updated_at || user.created_at, user.deleted_at
            ]);
            userCount++;
        }
        console.log(`   ✅ ${userCount} users imported`);

        // 2. Import Customers
        console.log('🏪 Importing customers...');
        let custCount = 0;
        for (const c of backup.customers) {
            await client.query(`
                INSERT INTO "Customer" (id, customer_code, name, avatar_url, created_at, deleted_at)
                VALUES ($1,$2,$3,$4,$5,$6)
                ON CONFLICT (id) DO NOTHING
            `, [c.id, c.customer_code, c.name, c.avatar_url, c.created_at, c.deleted_at]);
            custCount++;
        }
        console.log(`   ✅ ${custCount} customers imported`);

        // 3. Import last 3 Daily Books
        console.log('📅 Importing daily books...');
        let bookCount = 0;
        for (const book of backup.dailyBooks) {
            await client.query(`
                INSERT INTO "DailyBook" (id, date, is_closed, created_at, deleted_at, deleted_by)
                VALUES ($1,$2::date,$3,$4,$5,$6)
                ON CONFLICT (id) DO NOTHING
            `, [book.id, book.date, book.is_closed ?? false, book.created_at, book.deleted_at, book.deleted_by]);
            bookCount++;
        }
        console.log(`   ✅ ${bookCount} daily books imported`);

        // 4. Import Daily Book Items
        console.log('📝 Importing daily book items...');
        let itemCount = 0;
        for (const item of backup.dailyBookItems) {
            await client.query(`
                INSERT INTO "DailyBookItem" (id, daily_book_id, customer_id, kg, present, note, deleted_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7)
                ON CONFLICT (id) DO NOTHING
            `, [item.id, item.daily_book_id, item.customer_id, item.kg, item.present, item.note, item.deleted_at]);
            itemCount++;
        }
        console.log(`   ✅ ${itemCount} daily book items imported`);

        // 5. Import Audit Logs
        console.log('📋 Importing audit logs...');
        let logCount = 0;
        for (const log of backup.auditLogs) {
            await client.query(`
                INSERT INTO "AuditLog" (id, user_id, username, name, role, action, details, ip_address, user_agent, created_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                ON CONFLICT (id) DO NOTHING
            `, [log.id, log.user_id, log.username, log.name, log.role, log.action, log.details, log.ip_address, log.user_agent, log.created_at || new Date().toISOString()]);
            logCount++;
        }
        console.log(`   ✅ ${logCount} audit logs imported`);

        await client.query('COMMIT');

        console.log('\n🎉 IMPORT COMPLETE! All your data is in the new Supabase.');
        console.log('\nSummary:');
        console.log(`  👤 Users:        ${userCount}`);
        console.log(`  🏪 Customers:    ${custCount}`);
        console.log(`  📅 Daily Books:  ${bookCount}`);
        console.log(`  📝 Items:        ${itemCount}`);
        console.log(`  📋 Audit Logs:   ${logCount}`);
        console.log('\n✅ Next step: Update your Vercel environment variables.');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Import failed, rolled back:', err.message);
        throw err;
    } finally {
        await client.end();
    }
}

importData().catch(err => {
    console.error('❌ Fatal error:', err.message);
    process.exit(1);
});
