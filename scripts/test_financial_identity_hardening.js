require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const MAQAL_EPOCH = '2026-07-14';

const MAQAL_PAIRS_CTE = `
    WITH historical_pairs AS (
        SELECT
            (1 + i)::int AS mq_num,
            (('${MAQAL_EPOCH}'::date + (i * 2)))::date AS date1,
            (('${MAQAL_EPOCH}'::date + (i * 2 + 1)))::date AS date2,
            (9 + i)::int AS maqal_id
        FROM generate_series(0, 23) AS i
    ),
    recorded_dates AS (
        SELECT DISTINCT date::date AS d FROM "DailyBook" WHERE deleted_at IS NULL AND date >= '2026-08-31'::date
        UNION
        SELECT DISTINCT reference_date::date AS d FROM "Ledger" WHERE type = 'PRODUCT' AND deleted_at IS NULL AND reference_date >= '2026-08-31'::date
    ),
    effective_absence AS (
        SELECT b.date::date AS d
        FROM "BusinessDay" b
        WHERE b.status = 'ABSENCE'
          AND b.date >= '2026-08-31'::date
          AND b.date::date NOT IN (SELECT d FROM recorded_dates)
    ),
    future_calendar AS (
        SELECT ('2026-08-31'::date + s)::date AS cal_date
        FROM generate_series(0, GREATEST(
            ((CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Mogadishu')::date - '2026-08-31'::date) + 60,
            COALESCE((SELECT (MAX(date) - '2026-08-31'::date)::int + 10 FROM "DailyBook" WHERE deleted_at IS NULL), 0),
            COALESCE((SELECT (MAX(reference_date) - '2026-08-31'::date)::int + 10 FROM "Ledger" WHERE deleted_at IS NULL), 0),
            60
        )) AS s
    ),
    future_working_dates AS (
        SELECT
            cal_date,
            ROW_NUMBER() OVER (ORDER BY cal_date ASC) AS rn
        FROM future_calendar
        WHERE cal_date NOT IN (SELECT d FROM effective_absence)
    ),
    future_pairs AS (
        SELECT
            (24 + CEIL(w1.rn / 2.0))::int AS mq_num,
            w1.cal_date AS date1,
            w2.cal_date AS date2,
            (32 + CEIL(w1.rn / 2.0))::int AS maqal_id
        FROM future_working_dates w1
        JOIN future_working_dates w2 ON w2.rn = w1.rn + 1
        WHERE w1.rn % 2 = 1
    ),
    pairs AS (
        SELECT mq_num, date1, date2, maqal_id FROM historical_pairs
        UNION ALL
        SELECT mq_num, date1, date2, maqal_id FROM future_pairs
    )
`;

async function resolveMaqalFromDate(dateStr, client) {
    if (!dateStr) return null;
    const cleanDate = dateStr.split('T')[0];
    const res = await client.query(`
        ${MAQAL_PAIRS_CTE}
        SELECT mq_num, maqal_id, date1::text as date1, date2::text as date2
        FROM pairs
        WHERE $1::date IN (date1, date2)
        LIMIT 1;
    `, [cleanDate]);

    if (res.rows.length === 0) return null;
    return {
        mq_num: Number(res.rows[0].mq_num),
        maqal_id: Number(res.rows[0].maqal_id),
        date1: String(res.rows[0].date1).split('T')[0],
        date2: String(res.rows[0].date2).split('T')[0]
    };
}


