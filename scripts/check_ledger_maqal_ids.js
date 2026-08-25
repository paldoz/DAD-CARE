const { Pool } = require('pg');

const pool = new Pool({
    connectionString: "postgresql://postgres.omjmjihinxbtilnirsco:ki6pw8TKnb4bqrjC@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
    ssl: { rejectUnauthorized: false }
});

async function main() {
    const res = await pool.query(`
        SELECT DISTINCT COALESCE(reference_date::date, created_at::date) as l_date, maqal_id, count(*) as count
        FROM "Ledger"
        WHERE type = 'PRODUCT' AND deleted_at IS NULL
        GROUP BY l_date, maqal_id
        ORDER BY l_date ASC, maqal_id ASC
    `);

    console.log("Product dates and their maqal_ids:");
    res.rows.forEach(r => console.log(`${r.l_date.toISOString().split('T')[0]} | maqal_id: ${r.maqal_id} | count: ${r.count}`));

    await pool.end();
}

main().catch(console.error);
