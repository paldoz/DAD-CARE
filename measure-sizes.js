const { Pool } = require('pg');

const pool = new Pool({
    connectionString: "postgresql://postgres.cfepckoviapjbxpauldr:0frWmNafDE1JzS6E@aws-1-eu-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true",
    ssl: { rejectUnauthorized: false }
});

async function measure() {
    console.log("=== COMPLETE API PAYLOAD MEASUREMENT ===\n");

    const results = [];

    const run = async (label, queryFn) => {
        try {
            const rows = await queryFn();
            const bytes = Buffer.byteLength(JSON.stringify(rows), 'utf8');
            const result = { label, rows: rows.length, bytes, kb: (bytes/1024).toFixed(2) };
            results.push(result);
            console.log(`[${label}] ${rows.length} rows = ${result.kb} KB`);
        } catch (e) {
            console.log(`[${label}] ERROR: ${e.message}`);
        }
    };

    // AUTH
    await run('/api/auth/login (response)', async () => {
        const r = await pool.query(`SELECT id, username, name, role, is_active, avatar_url FROM "User" LIMIT 1`);
        return r.rows; // This is what login returns in resolvedUser
    });

    // AUDIT LOGS — default limit is 200, not 50
    await run('/api/audit-logs (limit=200, default)', async () => {
        const r = await pool.query(`SELECT id, action, details, ip_address, created_at, user_id, username, name, role, user_agent FROM "AuditLog" ORDER BY created_at DESC LIMIT 200`);
        return r.rows;
    });
    await run('/api/audit-logs (limit=50, paginated)', async () => {
        const r = await pool.query(`SELECT id, action, details, ip_address, created_at, user_id, username, name, role, user_agent FROM "AuditLog" ORDER BY created_at DESC LIMIT 50`);
        return r.rows;
    });
    await run('/api/audit-logs?check=1 (delta check)', async () => {
        const r = await pool.query(`SELECT COUNT(*) as count, MAX(id) as latest_id FROM "AuditLog"`);
        return r.rows;
    });

    // CUSTOMERS
    await run('/api/customers?lite=true', async () => {
        const r = await pool.query(`SELECT id, name, customer_code, phone, CASE WHEN deleted_at IS NOT NULL THEN true ELSE false END as is_inactive FROM "Customer" ORDER BY name ASC`);
        return r.rows;
    });
    await run('/api/customers?mode=ledger', async () => {
        const r = await pool.query(`SELECT id, name, customer_code, CASE WHEN deleted_at IS NOT NULL THEN true ELSE false END as is_inactive FROM "Customer" ORDER BY name ASC`);
        return r.rows;
    });
    await run('/api/customers (full, page 1, limit 20)', async () => {
        const r = await pool.query(`SELECT id, name, customer_code, gender, phone, created_at, deleted_at FROM "Customer" ORDER BY name ASC LIMIT 20`);
        return r.rows;
    });

    // LEDGER
    await run('/api/ledger (limit=100)', async () => {
        const r = await pool.query(`SELECT id, customer_id, type, reference_date, kg, price_per_kg, amount, previous_debt, new_debt, note, receipt_id, created_at FROM "Ledger" WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`);
        return r.rows;
    });
    await run('/api/ledger (limit=500, max allowed)', async () => {
        const r = await pool.query(`SELECT id, customer_id, type, reference_date, kg, price_per_kg, amount, previous_debt, new_debt, note, receipt_id, created_at FROM "Ledger" WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 500`);
        return r.rows;
    });

    // DASHBOARD
    await run('/api/dashboard', async () => {
        const r = await pool.query(`SELECT COUNT(*)::int as total_customers, COALESCE(SUM(CASE WHEN new_debt > 0 THEN new_debt ELSE 0 END), 0)::float as total_debt FROM "Customer" c LEFT JOIN LATERAL (SELECT new_debt FROM "Ledger" WHERE customer_id = c.id AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1) l ON true WHERE c.deleted_at IS NULL`);
        return r.rows;
    });

    // REPORTS
    await run('/api/reports (all customers)', async () => {
        const r = await pool.query(`SELECT id, name, customer_code FROM "Customer" WHERE deleted_at IS NULL ORDER BY name ASC`);
        return r.rows;
    });

    // ADMIN SESSIONS
    await run('/api/admin-sessions', async () => {
        const r = await pool.query(`SELECT token, user_id, username, role, ip_address, login_at, last_seen_at FROM "AdminSession"`);
        return r.rows;
    });

    // USERS
    await run('/api/users (no avatar)', async () => {
        const r = await pool.query(`SELECT id, username, name, role, is_active, gender, phone, assigned_customer_ids, created_at FROM "User" WHERE role IN ('ADMIN', 'SUPER_ADMIN')`);
        return r.rows;
    });
    await run('/api/users?withAvatar=true (with avatar)', async () => {
        const r = await pool.query(`SELECT id, username, name, role, is_active, gender, phone, assigned_customer_ids, created_at, CASE WHEN length(avatar_url) > 100000 THEN NULL ELSE avatar_url END as avatar_url FROM "User" WHERE role IN ('ADMIN', 'SUPER_ADMIN')`);
        return r.rows;
    });

    // DAILY BOOK HISTORY
    await run('/api/daily-book-history (limit=7)', async () => {
        const r = await pool.query(`SELECT db.id, db.date, COALESCE(SUM(dbi.kg), 0) as total_kg, COUNT(dbi.id) as item_count FROM "DailyBook" db LEFT JOIN "DailyBookItem" dbi ON dbi.daily_book_id = db.id WHERE db.deleted_at IS NULL GROUP BY db.id, db.date ORDER BY db.date DESC LIMIT 7`);
        return r.rows;
    });
    await run('/api/daily-book-history-full (limit=15, with items)', async () => {
        const r = await pool.query(`SELECT db.id, db.date, COALESCE(json_agg(json_build_object('id', dbi.id, 'kg', dbi.kg, 'present', dbi.present, 'note', dbi.note, 'customer_id', dbi.customer_id)) FILTER (WHERE dbi.id IS NOT NULL), '[]'::json) as items FROM "DailyBook" db LEFT JOIN "DailyBookItem" dbi ON dbi.daily_book_id = db.id AND dbi.deleted_at IS NULL WHERE db.deleted_at IS NULL GROUP BY db.id, db.date ORDER BY db.date DESC LIMIT 15`);
        return r.rows;
    });

    // MAQAL
    await run('/api/maqal-pairs', async () => {
        const r = await pool.query(`SELECT * FROM "MaqalPair" ORDER BY created_at DESC LIMIT 10`).catch(() => ({ rows: [] }));
        return r.rows;
    });
    await run('/api/maqal-latest', async () => {
        const r = await pool.query(`SELECT * FROM "MaqalPair" ORDER BY created_at DESC LIMIT 1`).catch(() => ({ rows: [] }));
        return r.rows;
    });

    // PAYMENTS
    await run('/api/payments', async () => {
        const r = await pool.query(`SELECT id, customer_id, type, amount, note, created_at FROM "Ledger" WHERE type = 'PAYMENT' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50`);
        return r.rows;
    });

    // TRASH
    await run('/api/trash', async () => {
        const r = await pool.query(`SELECT id, customer_id, type, amount, note, deleted_at FROM "Ledger" WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 100`);
        return r.rows;
    });

    // BACKUP (estimate only - don't run full backup in measurement)
    await run('/api/backup-db (estimate: all ledger rows)', async () => {
        const r = await pool.query(`SELECT id, customer_id, type, reference_date, kg, price_per_kg, amount, previous_debt, new_debt, note, created_at FROM "Ledger" WHERE deleted_at IS NULL`);
        return r.rows;
    });

    console.log("\n=== SUMMARY ===");
    const total = results.reduce((s, r) => s + r.bytes, 0);
    console.log(`Total measured across all endpoints: ${(total/1024).toFixed(2)} KB`);
    const largest = [...results].sort((a, b) => b.bytes - a.bytes).slice(0, 5);
    console.log("\nTop 5 largest endpoints:");
    largest.forEach(r => console.log(`  ${r.label}: ${r.kb} KB`));
    
    await pool.end();
}

measure().catch(console.error);
