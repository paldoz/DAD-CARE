const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
if (!process.env.DATABASE_URL) {
    require('dotenv').config({ path: '.env' });
}

const pool = new Pool({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL
});

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

async function test() {
    const custRes = await pool.query(`SELECT id, name FROM "Customer" WHERE name ILIKE '%RUQIYO%' OR name ILIKE '%SALEYMAN%' OR name ILIKE '%SUL%'`);
    for (const cust of custRes.rows) {
        console.log('\n====================================');
        console.log('Customer:', cust);
        const customerId = cust.id;

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

    // Map date -> maqal_id (e.g. '2026-08-21' -> 28)
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
    `, [customerId]);

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

    console.log('Processed maqal_ids:', Array.from(processedMaqalIds));

    const unprocessedPairs = allPairs.filter(p => !processedMaqalIds.has(p.maqal_id));
    console.log('\nUnprocessed pairs count:', unprocessedPairs.length);
    console.log('First 5 unprocessed pairs:');
    console.table(unprocessedPairs.slice(0, 5));

    const targetPair = unprocessedPairs[0];
    console.log('\n>>> TARGET PAIR TO SHOW:', targetPair);
    }

    await pool.end();
}
test();
