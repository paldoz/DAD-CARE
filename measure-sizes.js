const { Pool } = require('pg');

const pool = new Pool({
    connectionString: "postgresql://postgres.cfepckoviapjbxpauldr:0frWmNafDE1JzS6E@aws-1-eu-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true",
    ssl: { rejectUnauthorized: false }
});

async function measureEndpointSize() {
    console.log("=== LIVE PAYLOAD SIZE MEASUREMENT ===\n");

    // 1. Audit Logs (50 rows - what the UI fetches)
    const auditRes = await pool.query(`
        SELECT id, action, details, ip_address, created_at, user_id
        FROM "AuditLog"
        ORDER BY created_at DESC LIMIT 50
    `);
    const auditBytes = Buffer.byteLength(JSON.stringify(auditRes.rows), 'utf8');
    console.log(`[/api/audit-logs]       ${auditRes.rows.length} rows = ${auditBytes} bytes = ${(auditBytes/1024).toFixed(2)} KB`);

    // 2. Customers List
    const customersRes = await pool.query(`
        SELECT id, customer_code, name, created_at FROM "Customer" ORDER BY name ASC
    `);
    const customersBytes = Buffer.byteLength(JSON.stringify(customersRes.rows), 'utf8');
    console.log(`[/api/customers]        ${customersRes.rows.length} rows = ${customersBytes} bytes = ${(customersBytes/1024).toFixed(2)} KB`);

    // 3. Ledger History (100 rows)
    const ledgerRes = await pool.query(`
        SELECT id, customer_id, type, reference_date, kg, price_per_kg, amount, previous_debt, new_debt, note, receipt_id, created_at 
        FROM "Ledger" 
        WHERE deleted_at IS NULL
        ORDER BY created_at DESC LIMIT 100
    `);
    const ledgerBytes = Buffer.byteLength(JSON.stringify(ledgerRes.rows), 'utf8');
    console.log(`[/api/ledger]           ${ledgerRes.rows.length} rows = ${ledgerBytes} bytes = ${(ledgerBytes/1024).toFixed(2)} KB`);

    // 4. Admin Sessions
    const sessionsRes = await pool.query(`
        SELECT token, user_id, username, role, ip_address, login_at, last_seen_at 
        FROM "AdminSession"
    `);
    const sessionBytes = Buffer.byteLength(JSON.stringify(sessionsRes.rows), 'utf8');
    console.log(`[/api/admin-sessions]   ${sessionsRes.rows.length} rows = ${sessionBytes} bytes = ${(sessionBytes/1024).toFixed(2)} KB`);

    // 5. Users list (no avatar)
    const usersRes = await pool.query(`
        SELECT id, username, name, role, is_active, gender, phone, assigned_customer_ids, created_at
        FROM "User" WHERE role IN ('ADMIN', 'SUPER_ADMIN')
    `);
    const usersBytes = Buffer.byteLength(JSON.stringify(usersRes.rows), 'utf8');
    console.log(`[/api/users]            ${usersRes.rows.length} rows = ${usersBytes} bytes = ${(usersBytes/1024).toFixed(2)} KB`);

    // 6. Daily Book History (7 days)
    const bookRes = await pool.query(`
        SELECT db.id, db.date, COALESCE(SUM(dbi.kg), 0) as total_kg, COUNT(dbi.id) as item_count
        FROM "DailyBook" db
        LEFT JOIN "DailyBookItem" dbi ON dbi.daily_book_id = db.id
        WHERE db.deleted_at IS NULL
        GROUP BY db.id, db.date
        ORDER BY db.date DESC LIMIT 7
    `);
    const bookBytes = Buffer.byteLength(JSON.stringify(bookRes.rows), 'utf8');
    console.log(`[/api/daily-book]       ${bookRes.rows.length} rows = ${bookBytes} bytes = ${(bookBytes/1024).toFixed(2)} KB`);

    const total = auditBytes + customersBytes + ledgerBytes + sessionBytes + usersBytes + bookBytes;
    console.log(`\n=== TOTAL ONE FULL APP LOAD = ${total} bytes = ${(total/1024).toFixed(2)} KB ===`);
    console.log(`\n--- Monthly Egress Estimate ---`);
    const dailyLoads = 30; // conservative: 30 full page loads per day
    const monthly = (total / 1024 / 1024) * dailyLoads * 30;
    console.log(`At ${dailyLoads} page loads/day x 30 days = ${monthly.toFixed(2)} MB/month`);

    await pool.end();
}

measureEndpointSize().catch(console.error);
