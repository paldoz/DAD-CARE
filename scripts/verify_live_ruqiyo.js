const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
if (!process.env.DATABASE_URL) {
    require('dotenv').config({ path: '.env' });
}

const pool = new Pool({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL
});

async function verifyLive() {
    console.log('====================================================');
    console.log('🔎 VERIFYING LIVE DATABASE FOR RUQIYO CEJIYE');
    console.log('====================================================');

    const custRes = await pool.query(`SELECT id, name, customer_code FROM "Customer" WHERE name ILIKE '%RUQIYO%'`);
    const ruqiyo = custRes.rows[0];
    console.log('Customer:', ruqiyo.name, '(Code:', ruqiyo.customer_code, 'ID:', ruqiyo.id, ')');

    // 1. Check what /api/customer-daily-entries calculation yields:
    const MAQAL_EPOCH = '2026-07-14';
    const MAQAL_PAIRS_CTE = `
        WITH pairs AS (
            SELECT
                (1 + i)::int AS mq_num,
                (('${MAQAL_EPOCH}'::date + (i * 2)))::date AS date1,
                (('${MAQAL_EPOCH}'::date + (i * 2 + 1)))::date AS date2,
                (9 + i)::int AS maqal_id
            FROM generate_series(0, GREATEST(
                CEIL(((CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Mogadishu')::date - '${MAQAL_EPOCH}'::date) / 2.0)::int + 1,
                COALESCE((SELECT CEIL((MAX(date) - '${MAQAL_EPOCH}'::date) / 2.0)::int FROM "DailyBook" WHERE deleted_at IS NULL), 0),
                COALESCE((SELECT CEIL((MAX(reference_date) - '${MAQAL_EPOCH}'::date) / 2.0)::int FROM "Ledger" WHERE deleted_at IS NULL), 0)
            )) AS i
        )
    `;

    const pairsRes = await pool.query(`
        ${MAQAL_PAIRS_CTE}
        SELECT mq_num, date1::text as date1, date2::text as date2, maqal_id
        FROM pairs
        ORDER BY mq_num ASC;
    `);

    const allPairs = pairsRes.rows.map(r => ({
        mq_num: Number(r.mq_num),
        date1: String(r.date1).split('T')[0],
        date2: String(r.date2).split('T')[0],
        maqal_id: Number(r.maqal_id)
    }));

    const dateToMaqalId = new Map();
    for (const pair of allPairs) {
        dateToMaqalId.set(pair.date1, pair.maqal_id);
        dateToMaqalId.set(pair.date2, pair.maqal_id);
    }

    const processedRes = await pool.query(`
        SELECT DISTINCT
            (reference_date AT TIME ZONE 'Africa/Mogadishu')::date::text AS date_str,
            maqal_id
        FROM "Ledger"
        WHERE customer_id = $1
          AND type = 'PRODUCT'
          AND deleted_at IS NULL
          AND reference_date IS NOT NULL
        ORDER BY date_str ASC
    `, [ruqiyo.id]);

    const processedMaqalIds = new Set();
    for (const row of processedRes.rows) {
        if (row.maqal_id != null && !isNaN(Number(row.maqal_id))) {
            processedMaqalIds.add(Number(row.maqal_id));
        } else {
            const mqFromDate = dateToMaqalId.get(row.date_str);
            if (mqFromDate != null) {
                processedMaqalIds.add(mqFromDate);
            }
        }
    }

    const unprocessedPairs = allPairs.filter(p => !processedMaqalIds.has(p.maqal_id));
    const pairToShow = unprocessedPairs[0];

    const day1Str = pairToShow.date1;
    const day2Str = pairToShow.date2;

    const { rows: items } = await pool.query(`
        SELECT TO_CHAR(db.date, 'YYYY-MM-DD') AS date,
               dbi.kg, dbi.note
        FROM "DailyBookItem" dbi
        JOIN "DailyBook" db ON dbi.daily_book_id = db.id
        WHERE dbi.customer_id = $1
          AND db.date IN ($2::date, $3::date)
          AND dbi.deleted_at IS NULL
          AND db.deleted_at IS NULL
        ORDER BY db.date ASC
    `, [ruqiyo.id, day1Str, day2Str]);

    console.log('\n📅 TARGET PAIR TO DISPLAY:');
    console.log('  MQ Number:', 'MQ#' + (pairToShow.maqal_id - 8));
    console.log('  Date 1:   ', day1Str);
    console.log('  Date 2:   ', day2Str);
    console.log('  Maqal ID: ', pairToShow.maqal_id);

    console.log('\n📦 DAILY BOOK ENTRIES LOADED FOR THIS PAIR:');
    console.table(items);

    console.log('\n⏭ NEXT 3 PAIRS IN THE QUEUE AFTER THIS:');
    console.table(unprocessedPairs.slice(1, 4).map(p => ({
        mq_display: 'MQ#' + (p.maqal_id - 8),
        date1: p.date1,
        date2: p.date2,
        maqal_id: p.maqal_id
    })));

    await pool.end();
}

verifyLive();
