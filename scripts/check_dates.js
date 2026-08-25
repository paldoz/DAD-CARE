const { Pool } = require('pg');

const pool = new Pool({
    connectionString: "postgresql://postgres.omjmjihinxbtilnirsco:ki6pw8TKnb4bqrjC@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
    ssl: { rejectUnauthorized: false }
});

async function main() {
    // 1. Get all distinct DailyBook dates
    const datesRes = await pool.query(`
        SELECT DISTINCT date::date as db_date
        FROM "DailyBook"
        WHERE deleted_at IS NULL
        ORDER BY db_date ASC
    `);

    const dates = datesRes.rows.map(r => r.db_date.toISOString().split('T')[0]);
    console.log(`Total DailyBook dates in DB: ${dates.length}`);
    console.log("All DailyBook dates (ASC):", dates);

    // 2. Compute pairs ASC
    const pairsAsc = [];
    for (let i = 0; i + 1 < dates.length; i += 2) {
        pairsAsc.push({
            mq_num: pairsAsc.length + 1,
            date1: dates[i],
            date2: dates[i + 1]
        });
    }

    console.log("\nPairs computed ASC (Chronological non-overlapping):");
    pairsAsc.forEach(p => console.log(`MQ#${p.mq_num} -> ${p.date1} - ${p.date2}`));

    if (dates.length % 2 !== 0) {
        console.log(`\nUnpaired trailing date: ${dates[dates.length - 1]} (waiting for next day)`);
    }

    // 3. Compare with query DESC currently in place:
    const queryDescRes = await pool.query(`
        WITH past_dates AS (
            SELECT DISTINCT date::date AS db_date
            FROM "DailyBook"
            WHERE deleted_at IS NULL
        ),
        numbered_dates AS (
            SELECT db_date,
                   ROW_NUMBER() OVER (ORDER BY db_date DESC) AS rn
            FROM past_dates
        ),
        pairs AS (
            SELECT n2.db_date AS date1, n1.db_date AS date2
            FROM numbered_dates n1
            JOIN numbered_dates n2 ON n1.rn = n2.rn - 1
            WHERE n1.rn % 2 = 1
        )
        SELECT
            ROW_NUMBER() OVER (ORDER BY date2 ASC) AS mq_num,
            date1::text,
            date2::text
        FROM pairs
        ORDER BY mq_num ASC
    `);

    console.log("\nPairs currently produced by DESC query:");
    queryDescRes.rows.forEach(r => console.log(`MQ#${r.mq_num} -> ${r.date1.split('T')[0]} - ${r.date2.split('T')[0]}`));

    // 4. Test SQL ASC query
    const queryAscRes = await pool.query(`
        WITH past_dates AS (
            SELECT DISTINCT date::date AS db_date
            FROM "DailyBook"
            WHERE deleted_at IS NULL
        ),
        numbered_dates AS (
            SELECT db_date,
                   ROW_NUMBER() OVER (ORDER BY db_date ASC) AS rn
            FROM past_dates
        ),
        pairs AS (
            SELECT n1.db_date AS date1, n2.db_date AS date2,
                   ((n1.rn + 1) / 2)::int AS mq_num
            FROM numbered_dates n1
            JOIN numbered_dates n2 ON n2.rn = n1.rn + 1
            WHERE n1.rn % 2 = 1
        )
        SELECT mq_num, date1::text, date2::text
        FROM pairs
        ORDER BY mq_num ASC
    `);

    console.log("\nPairs produced by SQL ASC query:");
    queryAscRes.rows.forEach(r => console.log(`MQ#${r.mq_num} -> ${r.date1.split('T')[0]} - ${r.date2.split('T')[0]}`));

    await pool.end();
}

main().catch(console.error);
