const { Pool } = require('pg');

const pool = new Pool({
    connectionString: "postgresql://postgres.omjmjihinxbtilnirsco:ki6pw8TKnb4bqrjC@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
    ssl: { rejectUnauthorized: false }
});

async function main() {
    const books = await pool.query(`
        SELECT db.id, db.date, db.created_at, db.deleted_at, count(dbi.id) as item_count
        FROM "DailyBook" db
        LEFT JOIN "DailyBookItem" dbi ON dbi.daily_book_id = db.id AND dbi.deleted_at IS NULL
        WHERE db.deleted_at IS NULL
        GROUP BY db.id, db.date, db.created_at, db.deleted_at
        ORDER BY db.date ASC
    `);

    console.log("DailyBook entries count:", books.rows.length);
    books.rows.forEach(r => console.log(`${r.date.toISOString().split('T')[0]} | ID: ${r.id} | Items: ${r.item_count} | Created: ${r.created_at}`));

    // Check Ledger product reference dates
    const ledgerDates = await pool.query(`
        SELECT DISTINCT COALESCE(reference_date::date, created_at::date) as l_date
        FROM "Ledger"
        WHERE type = 'PRODUCT' AND deleted_at IS NULL
        ORDER BY l_date ASC
    `);

    console.log("\nDistinct PRODUCT Ledger reference dates (ASC):");
    ledgerDates.rows.forEach(r => console.log(r.l_date.toISOString().split('T')[0]));

    await pool.end();
}

main().catch(console.error);
