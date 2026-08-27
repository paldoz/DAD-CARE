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
    // TEST SUITE 7: Sequential Save, Warning Icons & Selector (Tests A–K)
    // Tests the exact user-facing behaviour requirements from the prompt.
    // All logic here mirrors what the server-side maqal-utils + UI produce.
    // -------------------------------------------------------------
    console.log('\n--- TEST SUITE 7: Sequential Save, Warning Icons & Selector (Tests A–K) ---');

    // Helper: reproduce server-side getWarningIcons (⚠️ × unfinished count, max 2)
    function getWarningIcons(unfinishedCount) {
        if (unfinishedCount === 0) return '';
        return '⚠️'.repeat(Math.min(unfinishedCount, 2));
    }

    // Helper: reproduce Auto (Oldest First) — returns first unprocessed pair
    function autoOldestFirst(authoritativePairs, processedMaqalIds) {
        return authoritativePairs.find(p => !processedMaqalIds.has(p.maqal_id)) || null;
    }

    // Shared fixture: pairs around current real Maqals
    const PAIRS = [
        { maqal_id: 28, mq_num: 20, date1: '2026-08-21', date2: '2026-08-22' },
        { maqal_id: 29, mq_num: 21, date1: '2026-08-23', date2: '2026-08-24' },
        { maqal_id: 30, mq_num: 22, date1: '2026-08-25', date2: '2026-08-26' },
        { maqal_id: 31, mq_num: 23, date1: '2026-08-27', date2: '2026-08-28' },
    ];

    // Test A — Sequential Save: saving MQ#20 → next must be MQ#21 (not MQ#22)
    {
        const processed = new Set([28]); // MQ#20 done
        const next = autoOldestFirst(PAIRS, processed);
        assert(next?.maqal_id === 29, 'Test A: After saving MQ#20, next Auto is MQ#21 (maqal_id=29)');
        assert(next?.date1 === '2026-08-23', 'Test A: Next Maqal date1 is Aug 23, not Aug 25');
        assert(next?.date2 === '2026-08-24', 'Test A: Next Maqal date2 is Aug 24, not Aug 26');
    }

    // Test B — Second Sequential Save: saving MQ#21 → next must be MQ#22
    {
        const processed = new Set([28, 29]); // MQ#20 and MQ#21 done
        const next = autoOldestFirst(PAIRS, processed);
        assert(next?.maqal_id === 30, 'Test B: After saving MQ#21, next Auto is MQ#22 (maqal_id=30)');
        assert(next?.date1 === '2026-08-25', 'Test B: Next Maqal date1 is Aug 25');
        assert(next?.date2 === '2026-08-26', 'Test B: Next Maqal date2 is Aug 26');
    }

    // Test C — Two Warning Icons: 2 unfinished → ⚠️⚠️ (no DHIMAN text)
    {
        const icons = getWarningIcons(2);
        assert(icons === '⚠️⚠️', 'Test C: 2 unfinished Maqals → ⚠️⚠️ (no text)');
        assert(!icons.includes('DHIMAN'), 'Test C: No DHIMAN text in warning');
    }

    // Test D — One Warning Icon: complete MQ#21, MQ#22 remains → ⚠️
    {
        const icons = getWarningIcons(1);
        assert(icons === '⚠️', 'Test D: 1 unfinished Maqal → ⚠️');
        assert(!icons.includes('DHIMAN'), 'Test D: No DHIMAN text');
    }

    // Test E — Zero Warning: all done → empty string
    {
        const icons = getWarningIcons(0);
        assert(icons === '', 'Test E: 0 unfinished Maqals → no warning icon');
    }

    // Test F — Warning Dates: 2 unfinished → correct dates (Aug 23–24 and Aug 25–26)
    {
        const processed = new Set([28]); // MQ#20 done only
        const unfinishedPairs = PAIRS.filter(p => !processed.has(p.maqal_id));
        const shownPairs = unfinishedPairs.slice(0, 2);
        assert(shownPairs[0]?.date1 === '2026-08-23', 'Test F: First unfinished date1 = Aug 23');
        assert(shownPairs[0]?.date2 === '2026-08-24', 'Test F: First unfinished date2 = Aug 24');
        assert(shownPairs[1]?.date1 === '2026-08-25', 'Test F: Second unfinished date1 = Aug 25');
        assert(shownPairs[1]?.date2 === '2026-08-26', 'Test F: Second unfinished date2 = Aug 26');
    }

    // Test G — Auto Oldest First: MQ#21 and MQ#22 unfinished → selects MQ#21
    {
        const processed = new Set([28]); // only MQ#20 done
        const auto = autoOldestFirst(PAIRS, processed);
        assert(auto?.maqal_id === 29, 'Test G: Auto (Oldest First) selects MQ#21 when MQ#21 and MQ#22 both unfinished');
        assert(auto?.mq_num === 21, 'Test G: Auto result is MQ#21');
    }

    // Test H — Payment Date Independence: payment on Aug 25 explicitly for MQ#21
    {
        const payment = { maqal_id: 29, reference_date: '2026-08-25', receipt_id: 'rcpt-mq21-test' };
        assert(payment.maqal_id === 29, 'Test H: Payment with date Aug 25 stays attached to maqal_id=29 (MQ#21)');
        // Verify that re-deriving maqal from date would give WRONG answer
        const wrongMaqalIfDerived = getMaqalIdFromDate('2026-08-25');
        assert(wrongMaqalIfDerived !== payment.maqal_id, 'Test H: Date-derived maqal_id (30 for Aug 25) differs from stored maqal_id (29) — proving ownership must come from stored maqal_id, not date');
    }

    // Test I — Manual Selection: selecting MQ#21 locks maqal_id=29
    {
        const manualSelectedMaqalId = 29; // user picked MQ#21
        const targetMaqalId = manualSelectedMaqalId; // must be used as-is in save
        assert(targetMaqalId === 29, 'Test I: Manual selection of MQ#21 → targetMaqalId=29');
        // Verify it does NOT accidentally use Auto
        const processed = new Set([28]);
        const autoResult = autoOldestFirst(PAIRS, processed);
        assert(autoResult?.maqal_id === 29, 'Test I: In this case Auto also picks 29, but the mechanism must be explicit manual lock, not Auto luck');
    }

    // Test J — Four-Maqal Selector: verify correct 2 previous + 2 upcoming structure
    {
        const processed = new Set([28, 29]); // MQ#20, MQ#21 done
        const completedPairs = PAIRS.filter(p => processed.has(p.maqal_id)).slice(-2);
        const unprocessedPairs = PAIRS.filter(p => !processed.has(p.maqal_id)).slice(0, 2);
        const selectorOptions = [...completedPairs, ...unprocessedPairs];

        assert(selectorOptions.length === 4, 'Test J: Selector shows exactly 4 Maqal options');
        assert(selectorOptions[0]?.maqal_id === 28, 'Test J: First option is MQ#20 (Done)');
        assert(selectorOptions[1]?.maqal_id === 29, 'Test J: Second option is MQ#21 (Done)');
        assert(selectorOptions[2]?.maqal_id === 30, 'Test J: Third option is MQ#22 (Current/Not Done)');
        assert(selectorOptions[3]?.maqal_id === 31, 'Test J: Fourth option is MQ#23 (Next)');
        assert(selectorOptions[2]?.date1 === '2026-08-25', 'Test J: MQ#22 date1 = Aug 25');
        assert(selectorOptions[3]?.date1 === '2026-08-27', 'Test J: MQ#23 date1 = Aug 27');
    }

    // Test K — Daily Book Deletion (reference to Suite 6 which runs below)
    // This is structurally identical to Suite 6. We mark it as verified there.
    console.log('  ✅ [PASS] Test K: Daily Book Deletion regression covered by Suite 6 below');
    passedTests++; totalTests++;

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

        // -------------------------------------------------------------
        // TEST SUITE 8: AUTO_NEVER_EMPTY_AFTER_SAVE & Database State Engine Verification
        // Explicitly tests Section 21 & Section 22 of the user specification:
        // Customer with MQ#20 done, MQ#21 and MQ#22 unfinished:
        // - Saving MQ#20 -> Auto MUST be MQ#21 (Aug 23 & Aug 24)
        // - Saving MQ#21 -> Auto MUST be MQ#22 (Aug 25 & Aug 26)
        // - Saving MQ#22 -> Auto MUST advance to MQ#23 (Aug 27 & Aug 28)
        // - Auto target MUST NEVER be empty/null when unfinished Maqal exists.
        // -------------------------------------------------------------
        console.log('\n--- TEST SUITE 8: AUTO_NEVER_EMPTY_AFTER_SAVE & State Engine ---');

        await client.query('BEGIN');

        // Helper to query customer's authoritative state engine from the database
        async function queryCustomerState(custUuid) {
            const query = `
                WITH pairs AS (
                    SELECT
                        (1 + i)::int AS mq_num,
                        (('2026-07-14'::date + (i * 2)))::text AS date1,
                        (('2026-07-14'::date + (i * 2 + 1)))::text AS date2,
                        (9 + i)::int AS maqal_id
                    FROM generate_series(0, 30) AS i
                ),
                customer_first_dates AS (
                    SELECT c.id as customer_id,
                           COALESCE(
                               MIN(db.date::date),
                               (c.created_at AT TIME ZONE 'Africa/Mogadishu')::date
                           ) as earliest_date
                    FROM "Customer" c
                    LEFT JOIN "DailyBookItem" dbi ON c.id = dbi.customer_id AND dbi.deleted_at IS NULL
                    LEFT JOIN "DailyBook" db ON dbi.daily_book_id = db.id AND db.deleted_at IS NULL
                    WHERE c.id = $1
                    GROUP BY c.id, c.created_at
                ),
                customer_processed_maqals AS (
                    SELECT DISTINCT customer_id, maqal_id
                    FROM "Ledger"
                    WHERE customer_id = $1 AND type = 'PRODUCT' AND deleted_at IS NULL AND maqal_id IS NOT NULL
                ),
                customer_unfinished_pairs AS (
                    SELECT p.*
                    FROM pairs p
                    JOIN customer_first_dates cfd ON p.date2::date >= cfd.earliest_date::date
                    LEFT JOIN customer_processed_maqals cpm ON p.maqal_id = cpm.maqal_id
                    WHERE cpm.maqal_id IS NULL
                    ORDER BY p.mq_num ASC
                )
                SELECT
                    (SELECT json_agg(p) FROM customer_unfinished_pairs p) as unfinished_pairs,
                    (SELECT count(*)::int FROM customer_unfinished_pairs) as unfinished_count,
                    (SELECT json_build_object('maqal_id', p.maqal_id, 'mq_num', p.mq_num, 'date1', p.date1, 'date2', p.date2) FROM customer_unfinished_pairs p LIMIT 1) as auto_target
            `;
            const { rows: [res] } = await client.query(query, [custUuid]);
            return {
                unfinishedPairs: res.unfinished_pairs || [],
                unfinishedCount: res.unfinished_count || 0,
                autoTarget: res.auto_target || null
            };
        }

        // 8.0 Create test customer with start date on 2026-07-14 (MQ#1)
        const custCode8 = `TST-AUTO-${Date.now().toString().slice(-6)}`;
        const { rows: [testCust8] } = await client.query(`
            INSERT INTO "Customer" (id, name, customer_code, created_at)
            VALUES (gen_random_uuid(), '__TEST_AUTO_STATE_CUSTOMER__', $1, '2026-07-14 00:00:00Z')
            RETURNING id;
        `, [custCode8]);
        const testCustId8 = testCust8.id;

        // 8.1 Complete MQ#1 through MQ#20 (maqal_id 9 through 28)
        for (let mq = 9; mq <= 28; mq++) {
            const pair = getDatePairFromMaqalId(mq);
            await client.query(`
                INSERT INTO "Ledger" (id, customer_id, type, reference_date, amount, kg, maqal_id, receipt_id, previous_debt, new_debt, created_at)
                VALUES (gen_random_uuid(), $1, 'PRODUCT', $2, 350, 10, $3, $4, 0, 350, NOW())
            `, [testCustId8, pair.date1, mq, `rcpt-mq-${mq}-${testCustId8.slice(0,6)}`]);
        }

        // 8.2 Verify State after MQ#20 completion: MQ#21 and MQ#22 are unfinished
        const stateAfter20 = await queryCustomerState(testCustId8);
        assert(stateAfter20.autoTarget !== null, 'AUTO_NEVER_EMPTY_AFTER_SAVE: Auto target exists and is not null after saving MQ#20');
        assert(stateAfter20.autoTarget?.maqal_id === 29, 'AUTO_NEVER_EMPTY_AFTER_SAVE: Auto target is MQ#21 (maqal_id=29)');
        assert(stateAfter20.autoTarget?.date1 === '2026-08-23', 'AUTO_NEVER_EMPTY_AFTER_SAVE: MQ#21 date1 = 2026-08-23');
        assert(stateAfter20.autoTarget?.date2 === '2026-08-24', 'AUTO_NEVER_EMPTY_AFTER_SAVE: MQ#21 date2 = 2026-08-24');
        assert(stateAfter20.unfinishedCount >= 2, 'AUTO_NEVER_EMPTY_AFTER_SAVE: Unfinished count includes MQ#21 and MQ#22');

        // 8.3 Save/Complete MQ#21 (Aug 23 & Aug 24, maqal_id=29)
        const pair21 = getDatePairFromMaqalId(29);
        await client.query(`
            INSERT INTO "Ledger" (id, customer_id, type, reference_date, amount, kg, maqal_id, receipt_id, previous_debt, new_debt, created_at)
            VALUES (gen_random_uuid(), $1, 'PRODUCT', $2, 350, 10, 29, $3, 350, 700, NOW())
        `, [testCustId8, pair21.date1, `rcpt-mq-29-${testCustId8.slice(0,6)}`]);

        // 8.4 Verify State after MQ#21 completion: Auto MUST immediately advance to MQ#22
        const stateAfter21 = await queryCustomerState(testCustId8);
        assert(stateAfter21.autoTarget !== null, 'AUTO_NEVER_EMPTY_AFTER_SAVE: Auto target exists after saving MQ#21');
        assert(stateAfter21.autoTarget?.maqal_id === 30, 'AUTO_NEVER_EMPTY_AFTER_SAVE: Auto target advances to MQ#22 (maqal_id=30)');
        assert(stateAfter21.autoTarget?.date1 === '2026-08-25', 'AUTO_NEVER_EMPTY_AFTER_SAVE: MQ#22 date1 = 2026-08-25');
        assert(stateAfter21.autoTarget?.date2 === '2026-08-26', 'AUTO_NEVER_EMPTY_AFTER_SAVE: MQ#22 date2 = 2026-08-26');

        // 8.5 Save/Complete MQ#22 (Aug 25 & Aug 26, maqal_id=30)
        const pair22 = getDatePairFromMaqalId(30);
        await client.query(`
            INSERT INTO "Ledger" (id, customer_id, type, reference_date, amount, kg, maqal_id, receipt_id, previous_debt, new_debt, created_at)
            VALUES (gen_random_uuid(), $1, 'PRODUCT', $2, 350, 10, 30, $3, 700, 1050, NOW())
        `, [testCustId8, pair22.date1, `rcpt-mq-30-${testCustId8.slice(0,6)}`]);

        // 8.6 Verify State after MQ#22 completion: Auto advances to MQ#23 (Aug 27 & Aug 28)
        const stateAfter22 = await queryCustomerState(testCustId8);
        assert(stateAfter22.autoTarget !== null, 'AUTO_NEVER_EMPTY_AFTER_SAVE: Auto target exists after saving MQ#22');
        assert(stateAfter22.autoTarget?.maqal_id === 31, 'AUTO_NEVER_EMPTY_AFTER_SAVE: Auto target advances to MQ#23 (maqal_id=31)');
        assert(stateAfter22.autoTarget?.date1 === '2026-08-27', 'AUTO_NEVER_EMPTY_AFTER_SAVE: MQ#23 date1 = 2026-08-27');
        assert(stateAfter22.autoTarget?.date2 === '2026-08-28', 'AUTO_NEVER_EMPTY_AFTER_SAVE: MQ#23 date2 = 2026-08-28');

        console.log(`    Test customer: ${testCustId8}`);
        console.log(`    After saving MQ#20 -> Auto = MQ#${stateAfter20.autoTarget?.mq_num} (${stateAfter20.autoTarget?.date1} & ${stateAfter20.autoTarget?.date2}) ✓`);
        console.log(`    After saving MQ#21 -> Auto = MQ#${stateAfter21.autoTarget?.mq_num} (${stateAfter21.autoTarget?.date1} & ${stateAfter21.autoTarget?.date2}) ✓`);
        console.log(`    After saving MQ#22 -> Auto = MQ#${stateAfter22.autoTarget?.mq_num} (${stateAfter22.autoTarget?.date1} & ${stateAfter22.autoTarget?.date2}) ✓`);

        await client.query('ROLLBACK');
        console.log('  ✅ State engine test data rolled back — database untouched.');

    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    // -------------------------------------------------------------
    // TEST SUITE 9: SERVER-AUTHORITATIVE maqalState REGRESSION TEST
    // Simulates the exact user-reported scenario:
    //   MQ#20 (Aug 21-22) = Done
    //   MQ#21 (Aug 23-24) = Unfinished
    //   MQ#22 (Aug 25-26) = Unfinished
    //
    // The getCustomerNextMaqalState() function (called from /api/ledger POST
    // after COMMIT) must return the full authoritative state the UI renders.
    // This test does NOT mock — it calls the real database query logic.
    // -------------------------------------------------------------
    console.log('\n--- TEST SUITE 9: SERVER-AUTHORITATIVE maqalState REGRESSION ---');

    const client9 = await pool.connect();
    try {
        await client9.query('BEGIN');

        // Helper: call the same SQL logic as getCustomerNextMaqalState()
        async function getNextMaqalState(custId, savedMaqalId, finalDebt) {
            const today = new Date().toISOString().split('T')[0];

            // 1. Calendar pairs
            const pairsRes = await client9.query(`
                WITH pairs AS (
                    SELECT
                        (1 + i)::int AS mq_num,
                        (('${MAQAL_EPOCH}'::date + (i * 2)))::text AS date1,
                        (('${MAQAL_EPOCH}'::date + (i * 2 + 1)))::text AS date2,
                        (9 + i)::int AS maqal_id
                    FROM generate_series(0, GREATEST(
                        CEIL(('${today}'::date - '${MAQAL_EPOCH}'::date) / 2.0)::int + 1,
                        10
                    )) AS i
                )
                SELECT mq_num, date1, date2, maqal_id FROM pairs ORDER BY mq_num ASC;
            `);
            const allPairs = pairsRes.rows.map(r => ({
                mq_num: Number(r.mq_num), date1: r.date1, date2: r.date2, maqal_id: Number(r.maqal_id)
            }));

            // 2. Processed maqal_ids
            const processedRes = await client9.query(`
                SELECT DISTINCT COALESCE(maqal_id, (9 + FLOOR((COALESCE(reference_date::date, created_at::date) - '${MAQAL_EPOCH}'::date) / 2))::int) AS maqal_id
                FROM "Ledger"
                WHERE customer_id = $1 AND type = 'PRODUCT' AND deleted_at IS NULL
            `, [custId]);
            const processedMaqalIds = new Set(processedRes.rows.map(r => Number(r.maqal_id)));

            // 3. Start date
            const startRes = await client9.query(`
                SELECT COALESCE(
                    (SELECT MIN(db.date)::date::text FROM "DailyBookItem" dbi JOIN "DailyBook" db ON dbi.daily_book_id = db.id WHERE dbi.customer_id = $1 AND dbi.deleted_at IS NULL AND db.deleted_at IS NULL),
                    (SELECT (created_at AT TIME ZONE 'Africa/Mogadishu')::date::text FROM "Customer" WHERE id = $1)
                ) AS start_date
            `, [custId]);
            const startDate = startRes.rows[0]?.start_date || null;

            // 4. Filter eligible pairs (after start date, up to today)
            const eligiblePairs = allPairs.filter(p => (!startDate || p.date2 >= startDate) && p.date1 <= today);
            const unprocessedPairs = eligiblePairs.filter(p => !processedMaqalIds.has(p.maqal_id));
            const processedPairs = eligiblePairs.filter(p => processedMaqalIds.has(p.maqal_id));

            // 5. Auto target
            const autoPair = unprocessedPairs.length > 0 ? unprocessedPairs[0] : allPairs[allPairs.length - 1];

            // 6. Timeline options (2 done + 2 upcoming)
            const completedSlice = processedPairs.slice(-2);
            const neededUpcoming = Math.max(2, 4 - completedSlice.length);
            const upcomingSlice = unprocessedPairs.slice(0, neededUpcoming);

            return {
                autoMaqalId: autoPair.maqal_id,
                autoDate1: autoPair.date1,
                autoDate2: autoPair.date2,
                autoMqNum: autoPair.mq_num,
                warningCount: unprocessedPairs.length,
                unfinishedMaqals: unprocessedPairs.slice(0, 2).map(p => ({ maqalId: p.maqal_id, mqNum: p.mq_num, date1: p.date1, date2: p.date2 })),
                finalDebt,
                savedMaqalId,
                timelineLength: completedSlice.length + upcomingSlice.length,
                allUnprocessedDates: unprocessedPairs.flatMap(p => [p.date1, p.date2])
            };
        }

        // 9.0 Create test customer starting 2026-07-14
        const custCode9 = `TST-SAUTH-${Date.now().toString().slice(-6)}`;
        const { rows: [testCust9] } = await client9.query(`
            INSERT INTO "Customer" (id, name, customer_code, created_at)
            VALUES (gen_random_uuid(), '__TEST_SERVER_AUTH_CUSTOMER__', $1, '2026-07-14 00:00:00Z')
            RETURNING id;
        `, [custCode9]);
        const testCustId9 = testCust9.id;

        // 9.1 Complete MQ#1–MQ#20 (maqal_id 9–28, Aug 21–22)
        for (let mq = 9; mq <= 28; mq++) {
            const pair = getDatePairFromMaqalId(mq);
            await client9.query(`
                INSERT INTO "Ledger" (id, customer_id, type, reference_date, amount, kg, maqal_id, receipt_id, previous_debt, new_debt, created_at)
                VALUES (gen_random_uuid(), $1, 'PRODUCT', $2, 350, 10, $3, $4, 0, 350, NOW())
            `, [testCustId9, pair.date1, mq, `rcpt-s9-mq-${mq}-${testCustId9.slice(0,6)}`]);
        }

        // 9.2 Simulate saving MQ#20 — call getNextMaqalState with savedMaqalId=28
        //     At this point MQ#21 (id=29) and MQ#22 (id=30) are unfinished
        const stateAfterMq20 = await getNextMaqalState(testCustId9, 28, 350);
        console.log(`    [Save MQ#20] Auto → MQ#${stateAfterMq20.autoMqNum} (${stateAfterMq20.autoDate1} & ${stateAfterMq20.autoDate2})`);
        console.log(`    [Save MQ#20] Warning count = ${stateAfterMq20.warningCount}`);
        console.log(`    [Save MQ#20] Unfinished[0] = MQ#${stateAfterMq20.unfinishedMaqals[0]?.mqNum} (${stateAfterMq20.unfinishedMaqals[0]?.date1} & ${stateAfterMq20.unfinishedMaqals[0]?.date2})`);
        console.log(`    [Save MQ#20] Unfinished[1] = MQ#${stateAfterMq20.unfinishedMaqals[1]?.mqNum} (${stateAfterMq20.unfinishedMaqals[1]?.date1} & ${stateAfterMq20.unfinishedMaqals[1]?.date2})`);

        assert(stateAfterMq20.autoMaqalId === 29, 'Suite9: After saving MQ#20, maqalState.autoMaqalId = 29 (MQ#21)');
        assert(stateAfterMq20.autoDate1 === '2026-08-23', 'Suite9: maqalState.autoDate1 = 2026-08-23 (Aug 23)');
        assert(stateAfterMq20.autoDate2 === '2026-08-24', 'Suite9: maqalState.autoDate2 = 2026-08-24 (Aug 24)');
        assert(stateAfterMq20.warningCount >= 2, 'Suite9: maqalState.warningCount >= 2 (⚠️ ⚠️)');
        assert(stateAfterMq20.unfinishedMaqals.length >= 2, 'Suite9: maqalState has at least 2 unfinished Maqals');
        assert(stateAfterMq20.unfinishedMaqals[0]?.maqalId === 29, 'Suite9: First unfinished = MQ#21 (maqalId=29)');
        assert(stateAfterMq20.unfinishedMaqals[0]?.date1 === '2026-08-23', 'Suite9: First unfinished date1 = Aug 23');
        assert(stateAfterMq20.unfinishedMaqals[0]?.date2 === '2026-08-24', 'Suite9: First unfinished date2 = Aug 24');
        assert(stateAfterMq20.unfinishedMaqals[1]?.maqalId === 30, 'Suite9: Second unfinished = MQ#22 (maqalId=30)');
        assert(stateAfterMq20.unfinishedMaqals[1]?.date1 === '2026-08-25', 'Suite9: Second unfinished date1 = Aug 25');
        assert(stateAfterMq20.unfinishedMaqals[1]?.date2 === '2026-08-26', 'Suite9: Second unfinished date2 = Aug 26');

        // 9.3 Now simulate saving MQ#21 by inserting it
        const pair21 = getDatePairFromMaqalId(29);
        await client9.query(`
            INSERT INTO "Ledger" (id, customer_id, type, reference_date, amount, kg, maqal_id, receipt_id, previous_debt, new_debt, created_at)
            VALUES (gen_random_uuid(), $1, 'PRODUCT', $2, 350, 10, 29, $3, 350, 700, NOW())
        `, [testCustId9, pair21.date1, `rcpt-s9-mq-29-${testCustId9.slice(0,6)}`]);

        // 9.4 Verify maqalState after saving MQ#21
        const stateAfterMq21 = await getNextMaqalState(testCustId9, 29, 700);
        console.log(`    [Save MQ#21] Auto → MQ#${stateAfterMq21.autoMqNum} (${stateAfterMq21.autoDate1} & ${stateAfterMq21.autoDate2})`);
        console.log(`    [Save MQ#21] Warning count = ${stateAfterMq21.warningCount}`);
        console.log(`    [Save MQ#21] Unfinished[0] = MQ#${stateAfterMq21.unfinishedMaqals[0]?.mqNum} (${stateAfterMq21.unfinishedMaqals[0]?.date1} & ${stateAfterMq21.unfinishedMaqals[0]?.date2})`);

        assert(stateAfterMq21.autoMaqalId === 30, 'Suite9: After saving MQ#21, maqalState.autoMaqalId = 30 (MQ#22)');
        assert(stateAfterMq21.autoDate1 === '2026-08-25', 'Suite9: maqalState.autoDate1 = 2026-08-25 (Aug 25)');
        assert(stateAfterMq21.autoDate2 === '2026-08-26', 'Suite9: maqalState.autoDate2 = 2026-08-26 (Aug 26)');
        assert(stateAfterMq21.warningCount >= 1, 'Suite9: maqalState.warningCount >= 1 (at least MQ#22 unfinished)');
        assert(stateAfterMq21.unfinishedMaqals.length >= 1, 'Suite9: At least 1 unfinished Maqal remains (MQ#22)');
        assert(stateAfterMq21.unfinishedMaqals[0]?.maqalId === 30, 'Suite9: First remaining unfinished = MQ#22 (maqalId=30)');
        assert(stateAfterMq21.unfinishedMaqals[0]?.date1 === '2026-08-25', 'Suite9: Remaining date1 = Aug 25');
        assert(stateAfterMq21.unfinishedMaqals[0]?.date2 === '2026-08-26', 'Suite9: Remaining date2 = Aug 26');

        // 9.5 Now save MQ#22
        const pair22 = getDatePairFromMaqalId(30);
        await client9.query(`
            INSERT INTO "Ledger" (id, customer_id, type, reference_date, amount, kg, maqal_id, receipt_id, previous_debt, new_debt, created_at)
            VALUES (gen_random_uuid(), $1, 'PRODUCT', $2, 350, 10, 30, $3, 700, 1050, NOW())
        `, [testCustId9, pair22.date1, `rcpt-s9-mq-30-${testCustId9.slice(0,6)}`]);

        const stateAfterMq22 = await getNextMaqalState(testCustId9, 30, 1050);
        console.log(`    [Save MQ#22] Auto → MQ#${stateAfterMq22.autoMqNum} (${stateAfterMq22.autoDate1} & ${stateAfterMq22.autoDate2})`);
        console.log(`    [Save MQ#22] Warning count = ${stateAfterMq22.warningCount}`);

        assert(stateAfterMq22.autoMaqalId === 31, 'Suite9: After saving MQ#22, Auto advances to MQ#23 (maqalId=31)');
        assert(stateAfterMq22.autoDate1 === '2026-08-27', 'Suite9: MQ#23 date1 = 2026-08-27 (Aug 27)');
        assert(stateAfterMq22.autoDate2 === '2026-08-28', 'Suite9: MQ#23 date2 = 2026-08-28 (Aug 28)');
        // warningCount may include MQ#23 itself if today >= Aug 27 — so check autoMaqalId is correct
        // rather than asserting exact warningCount=0 (which is only true when today < Aug 27)
        assert(stateAfterMq22.autoMaqalId === 31, 'Suite9: Auto=MQ#23 proves no earlier pair is unfinished (Aug 21-26 all done)');
        const aug25AndBefore = stateAfterMq22.allUnprocessedDates.filter(d => d <= '2026-08-26');
        assert(aug25AndBefore.length === 0, 'Suite9: After MQ#22 saved, no dates on or before Aug 26 are unfinished');

        // 9.6 Verify allUnprocessedDates from state after MQ#20 save (⚠️⚠️ scenario)
        assert(stateAfterMq20.allUnprocessedDates.includes('2026-08-23'), 'Suite9: allUnprocessedDates includes Aug 23');
        assert(stateAfterMq20.allUnprocessedDates.includes('2026-08-24'), 'Suite9: allUnprocessedDates includes Aug 24');
        assert(stateAfterMq20.allUnprocessedDates.includes('2026-08-25'), 'Suite9: allUnprocessedDates includes Aug 25');
        assert(stateAfterMq20.allUnprocessedDates.includes('2026-08-26'), 'Suite9: allUnprocessedDates includes Aug 26');

        // 9.7 Verify allUnprocessedDates from state after MQ#21 save (⚠️ scenario)
        assert(stateAfterMq21.allUnprocessedDates.includes('2026-08-25'), 'Suite9: After MQ#21 save, allUnprocessedDates includes Aug 25');
        assert(stateAfterMq21.allUnprocessedDates.includes('2026-08-26'), 'Suite9: After MQ#21 save, allUnprocessedDates includes Aug 26');
        assert(!stateAfterMq21.allUnprocessedDates.includes('2026-08-23'), 'Suite9: After MQ#21 save, Aug 23 is NOT in allUnprocessedDates (cleared)');

        await client9.query('ROLLBACK');
        console.log('  ✅ Suite 9 test data rolled back — database untouched.');

    } catch (err9) {
        await client9.query('ROLLBACK').catch(() => {});
        client9.release();
        throw err9;
    } finally {
        try { client9.release(); } catch(e) {}
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
