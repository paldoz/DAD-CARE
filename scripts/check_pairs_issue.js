const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
if (!process.env.DATABASE_URL) {
    require('dotenv').config({ path: '.env' });
}

const pool = new Pool({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL
});

const MAQAL_EPOCH = '2026-07-14';

const CONTINUOUS_CTE = `
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

async function check() {
    try {
        const cteRes = await pool.query(`
            ${CONTINUOUS_CTE}
            SELECT mq_num, date1::text, date2::text, maqal_id 
            FROM pairs 
            WHERE date1 >= '2026-08-19'
            ORDER BY mq_num ASC;
        `);
        console.log('\nContinuous Calendar from 2026-07-14:');
        console.table(cteRes.rows);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}
check();