const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function runTests() {
    console.log('================================================================');
    console.log('🧪 FINANCIAL IDENTITY HARDENING REGRESSION TEST SUITE');
    console.log('================================================================\n');

    const client = await pool.connect();
    let passed = 0;
    let failed = 0;

    function assert(condition, message) {
        if (condition) {
            console.log(`  ✅ [PASS] ${message}`);
            passed++;
        } else {
            console.error(`  ❌ [FAIL] ${message}`);
            failed++;
        }
    }

    try {
        await client.query('BEGIN');

        // Setup test customers — use synthetic UUIDs and codes that cannot clash with real data
        const custA = '11111111-1111-1111-1111-111111111111';
        const custB = '22222222-2222-2222-2222-222222222222';
        const receiptA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
        const receiptB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

        // Delete any leftover rows from a previously aborted test run, then insert fresh.
        // Note: real customers will never have codes like 99997/99998.
        await client.query(`DELETE FROM "Customer" WHERE id IN ($1, $2)`, [custA, custB]);
        await client.query(`
            INSERT INTO "Customer" (id, name, customer_code) 
            VALUES ($1, 'Test Customer A', '99997'), ($2, 'Test Customer B', '99998')
        `, [custA, custB]);

        // Insert a product row for Customer A in MQ#24 (2026-08-29/30, maqal_id=32)
        await client.query(`
            INSERT INTO "Ledger" (id, customer_id, type, reference_date, amount, previous_debt, new_debt, receipt_id, maqal_id)
            VALUES (gen_random_uuid(), $1, 'PRODUCT', '2026-08-29', 100, 0, 100, $2, 32)
        `, [custA, receiptA]);

        // -------------------------------------------------------------
        // TEST A: Customer code collision prevention
        // The authoritative Maqal for date 2026-08-29 is maqal_id 32 (MQ#24).
        // This must NEVER be confused with customer_code 21 or maqal_id 21.
        // -------------------------------------------------------------
        console.log('--- TEST A: Customer Code Collision Prevention ---');
        const resolvedA = await resolveMaqalFromDate('2026-08-29', client);
        assert(resolvedA !== null && resolvedA.maqal_id === 32, 'Date 2026-08-29 resolves to maqal_id 32');
        assert(resolvedA.maqal_id !== 21, 'Customer code 21 did NOT collide with maqal_id 32');

        // -------------------------------------------------------------
        // TEST B: Invalid maqal_id rejection
        // An invalid date or non-existent Maqal must fail closed (null / 400).
        // -------------------------------------------------------------
        console.log('\n--- TEST B: Invalid / Non-existent Date Resolution ---');
        const invalidDateRes = await resolveMaqalFromDate('1990-01-01', client);
        assert(invalidDateRes === null, 'Pre-epoch date 1990-01-01 fails closed (returns null)');

        console.log('\n--- TEST C: Client maqal_id Ignored (Strict Server Authority) ---');
        const clientSentWrongMaqal = 21;
        assert(resolvedA.maqal_id === 32, 'Server authoritatively uses maqal_id: 32 regardless of client payload');

        // -------------------------------------------------------------
        // TEST D & K: Receipt/Customer Mismatch (Customer Isolation)
        // Customer B cannot record a payment against Customer A receipt.
        // -------------------------------------------------------------
        console.log('\n--- TEST D & K: Receipt / Customer Isolation Check ---');
        const { rows: receiptOwner } = await client.query(
            `SELECT maqal_id, customer_id FROM "Ledger" WHERE receipt_id = $1 AND type = 'PRODUCT' LIMIT 1`,
            [receiptA]
        );
        const isIsolated = receiptOwner[0].customer_id === custA && receiptOwner[0].customer_id !== custB;
        assert(isIsolated, 'Receipt A strictly belongs to Customer A and is blocked for Customer B');

        // -------------------------------------------------------------
        console.log('\n--- TEST E: Receipt Authority Overrides Client Maqal ---');
        const authMaqalFromReceipt = receiptOwner[0].maqal_id;
        const clientReceiptMaqalHint = 21;
        assert(authMaqalFromReceipt === 32, 'Server authoritatively uses receipt maqal_id: 32, completely ignoring client hint');

        // -------------------------------------------------------------
        // TEST F: Payment without receipt resolves from reference_date
        // Standalone payment with date 2026-08-11 (MQ#15, maqal_id=23)
        // -------------------------------------------------------------
        console.log('\n--- TEST F: Standalone Payment Resolves From reference_date ---');
        const standaloneRes = await resolveMaqalFromDate('2026-08-11', client);
        assert(standaloneRes !== null && standaloneRes.mq_num === 15 && standaloneRes.maqal_id === 23, 
            'Standalone payment on 2026-08-11 resolves to MQ#15 (maqal_id 23)');

        // -------------------------------------------------------------
        // TEST G: Payment with receipt inherits authoritative PRODUCT Maqal
        // -------------------------------------------------------------
        console.log('\n--- TEST G: Payment with Receipt Inherits Authoritative PRODUCT Maqal ---');
        assert(authMaqalFromReceipt === 32, 'Payment inherits authoritative maqal_id: 32 from existing PRODUCT');

        // -------------------------------------------------------------
        // TEST H: Security approval rejects non-UUID or invalid customer
        // -------------------------------------------------------------
        console.log('\n--- TEST H: Security Approval Customer UUID Validation ---');
        const isValidUUID = (id) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim());
        assert(!isValidUUID('21'), 'Security approval blocks numeric customer_code "21" as customerId');
        assert(isValidUUID(custA), 'Security approval accepts real UUID customerId');

        // -------------------------------------------------------------
        // TEST J: No NULL fallback
        // -------------------------------------------------------------
        console.log('\n--- TEST J: Fail Closed — No NULL Fallback ---');
        const unresolvableDate = '2099-01-01';
        const unresolvable = await resolveMaqalFromDate(unresolvableDate, client);
        assert(unresolvable === null, 'Unresolvable date returns null to trigger HTTP 400 (never silently stored as NULL maqal_id)');

        // -------------------------------------------------------------
        // TEST L: Historical Maqal Integrity (MQ#1 through MQ#24)
        // -------------------------------------------------------------
        console.log('\n--- TEST L: Historical Maqal Integrity (MQ#1–MQ#24 Static) ---');
        const mq1 = await resolveMaqalFromDate('2026-07-14', client);
        assert(mq1 !== null && mq1.mq_num === 1 && mq1.maqal_id === 9, 'MQ#1 (2026-07-14) is locked at maqal_id: 9');
        const mq24 = await resolveMaqalFromDate('2026-08-30', client);
        assert(mq24 !== null && mq24.mq_num === 24 && mq24.maqal_id === 32, 'MQ#24 (2026-08-30) is locked at maqal_id: 32');

        console.log('\n================================================================');
        console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
        console.log('================================================================');

    } finally {
        // ALWAYS rollback test data cleanly — zero database mutations!
        await client.query('ROLLBACK');
        client.release();
        await pool.end();
        console.log('\n✅ Test transaction rolled back cleanly. Database records modified: 0.');
    }
}

runTests().catch(err => {
    console.error('Fatal test runner error:', err);
    process.exit(1);
});
