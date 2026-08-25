const { Pool } = require('pg');
const pool = new Pool({ 
    connectionString: 'postgresql://postgres.omjmjihinxbtilnirsco:ki6pw8TKnb4bqrjC@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
    ssl: { rejectUnauthorized: false } 
});

const MAQAL_PAIRS_CTE = `
    WITH past_dates AS (
        SELECT DISTINCT date::date AS db_date
        FROM "DailyBook"
        WHERE deleted_at IS NULL
    ),
    numbered_dates AS (
        SELECT db_date,
               ROW_NUMBER() OVER (ORDER BY db_date ASC) as rn
        FROM past_dates
    ),
    pairs AS (
        SELECT n1.db_date::date AS date1, n2.db_date::date AS date2,
               ((n1.rn + 1) / 2)::int AS mq_num
        FROM numbered_dates n1
        JOIN numbered_dates n2 ON n2.rn = n1.rn + 1
        WHERE n1.rn % 2 = 1
    )
`;

async function run() {
    const { rows: pairs } = await pool.query(`
        ${MAQAL_PAIRS_CTE}
        SELECT mq_num, date1::text as date1, date2::text as date2
        FROM pairs ORDER BY mq_num ASC
    `);

    console.log('=== Authoritative DailyBook Pairs ===');
    console.table(pairs);

    const { rows: sampleMqs } = await pool.query(`
        SELECT reference_date, maqal_id, COUNT(*) as count
        FROM "Ledger"
        WHERE deleted_at IS NULL AND maqal_id IS NOT NULL
        GROUP BY reference_date, maqal_id
        ORDER BY reference_date ASC
        LIMIT 40
    `);

    console.log('\n=== Sample Ledger reference_date vs maqal_id ===');
    console.table(sampleMqs.map(r => ({
        ref_date: r.reference_date ? String(r.reference_date).split('T')[0] : 'null',
        maqal_id: r.maqal_id,
        count: r.count
    })));

    await pool.end();
}

run().catch(console.error);
