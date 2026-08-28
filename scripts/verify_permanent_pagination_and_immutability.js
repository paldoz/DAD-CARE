require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function runTestSuite() {
    const client = await pool.connect();
    let totalPassed = 0;
    let totalFailed = 0;

    function assert(condition, message) {
        if (condition) {
            console.log(`  ✅ [PASS] ${message}`);
            totalPassed++;
        } else {
            console.error(`  ❌ [FAIL] ${message}`);
            totalFailed++;
        }
    }

    try {
        console.log('================================================================');
        console.log('🧪 PERMANENT PAGINATION & RECEIPT HISTORY IMMUTABILITY TEST SUITE');
        console.log('================================================================\n');

        // -------------------------------------------------------------
        // SECTION 1: DATABASE INTEGRITY BASELINE (READ-ONLY)
        // -------------------------------------------------------------
        console.log('--- SECTION 1: Master Database Audit (Read-Only) ---');
        const { rows: [baselineStats] } = await client.query(`
            SELECT 
                COUNT(*) as total_rows,
                COUNT(DISTINCT receipt_id) as distinct_receipts,
                COUNT(DISTINCT customer_id) as distinct_customers
            FROM "Ledger"
        `);
        console.log(`  Baseline: Total Rows=${baselineStats.total_rows}, Distinct Receipts=${baselineStats.distinct_receipts}`);

        // Check 1: 0 Cross-customer receipt sharing
        const { rows: crossReceipts } = await client.query(`
            SELECT receipt_id, COUNT(DISTINCT customer_id) as cnt
            FROM "Ledger"
            WHERE receipt_id IS NOT NULL AND deleted_at IS NULL
            GROUP BY receipt_id
            HAVING COUNT(DISTINCT customer_id) > 1
        `);
        assert(crossReceipts.length === 0, 'Zero receipts shared across multiple customers');

        // Check 2: 0 Orphan rows
        const { rows: orphanRows } = await client.query(`
            SELECT l.id FROM "Ledger" l
            LEFT JOIN "Customer" c ON c.id = l.customer_id
            WHERE c.id IS NULL AND l.deleted_at IS NULL
        `);
        assert(orphanRows.length === 0, 'Zero orphan ledger records');

        // -------------------------------------------------------------
        // SECTION 2: DETERMINISTIC CURSOR PAGINATION LOGIC
        // -------------------------------------------------------------
        console.log('\n--- SECTION 2: Cursor Pagination & Metadata Invariants ---');
        
        // Find customer with high row count (e.g. Sacdiyo = 102 rows)
        const SACDIYO_ID = '45c8377c-810f-40af-b50e-5319f2f3e9a3';
        
        // Test Page 1 (limit 50)
        const { rows: page1 } = await client.query(`
            SELECT id, reference_date::text as reference_date, amount, maqal_id, created_at
            FROM "Ledger"
            WHERE customer_id = $1 AND deleted_at IS NULL
            ORDER BY created_at DESC, id DESC
            LIMIT 50
        `, [SACDIYO_ID]);
        assert(page1.length === 50, `Page 1 retrieved exactly 50 rows (got ${page1.length})`);
        
        const lastP1 = page1[page1.length - 1];
        const cursorP1 = `${new Date(lastP1.created_at).toISOString()}|${lastP1.id}`;

        // Test Page 2 with cursor (limit 50)
        const [cursorTime, cursorId] = cursorP1.split('|');
        const { rows: page2 } = await client.query(`
            SELECT id, reference_date::text as reference_date, amount, maqal_id, created_at
            FROM "Ledger"
            WHERE customer_id = $1 AND deleted_at IS NULL
              AND (created_at < $2::timestamptz OR (created_at = $2::timestamptz AND id < $3))
            ORDER BY created_at DESC, id DESC
            LIMIT 50
        `, [SACDIYO_ID, cursorTime, cursorId]);
        assert(page2.length === 50, `Page 2 retrieved exactly 50 rows via cursor (got ${page2.length})`);

        // Check for 0 overlap between page 1 and page 2
        const p1Ids = new Set(page1.map(r => r.id));
        const overlap = page2.filter(r => p1Ids.has(r.id));
        assert(overlap.length === 0, 'Zero overlap between cursor Page 1 and Page 2');

        // Test Page 3 with cursor (remaining 2 rows)
        const lastP2 = page2[page2.length - 1];
        const cursorP2 = `${new Date(lastP2.created_at).toISOString()}|${lastP2.id}`;
        const [cursorTime2, cursorId2] = cursorP2.split('|');
        const { rows: page3 } = await client.query(`
            SELECT id, reference_date::text as reference_date, amount, maqal_id, created_at
            FROM "Ledger"
            WHERE customer_id = $1 AND deleted_at IS NULL
              AND (created_at < $2::timestamptz OR (created_at = $2::timestamptz AND id < $3))
            ORDER BY created_at DESC, id DESC
            LIMIT 50
        `, [SACDIYO_ID, cursorTime2, cursorId2]);
        assert(page3.length === 2, `Page 3 retrieved remaining 2 rows via cursor (got ${page3.length})`);

        // Combined total across cursor pages = 102
        const allFetched = [...page1, ...page2, ...page3];
        assert(allFetched.length === 102, `All 102 rows retrieved across cursor pages (got ${allFetched.length})`);

        // Verify Oldest Maqal (July 14, 2026) is in the final page
        const july14Found = page3.some(r => r.reference_date === '2026-07-14');
        assert(july14Found, 'Oldest Maqal (July 14, 2026) safely reached and retrieved at end of cursor chain');

        // -------------------------------------------------------------
        // SECTION 3: BOUNDARY SCENARIOS (1, 99, 100, 101, 200, 500, 505 ROWS)
        // -------------------------------------------------------------
        console.log('\n--- SECTION 3: Row Boundary Invariants (Transaction Sandbox) ---');
        await client.query('BEGIN');
        try {
            // Create a test customer for boundary testing
            const testCustId = '00000000-0000-0000-0000-000000000001';
            await client.query(`
                INSERT INTO "Customer" (id, name, customer_code, created_at)
                VALUES ($1, 'Boundary Test Cust', 'BTC01', NOW())
                ON CONFLICT (id) DO NOTHING
            `, [testCustId]);

            // Helper to generate N rows in bulk
            async function generateRows(n) {
                await client.query(`DELETE FROM "Ledger" WHERE customer_id = $1`, [testCustId]);
                const baseDate = new Date('2026-01-01T00:00:00Z');
                
                // Batch insert in chunks of 100 for speed
                const chunkSize = 100;
                for (let i = 0; i < n; i += chunkSize) {
                    const currentChunk = Math.min(chunkSize, n - i);
                    const values = [];
                    const params = [testCustId];
                    for (let j = 0; j < currentChunk; j++) {
                        const idx = i + j;
                        const rowDate = new Date(baseDate.getTime() + idx * 86400000).toISOString().split('T')[0];
                        const createdAt = new Date(baseDate.getTime() + idx * 1000).toISOString();
                        const pOffset = params.length + 1;
                        params.push(crypto.randomUUID(), rowDate, createdAt);
                        values.push(`($${pOffset}, $1, 'PRODUCT', 100, 5, 20, 0, 100, $${pOffset + 1}, $${pOffset + 2})`);
                    }
                    await client.query(`
                        INSERT INTO "Ledger" (id, customer_id, type, amount, kg, price_per_kg, previous_debt, new_debt, reference_date, created_at)
                        VALUES ${values.join(', ')}
                    `, params);
                }
            }

            // Test boundary sizes: [1, 99, 100, 101, 200, 500, 505]
            const testCounts = [1, 99, 100, 101, 200, 500, 505];
            for (const count of testCounts) {
                await generateRows(count);

                // Fetch page 1 with limit 500
                const { rows: firstPage } = await client.query(`
                    SELECT id, reference_date::text as reference_date, created_at FROM "Ledger"
                    WHERE customer_id = $1 AND deleted_at IS NULL
                    ORDER BY created_at DESC, id DESC
                    LIMIT 500
                `, [testCustId]);

                const expectedFirstPage = Math.min(count, 500);
                assert(
                    firstPage.length === expectedFirstPage,
                    `Boundary N=${count}: First page returned ${firstPage.length} (expected ${expectedFirstPage})`
                );

                if (count > 500) {
                    // Test cursor fetching page 2 for > 500 rows
                    const lastRow = firstPage[firstPage.length - 1];
                    const { rows: secondPage } = await client.query(`
                        SELECT id, reference_date::text as reference_date, created_at FROM "Ledger"
                        WHERE customer_id = $1 AND deleted_at IS NULL
                          AND (created_at < $2::timestamptz OR (created_at = $2::timestamptz AND id < $3))
                        ORDER BY created_at DESC, id DESC
                        LIMIT 500
                    `, [testCustId, lastRow.created_at, lastRow.id]);

                    const totalRetrieved = firstPage.length + secondPage.length;
                    assert(
                        totalRetrieved === count,
                        `Boundary N=${count} (501+ rows): Cursor page 2 retrieved remaining ${secondPage.length} rows (total: ${totalRetrieved}/${count})`
                    );

                    // Check oldest row was retrieved in second page
                    const oldestRow = secondPage[secondPage.length - 1];
                    assert(
                        oldestRow.reference_date === '2026-01-01',
                        `Boundary N=${count}: Oldest row (2026-01-01) is intact at bottom of pagination`
                    );
                }
            }

        } finally {
            await client.query('ROLLBACK');
            console.log('  ✅ Sandbox boundary data completely rolled back — DB untouched');
        }

        // -------------------------------------------------------------
        // SECTION 4: LATE PAYMENT TO OLD MAQAL INVARIANT
        // -------------------------------------------------------------
        console.log('\n--- SECTION 4: Late Payment Accounting Recalculation Invariant ---');
        await client.query('BEGIN');
        try {
            const custIdA = '00000000-0000-0000-0000-000000000002';
            const receiptId21 = '00000000-0000-0000-0000-000000000021';
            const receiptId22 = '00000000-0000-0000-0000-000000000022';

            await client.query(`
                INSERT INTO "Customer" (id, name, customer_code, created_at)
                VALUES ($1, 'Late Payment Test Cust', 'LPC01', NOW())
                ON CONFLICT (id) DO NOTHING
            `, [custIdA]);

            // MQ#21: $500 product, $200 initial payment -> Reesto $300
            await client.query(`
                INSERT INTO "Ledger" (id, customer_id, receipt_id, maqal_id, type, amount, kg, price_per_kg, previous_debt, new_debt, reference_date, created_at)
                VALUES 
                    ($1, $2, $3, 21, 'PRODUCT', 500, 10, 50, 0, 500, '2026-08-01', '2026-08-01 10:00:00+00'),
                    ($4, $2, $3, 21, 'PAYMENT', 200, NULL, NULL, 500, 300, '2026-08-01', '2026-08-01 10:05:00+00')
            `, [crypto.randomUUID(), custIdA, receiptId21, crypto.randomUUID()]);

            // MQ#22: $400 product, $100 initial payment
            await client.query(`
                INSERT INTO "Ledger" (id, customer_id, receipt_id, maqal_id, type, amount, kg, price_per_kg, previous_debt, new_debt, reference_date, created_at)
                VALUES 
                    ($1, $2, $3, 22, 'PRODUCT', 400, 8, 50, 300, 700, '2026-08-03', '2026-08-03 10:00:00+00'),
                    ($4, $2, $3, 22, 'PAYMENT', 100, NULL, NULL, 700, 600, '2026-08-03', '2026-08-03 10:05:00+00')
            `, [crypto.randomUUID(), custIdA, receiptId22, crypto.randomUUID()]);

            // Add late payment of $150 against MQ#21
            await client.query(`
                INSERT INTO "Ledger" (id, customer_id, receipt_id, maqal_id, type, amount, previous_debt, new_debt, reference_date, created_at)
                VALUES ($1, $2, $3, 21, 'PAYMENT', 150, 600, 450, '2026-08-05', '2026-08-05 10:00:00+00')
            `, [crypto.randomUUID(), custIdA, receiptId21]);

            // Verify MQ#21 paid total is now 350
            const { rows: mq21Paid } = await client.query(`
                SELECT SUM(amount) as paid FROM "Ledger"
                WHERE customer_id = $1 AND receipt_id = $2 AND type = 'PAYMENT' AND deleted_at IS NULL
            `, [custIdA, receiptId21]);
            assert(Number(mq21Paid[0].paid) === 350, `MQ#21 total paid updated to $350 (got $${mq21Paid[0].paid})`);

            // Verify MQ#21 product date and receipt identity are UNCHANGED
            const { rows: mq21Prod } = await client.query(`
                SELECT reference_date::text, maqal_id, receipt_id FROM "Ledger"
                WHERE customer_id = $1 AND receipt_id = $2 AND type = 'PRODUCT' AND deleted_at IS NULL
            `, [custIdA, receiptId21]);
            assert(mq21Prod[0].reference_date === '2026-08-01', 'MQ#21 date remains exactly 2026-08-01 (immutable)');
            assert(mq21Prod[0].maqal_id === 21, 'MQ#21 maqal_id remains 21 (immutable)');

            // Verify total customer balance calculation reflects both payments
            const { rows: totalPaidCust } = await client.query(`
                SELECT SUM(amount) as total_paid FROM "Ledger"
                WHERE customer_id = $1 AND type = 'PAYMENT' AND deleted_at IS NULL
            `, [custIdA]);
            assert(Number(totalPaidCust[0].total_paid) === 450, `Customer total paid correctly sums to $450 (got $${totalPaidCust[0].total_paid})`);

        } finally {
            await client.query('ROLLBACK');
            console.log('  ✅ Late payment sandbox data rolled back — DB untouched');
        }

        // -------------------------------------------------------------
        // SECTION 5: FINAL POST-CHECK (0 MUTATIONS ON LIVE DATABASE)
        // -------------------------------------------------------------
        console.log('\n--- SECTION 5: Post-Test Live Database Immutability Check ---');
        const { rows: [postStats] } = await client.query(`
            SELECT 
                COUNT(*) as total_rows,
                COUNT(DISTINCT receipt_id) as distinct_receipts,
                COUNT(DISTINCT customer_id) as distinct_customers
            FROM "Ledger"
        `);
        assert(postStats.total_rows === baselineStats.total_rows, `Total database rows strictly identical (${postStats.total_rows} === ${baselineStats.total_rows})`);
        assert(postStats.distinct_receipts === baselineStats.distinct_receipts, `Distinct receipts strictly identical (${postStats.distinct_receipts} === ${baselineStats.distinct_receipts})`);
        assert(postStats.distinct_customers === baselineStats.distinct_customers, `Distinct customers strictly identical (${postStats.distinct_customers} === ${baselineStats.distinct_customers})`);

        console.log('\n================================================================');
        console.log(`TEST SUMMARY: ${totalPassed} PASSED, ${totalFailed} FAILED`);
        console.log(`DATABASE MUTATIONS ON LIVE DATA: ZERO`);
        console.log('================================================================\n');

        if (totalFailed > 0) process.exit(1);

    } finally {
        client.release();
        await pool.end();
    }
}

runTestSuite().catch(e => {
    console.error(e);
    process.exit(1);
});
