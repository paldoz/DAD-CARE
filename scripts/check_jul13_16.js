const { Pool } = require('pg');

const pool = new Pool({
    connectionString: "postgresql://postgres.omjmjihinxbtilnirsco:ki6pw8TKnb4bqrjC@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
    ssl: { rejectUnauthorized: false }
});

async function main() {
    // Check Ledger product counts for Jul 13, 14, 15, 16
    const ledgerCounts = await pool.query(`
        SELECT COALESCE(reference_date::date, created_at::date) as l_date, count(*) as count, sum(amount) as total_amount
        FROM "Ledger"
        WHERE type = 'PRODUCT' AND deleted_at IS NULL
        GROUP BY l_date
        ORDER BY l_date ASC
        LIMIT 10
    `);

    console.log("Ledger product entries by date:");
    ledgerCounts.rows.forEach(r => console.log(`${r.l_date.toISOString().split('T')[0]} | count: ${r.count} | amount: $${r.total_amount}`));

    // Check DailyBook items for Jul 13, 14, 15, 16
    const dbCounts = await pool.query(`
        SELECT date::date as db_date, count(dbi.id) as item_count, sum(dbi.kg) as total_kg
        FROM "DailyBook" db
        LEFT JOIN "DailyBookItem" dbi ON dbi.daily_book_id = db.id AND dbi.deleted_at IS NULL
        WHERE db.deleted_at IS NULL
        GROUP BY db_date
        ORDER BY db_date ASC
        LIMIT 10
    `);

    console.log("\nDailyBook entries by date:");
    dbCounts.rows.forEach(r => console.log(`${r.db_date.toISOString().split('T')[0]} | items: ${r.item_count} | kg: ${r.total_kg}`));

    await pool.end();
}

main().catch(console.error);
