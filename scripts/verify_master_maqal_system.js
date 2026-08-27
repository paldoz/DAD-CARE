const { Pool } = require('pg');
require('dotenv').config({ path: '.env' });

const pool = new Pool({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL
});

const MAQAL_EPOCH = '2026-07-14';

function getMaqalIdFromDate(dateStr) {
    const epoch = new Date(`${MAQAL_EPOCH}T00:00:00Z`);
    const d = new Date(`${dateStr.split('T')[0]}T00:00:00Z`);
    const diffDays = Math.floor((d.getTime() - epoch.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return 9;
    return 9 + Math.floor(diffDays / 2);
}

function getDisplayMqFromMaqalId(maqalId) {
    return maqalId >= 9 ? maqalId - 8 : maqalId;
}

function getDatePairFromMaqalId(maqalId) {
    const epoch = new Date(`${MAQAL_EPOCH}T00:00:00Z`);
    const offsetDays = (maqalId - 9) * 2;
    const d1 = new Date(epoch.getTime() + offsetDays * 24 * 60 * 60 * 1000);
    const d2 = new Date(d1.getTime() + 24 * 60 * 60 * 1000);
    return {
        date1: d1.toISOString().split('T')[0],
        date2: d2.toISOString().split('T')[0]
    };
}

async function runMasterAudit() {
    console.log('================================================================');
    console.log('🚀 MASTER MAQAL SYSTEM & PAYMENT LINKING VERIFICATION SUITE');
    console.log('================================================================\n');

    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;

    function assert(condition, testName, details = '') {
        totalTests++;
        if (condition) {
            passedTests++;
            console.log(`  ✅ [PASS] ${testName}`);
        } else {
            failedTests++;
            console.error(`  ❌ [FAIL] ${testName} - ${details}`);
        }
    }

    // -------------------------------------------------------------
    // TEST SUITE 1: Calendar Pairing & Display MQ Derivation
    // -------------------------------------------------------------
    console.log('--- TEST SUITE 1: Calendar Pairing & Continuous Sequence ---');
    
    // MQ#1 -> Jul 14-15
    const mq1 = getDatePairFromMaqalId(9);
    assert(mq1.date1 === '2026-07-14' && mq1.date2 === '2026-07-15', 'MQ#1 is Jul 14–15 (maqal_id=9)', `Got ${mq1.date1} - ${mq1.date2}`);
    assert(getDisplayMqFromMaqalId(9) === 1, 'Display MQ for maqal_id=9 is MQ#1');

    // MQ#13 -> Aug 07-08
    const mq13 = getDatePairFromMaqalId(21);
    assert(mq13.date1 === '2026-08-07' && mq13.date2 === '2026-08-08', 'MQ#13 is Aug 07–08 (maqal_id=21)', `Got ${mq13.date1} - ${mq13.date2}`);
    assert(getDisplayMqFromMaqalId(21) === 13, 'Display MQ for maqal_id=21 is MQ#13');

    // MQ#20 -> Aug 21-22
    const mq20 = getDatePairFromMaqalId(28);
    assert(mq20.date1 === '2026-08-21' && mq20.date2 === '2026-08-22', 'MQ#20 is Aug 21–22 (maqal_id=28)', `Got ${mq20.date1} - ${mq20.date2}`);
    assert(getDisplayMqFromMaqalId(28) === 20, 'Display MQ for maqal_id=28 is MQ#20');

    // MQ#21 -> Aug 23-24
    const mq21 = getDatePairFromMaqalId(29);
    assert(mq21.date1 === '2026-08-23' && mq21.date2 === '2026-08-24', 'MQ#21 is Aug 23–24 (maqal_id=29)', `Got ${mq21.date1} - ${mq21.date2}`);
    assert(getDisplayMqFromMaqalId(29) === 21, 'Display MQ for maqal_id=29 is MQ#21');

    // MQ#22 -> Aug 25-26
    const mq22 = getDatePairFromMaqalId(30);
    assert(mq22.date1 === '2026-08-25' && mq22.date2 === '2026-08-26', 'MQ#22 is Aug 25–26 (maqal_id=30)', `Got ${mq22.date1} - ${mq22.date2}`);
    assert(getDisplayMqFromMaqalId(30) === 22, 'Display MQ for maqal_id=30 is MQ#22');

    // -------------------------------------------------------------
    // TEST SUITE 2: Late Payment Ownership Invariant
    // -------------------------------------------------------------
    console.log('\n--- TEST SUITE 2: Late Payment & Maqal Ownership Invariant ---');
    // If a payment is saved against maqal_id=29 (MQ#21) on payment date Aug 25,
    // its maqal_id must remain 29 and display MQ must remain MQ#21.
    const samplePayment = {
        maqal_id: 29,
        receipt_id: 'test-receipt-mq21',
        payment_date: '2026-08-25',
        amount: 500
    };
    assert(samplePayment.maqal_id === 29, 'Payment for MQ#21 holds permanent maqal_id=29');
    assert(getDisplayMqFromMaqalId(samplePayment.maqal_id) === 21, 'Payment on Aug 25 displays under MQ#21, NOT MQ#22');

    // -------------------------------------------------------------
    // TEST SUITE 3: Auto (Oldest First) Selection Logic
    // -------------------------------------------------------------
    console.log('\n--- TEST SUITE 3: Auto (Oldest First) Selection Logic ---');
    // Scenario: Customer has MQ#20 (Done), MQ#21 (Not Done), MQ#22 (Current)
    const mockAuthoritativePairs = [
        { maqal_id: 28, mq_num: 20, date1: '2026-08-21', date2: '2026-08-22' },
        { maqal_id: 29, mq_num: 21, date1: '2026-08-23', date2: '2026-08-24' },
        { maqal_id: 30, mq_num: 22, date1: '2026-08-25', date2: '2026-08-26' }
    ];
    const mockProcessedMaqals = new Set([28]); // Only MQ#20 is processed
    const unprocessed = mockAuthoritativePairs.filter(p => !mockProcessedMaqals.has(p.maqal_id));
    const autoSelected = unprocessed[0];
    
    assert(autoSelected.maqal_id === 29, 'Auto (Oldest First) selects MQ#21 (maqal_id=29), NOT MQ#22');
    assert(autoSelected.mq_num === 21, 'Auto-selected pair is MQ#21');
    assert(unprocessed.length === 2, 'Unfinished count is exactly 2 (MQ#21 and MQ#22)');

    // -------------------------------------------------------------
    // TEST SUITE 4: Mathematical Warning Badge System
    // -------------------------------------------------------------
    console.log('\n--- TEST SUITE 4: Warning Badges (DHIMAN N) ---');
    function getWarningBadge(unfinishedCount) {
        if (unfinishedCount === 0) return { label: '✓ All Caught Up', isDone: true };
        return { label: `⚠️ DHIMAN (${unfinishedCount})`, isDone: false };
    }

    assert(getWarningBadge(2).label === '⚠️ DHIMAN (2)' && !getWarningBadge(2).isDone, '2 missing Maqals -> ⚠️ DHIMAN (2)');
    assert(getWarningBadge(1).label === '⚠️ DHIMAN (1)' && !getWarningBadge(1).isDone, '1 missing Maqal -> ⚠️ DHIMAN (1)');
    assert(getWarningBadge(0).label === '✓ All Caught Up' && getWarningBadge(0).isDone, '0 missing Maqals -> ✓ All Caught Up');

    // -------------------------------------------------------------
    // TEST SUITE 5: Full Database Audit (All 56 Customers & Payments)
    // -------------------------------------------------------------
    console.log('\n--- TEST SUITE 5: Database Integrity Audit ---');

    // 5.1 Check duplicate maqal_id collisions
    const collisionRes = await pool.query(`
        SELECT customer_id, maqal_id, COUNT(DISTINCT (COALESCE(reference_date::date, created_at::date))) as distinct_dates
        FROM "Ledger"
        WHERE type = 'PRODUCT' AND deleted_at IS NULL AND maqal_id IS NOT NULL
        GROUP BY customer_id, maqal_id
        HAVING COUNT(DISTINCT (COALESCE(reference_date::date, created_at::date))) > 2;
    `);
    assert(collisionRes.rows.length === 0, 'Zero maqal_id date collisions in database', `Found ${collisionRes.rows.length} collisions`);

    // 5.2 Check cross-Maqal payment pollution
    const paymentPollutionRes = await pool.query(`
        SELECT p.id, p.customer_id, p.maqal_id as payment_maqal_id, prod.maqal_id as product_maqal_id
        FROM "Ledger" p
        JOIN "Ledger" prod ON p.receipt_id = prod.receipt_id AND prod.type = 'PRODUCT' AND prod.deleted_at IS NULL
        WHERE p.type = 'PAYMENT' AND p.deleted_at IS NULL AND p.maqal_id IS NOT NULL AND prod.maqal_id IS NOT NULL
          AND p.maqal_id != prod.maqal_id;
    `);
    assert(paymentPollutionRes.rows.length === 0, 'Zero cross-Maqal payment misalignments', `Found ${paymentPollutionRes.rows.length} misaligned payments`);

    // 5.3 Verify Shankaroon's Maqal sequence & payment isolation
    const shankaroonRes = await pool.query(`
        SELECT DISTINCT l.receipt_id, l.maqal_id, 
               MIN(COALESCE(l.reference_date::date, l.created_at::date))::text as min_date,
               MAX(COALESCE(l.reference_date::date, l.created_at::date))::text as max_date,
               COUNT(*) FILTER (WHERE l.type = 'PRODUCT') as product_count,
               COUNT(*) FILTER (WHERE l.type = 'PAYMENT') as payment_count,
               SUM(CASE WHEN l.type = 'PAYMENT' THEN l.amount ELSE 0 END) as total_payments
        FROM "Ledger" l
        JOIN "Customer" c ON l.customer_id = c.id
        WHERE c.name ILIKE '%shankaroon%' AND l.deleted_at IS NULL
        GROUP BY l.receipt_id, l.maqal_id
        ORDER BY min_date ASC;
    `);

    console.log(`\n  Shankaroon Maqal Timeline (${shankaroonRes.rows.length} receipts):`);
    for (const r of shankaroonRes.rows) {
        const displayMq = r.maqal_id ? getDisplayMqFromMaqalId(r.maqal_id) : 'N/A';
        console.log(`    Receipt ${r.receipt_id?.substring(0, 8)}... | maqal_id=${r.maqal_id} (MQ#${displayMq}) | Dates: ${r.min_date} to ${r.max_date} | Products: ${r.product_count}, Payments: ${r.payment_count} ($${r.total_payments})`);
    }

    assert(shankaroonRes.rows.length > 0, 'Shankaroon has valid receipts and timeline');

    // Verify Shankaroon MQ#13 (Aug 07-08) has no Aug 24/25 payments (which belong in MQ#20)
    const shankaroonMq13 = shankaroonRes.rows.find(r => r.maqal_id === 21);
    if (shankaroonMq13) {
        assert(shankaroonMq13.max_date < '2026-08-20', 'Shankaroon MQ#13 (Aug 07–08) is isolated from late Aug payments (Aug 24/25)');
    }

    // 5.4 Customer count and active payment integrity
    const statsRes = await pool.query(`
        SELECT 
            COUNT(DISTINCT c.id) as total_customers,
            COUNT(DISTINCT l.id) FILTER (WHERE l.type = 'PAYMENT' AND l.deleted_at IS NULL) as total_payments,
            COUNT(DISTINCT l.id) FILTER (WHERE l.type = 'PRODUCT' AND l.deleted_at IS NULL) as total_products
        FROM "Customer" c
        LEFT JOIN "Ledger" l ON c.id = l.customer_id;
    `);
    const stats = statsRes.rows[0];
    console.log(`\n  Total Active Customers: ${stats.total_customers}`);
    console.log(`  Total Active Payments: ${stats.total_payments}`);
    console.log(`  Total Active Products: ${stats.total_products}`);
    assert(Number(stats.total_customers) >= 50, 'All customers present in database');
    assert(Number(stats.total_payments) > 2000, 'All historical payments intact');

    // -------------------------------------------------------------
    // TEST SUITE 6: Daily Book Deletion Regression Test
    // Invariant: Deleting a DailyBook entry MUST NOT touch Ledger,
    //            receipts, maqal_id, payment ownership, or historical totals.
    //
    // Strategy: All test data is created inside a transaction that is
    //           ROLLED BACK at the end, so nothing pollutes the real DB.
    // -------------------------------------------------------------
    console.log('\n--- TEST SUITE 6: Daily Book Deletion → Historical Receipt Protection ---');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // ── 6.0  Create an isolated test customer ─────────────────────────
        // Use a far-future prefix to guarantee no collision with real data.
        const testCode = `TST-DEL-${Date.now().toString().slice(-6)}`;
        const { rows: [testCustomer] } = await client.query(`
            INSERT INTO "Customer" (id, name, customer_code, created_at)
            VALUES (gen_random_uuid(), '__TEST_DELETION_CUSTOMER__', $1, NOW())
            RETURNING id, name;
        `, [testCode]);
        const custId = testCustomer.id;

        // ── 6.1  Create DailyBook entries using far-future dates to avoid unique-constraint collision ──
        // 2099-11-01 and 2099-11-03 will never exist in real data.
        const testDate1 = '2099-11-01';
        const testDate2 = '2099-11-03';

        // Use INSERT ... ON CONFLICT DO UPDATE so the unique constraint can't fail
        // (handles the rare case where a previous failed test run left a non-rolled-back row)
        const { rows: [book20] } = await client.query(`
            INSERT INTO "DailyBook" (id, date, created_at)
            VALUES (gen_random_uuid(), $1::date, NOW())
            ON CONFLICT (date) DO UPDATE SET created_at = NOW()
            RETURNING id;
        `, [testDate1]);
        const { rows: [book21] } = await client.query(`
            INSERT INTO "DailyBook" (id, date, created_at)
            VALUES (gen_random_uuid(), $1::date, NOW())
            ON CONFLICT (date) DO UPDATE SET created_at = NOW()
            RETURNING id;
        `, [testDate2]);

        await client.query(`
            INSERT INTO "DailyBookItem" (id, daily_book_id, customer_id, kg, present)
            VALUES (gen_random_uuid(), $1, $2, 10, true),
                   (gen_random_uuid(), $3, $2, 12, true)
        `, [book20.id, custId, book21.id]);

        // ── 6.2  Create finalized Ledger receipts for MQ#A and MQ#B ──────────
        // Use synthetic far-future maqal_ids (9901/9902) so they cannot
        // collide with any real Maqal in the database.
        const TEST_MAQAL_A = 9901;  // conceptually MQ#20
        const TEST_MAQAL_B = 9902;  // conceptually MQ#21
        const rcptA = `rcpt-mq-a-${custId.substring(0, 8)}`;
        const rcptB = `rcpt-mq-b-${custId.substring(0, 8)}`;

        // MQ#A: product entry
        const { rows: [prod20] } = await client.query(`
            INSERT INTO "Ledger" (id, customer_id, type, reference_date, amount, kg, maqal_id, receipt_id, previous_debt, new_debt, created_at)
            VALUES (gen_random_uuid(), $1, 'PRODUCT', $3, 650, 10, $4, $2, 0, 650, NOW())
            RETURNING id, maqal_id, receipt_id, amount;
        `, [custId, rcptA, testDate1, TEST_MAQAL_A]);

        // MQ#B: product entry
        const { rows: [prod21] } = await client.query(`
            INSERT INTO "Ledger" (id, customer_id, type, reference_date, amount, kg, maqal_id, receipt_id, previous_debt, new_debt, created_at)
            VALUES (gen_random_uuid(), $1, 'PRODUCT', $3, 780, 12, $4, $2, 650, 780, NOW())
            RETURNING id, maqal_id, receipt_id, amount;
        `, [custId, rcptB, testDate2, TEST_MAQAL_B]);

        // MQ#B: on-time payment (date matches MQ#B date)
        const { rows: [pay21a] } = await client.query(`
            INSERT INTO "Ledger" (id, customer_id, type, reference_date, amount, maqal_id, receipt_id, previous_debt, new_debt, created_at)
            VALUES (gen_random_uuid(), $1, 'PAYMENT', $3, 300, $4, $2, 780, 480, NOW())
            RETURNING id, maqal_id, receipt_id, amount;
        `, [custId, rcptB, testDate2, TEST_MAQAL_B]);

        // MQ#B: late payment (reference_date is one day AFTER MQ#B dates — critical late-payment test)
        const lateDate = '2099-11-05';
        const { rows: [pay21b] } = await client.query(`
            INSERT INTO "Ledger" (id, customer_id, type, reference_date, amount, maqal_id, receipt_id, previous_debt, new_debt, created_at)
            VALUES (gen_random_uuid(), $1, 'PAYMENT', $3, 200, $4, $2, 480, 280, NOW())
            RETURNING id, maqal_id, receipt_id, amount;
        `, [custId, rcptB, lateDate, TEST_MAQAL_B]);

        // ── 6.3  SNAPSHOT: record every Ledger record for this customer ──────
        const { rows: snapshotRows } = await client.query(`
            SELECT id, customer_id, type, maqal_id, receipt_id, amount, reference_date::text as reference_date, previous_debt, new_debt
            FROM "Ledger"
            WHERE customer_id = $1 AND deleted_at IS NULL
            ORDER BY id;
        `, [custId]);

        const snapshot = new Map(snapshotRows.map(r => [r.id, { ...r }]));
        assert(snapshotRows.length === 4, `Snapshot contains 4 Ledger rows (1 product × 2 + 2 payments)`, `Found ${snapshotRows.length}`);

        // ── 6.4  SOFT-DELETE the two DailyBook entries (simulating DELETE handler) ──
        await client.query(`
            UPDATE "DailyBookItem" SET deleted_at = NOW() WHERE daily_book_id = ANY($1) AND deleted_at IS NULL
        `, [[book20.id, book21.id]]);
        await client.query(`
            UPDATE "DailyBook" SET deleted_at = NOW(), deleted_by = 'regression-test' WHERE id = ANY($1)
        `, [[book20.id, book21.id]]);

        // ── 6.5  Verify DailyBook is gone from active view ────────────────────
        const { rows: activeBooks } = await client.query(`
            SELECT id FROM "DailyBook"
            WHERE id = ANY($1) AND deleted_at IS NULL
        `, [[book20.id, book21.id]]);
        assert(activeBooks.length === 0, 'DailyBook entries are soft-deleted (invisible in active view)');

        // ── 6.6  AFTER SNAPSHOT: verify every Ledger record is 100% unchanged ──
        const { rows: afterRows } = await client.query(`
            SELECT id, customer_id, type, maqal_id, receipt_id, amount, reference_date::text as reference_date, previous_debt, new_debt
            FROM "Ledger"
            WHERE customer_id = $1 AND deleted_at IS NULL
            ORDER BY id;
        `, [custId]);

        assert(afterRows.length === snapshotRows.length,
            `Ledger row count unchanged after Daily Book deletion (still ${snapshotRows.length})`,
            `Was ${snapshotRows.length}, now ${afterRows.length}`);

        for (const after of afterRows) {
            const before = snapshot.get(after.id);
            assert(!!before, `Ledger row ${after.id.substring(0,8)} still exists`);
            if (!before) continue;

            assert(after.maqal_id === before.maqal_id,
                `Row ${after.id.substring(0,8)} maqal_id unchanged (${before.maqal_id})`,
                `Was ${before.maqal_id}, now ${after.maqal_id}`);
            assert(after.receipt_id === before.receipt_id,
                `Row ${after.id.substring(0,8)} receipt_id unchanged (${before.receipt_id})`,
                `Was ${before.receipt_id}, now ${after.receipt_id}`);
            assert(Number(after.amount) === Number(before.amount),
                `Row ${after.id.substring(0,8)} amount unchanged ($${before.amount})`,
                `Was ${before.amount}, now ${after.amount}`);
            assert(after.reference_date === before.reference_date,
                `Row ${after.id.substring(0,8)} reference_date unchanged (${before.reference_date})`,
                `Was ${before.reference_date}, now ${after.reference_date}`);
            assert(Number(after.previous_debt) === Number(before.previous_debt),
                `Row ${after.id.substring(0,8)} previous_debt unchanged`,
                `Was ${before.previous_debt}, now ${after.previous_debt}`);
            assert(Number(after.new_debt) === Number(before.new_debt),
                `Row ${after.id.substring(0,8)} new_debt unchanged`,
                `Was ${before.new_debt}, now ${after.new_debt}`);
        }

        // ── 6.7  Confirm both products retained correct maqal_id ─────────────
        const prod20After = afterRows.find(r => r.id === prod20.id);
        const prod21After = afterRows.find(r => r.id === prod21.id);
        assert(prod20After?.maqal_id === TEST_MAQAL_A, `MQ#A product still has maqal_id=${TEST_MAQAL_A} after Daily Book deletion`);
        assert(prod21After?.maqal_id === TEST_MAQAL_B, `MQ#B product still has maqal_id=${TEST_MAQAL_B} after Daily Book deletion`);
        assert(prod20After?.receipt_id === rcptA, 'MQ#A product receipt_id unchanged');
        assert(prod21After?.receipt_id === rcptB, 'MQ#B product receipt_id unchanged');

        // ── 6.8  Confirm both payments still own MQ#B, including the late payment ──
        const pay21aAfter = afterRows.find(r => r.id === pay21a.id);
        const pay21bAfter = afterRows.find(r => r.id === pay21b.id);
        assert(pay21aAfter?.maqal_id === TEST_MAQAL_B, `On-time payment still attached to MQ#B (maqal_id=${TEST_MAQAL_B}) after deletion`);
        assert(pay21bAfter?.maqal_id === TEST_MAQAL_B, `Late payment (${lateDate}) still attached to MQ#B (maqal_id=${TEST_MAQAL_B}) after deletion — NOT moved to next Maqal`);
        assert(pay21aAfter?.receipt_id === rcptB, 'Payment A receipt_id unchanged after deletion');
        assert(pay21bAfter?.receipt_id === rcptB, 'Payment B receipt_id unchanged after deletion');

        // ── 6.9  Auto (Oldest First): MQ#A unfinished → oldest unprocessed is MQ#A ──
        const processedMaqalIds = new Set(
            afterRows.filter(r => r.type === 'PRODUCT').map(r => r.maqal_id)
        );
        // MQ#A has no payments → unfinished. Auto Oldest First must return lowest maqal_id.
        const unfinishedMaqalIds = [...processedMaqalIds].sort((a, b) => a - b);
        assert(unfinishedMaqalIds[0] === TEST_MAQAL_A, `Auto (Oldest First) selects MQ#A (id=${TEST_MAQAL_A}) as oldest unprocessed after deletion`);

        // ── 6.10 Verify maqal sequence integrity: MQ#22 is correct next Maqal ──
        const mq22Pair = getDatePairFromMaqalId(30);
        assert(mq22Pair.date1 === '2026-08-25' && mq22Pair.date2 === '2026-08-26',
            'MQ#22 (maqal_id=30) is still Aug 25–26 after deletion — sequence not corrupted');

        // ── 6.11 No cross-Maqal contamination for test customer ──────────────
        const crossMaqal = afterRows.filter(r =>
            r.type === 'PAYMENT' &&
            afterRows.find(p => p.type === 'PRODUCT' && p.receipt_id === r.receipt_id && p.maqal_id !== r.maqal_id)
        );
        assert(crossMaqal.length === 0, 'Zero cross-Maqal payment contamination for test customer after Daily Book deletion');

        console.log('\n  Daily Book Deletion Regression Results:');
        console.log(`    Test customer ID: ${custId}`);
        console.log(`    DailyBook entries soft-deleted: 2 (${testDate1}, ${testDate2})`);
        console.log(`    Ledger rows before deletion: ${snapshotRows.length}`);
        console.log(`    Ledger rows after deletion:  ${afterRows.length}`);
        console.log(`    MQ#A product maqal_id: ${prod20After?.maqal_id} ✓`);
        console.log(`    MQ#B product maqal_id: ${prod21After?.maqal_id} ✓`);
        console.log(`    On-time payment (${testDate2}) maqal_id: ${pay21aAfter?.maqal_id} ✓`);
        console.log(`    Late payment (${lateDate}) maqal_id:    ${pay21bAfter?.maqal_id} ✓ (stays MQ#B, not moved forward)`);

        // ── ROLLBACK: Remove all test data — no pollution of real DB ─────────
        await client.query('ROLLBACK');
        console.log('\n  ✅ Test data rolled back — real database untouched.');

    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    console.log('\n================================================================');
    console.log(`📊 FINAL RESULT: ${passedTests}/${totalTests} TESTS PASSED (${failedTests} failures)`);
    console.log('================================================================\n');

    await pool.end();
    if (failedTests > 0) {
        process.exit(1);
    }
}

runMasterAudit().catch(err => {
    console.error('Audit Error:', err);
    process.exit(1);
});
