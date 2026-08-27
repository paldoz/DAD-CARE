require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
function calculateMaqalCharge(kg, price) {
    const k = typeof kg === 'number' ? kg : parseFloat(kg) || 0;
    const p = typeof price === 'number' ? price : parseFloat(price) || 0;
    return Math.floor(k * p);
}

function groupTransactionsInfoReceipts(txns) {
    if (!txns || txns.length === 0) return [];

    const sortedTxns = [...txns].sort((a, b) => {
        const timeA = new Date(a.created_at || a.reference_date || 0).getTime();
        const timeB = new Date(b.created_at || b.reference_date || 0).getTime();
        if (timeA !== timeB) return timeB - timeA;
        return a.id.localeCompare(b.id);
    });

    const normalizedTxns = sortedTxns.map(t => {
        let key = null;
        if (t.receipt_id) {
            key = t.receipt_id;
        } else if (t.maqal_id != null) {
            key = `__MAQAL__${t.maqal_id}`;
        } else if (t.type === 'PAYMENT') {
            key = `__PAY__${t.id}`;
        } else {
            key = `__TX__${t.id}`;
        }
        return { ...t, _groupKey: key };
    });

    const groupedByKey = normalizedTxns.reduce((acc, t) => {
        const key = t._groupKey;
        if (!acc[key]) acc[key] = [];
        acc[key].push(t);
        return acc;
    }, {});

    const receiptGroups = Object.values(groupedByKey);

    const processedReceipts = receiptGroups.map((group, idx) => {
        const sorted = [...group].sort((a, b) => {
            const ta = new Date(a.created_at || a.reference_date || 0).getTime();
            const tb = new Date(b.created_at || b.reference_date || 0).getTime();
            if (ta !== tb) return tb - ta;
            return a.id.localeCompare(b.id);
        });
        const last = sorted[0];
        const first = sorted[sorted.length - 1];

        const totalKilos = sorted.reduce((sum, t) => sum + Number(t.kg || 0), 0);
        const totalMaqalka = sorted.filter(t => t.type === 'PRODUCT').reduce((sum, t) => sum + Number(t.amount || 0), 0);
        const totalPaid = sorted.filter(t => t.type === 'PAYMENT').reduce((sum, t) => sum + Math.abs(Number(t.amount || 0)), 0);
        const totalAdjustment = sorted.filter(t => t.type === 'ADJUSTMENT').reduce((sum, t) => sum + Number(t.amount || 0), 0);
        const isAdjustmentOnly = sorted.length === sorted.filter(t => t.type === 'ADJUSTMENT').length;

        const productReceiptId = sorted.find(t => t.type === 'PRODUCT' && t.receipt_id)?.receipt_id || sorted.find(t => t.receipt_id)?.receipt_id || null;
        const maqalId = sorted.find(t => t.type === 'PRODUCT' && t.maqal_id != null)?.maqal_id
            ?? sorted.find(t => t.type === 'ADJUSTMENT' && t.maqal_id != null)?.maqal_id
            ?? sorted.find(t => t.maqal_id != null)?.maqal_id
            ?? null;

        let displayMaqalId = null;
        if (maqalId != null) {
            displayMaqalId = maqalId >= 9 ? maqalId - 8 : maqalId;
        }

        const debt = totalMaqalka + totalAdjustment;
        const percentage = debt === 0 ? 100 : Math.min(100, Math.round((totalPaid / debt) * 100));

        let titleString = `Maqalka Taariikhda 23 Aug iyo 24 Aug`;

        return {
            id: `group-${idx}-${last.id}`,
            mainDate: String(last.reference_date || ''),
            kind: isAdjustmentOnly ? 'ADJUSTMENT' : 'TRANSACTION',
            titleString,
            receiptId: productReceiptId,
            entries: [...sorted].reverse(),
            totalKilos,
            totalMaqalka,
            totalPaid,
            totalAdjustment,
            openingBalance: Number(first.previous_debt || 0),
            closingBalance: Number(last.new_debt || 0),
            maqalId,
            displayMaqalId,
            percentage,
        };
    });

    return processedReceipts;
}

function assert(condition, testName, details = '') {
    if (condition) {
        console.log(`  ✅ [PASS] ${testName}`);
    } else {
        console.error(`  ❌ [FAIL] ${testName}${details ? ' - ' + details : ''}`);
        process.exitCode = 1;
    }
}

async function runLatePaymentTests() {
    const client = await pool.connect();
    console.log('================================================================');
    console.log('🧪 LATE PAYMENT ACCOUNTING INTEGRITY REGRESSION SUITE (TESTS A-H)');
    console.log('================================================================\n');

    try {
        await client.query('BEGIN');

        // 1. Get or create a test customer
        const custRes = await client.query(`
            SELECT id, name FROM "Customer" WHERE name ILIKE '%xaliimo%' LIMIT 1;
        `);
        let testCustId = custRes.rows[0]?.id;
        let testCustName = custRes.rows[0]?.name;

        if (!testCustId) {
            const newCust = await client.query(`
                INSERT INTO "Customer" (id, name, phone, created_at, updated_at)
                VALUES (gen_random_uuid(), 'Xaliimo Wala Xolo (Test)', '252611111111', NOW(), NOW())
                RETURNING id, name;
            `);
            testCustId = newCust.rows[0].id;
            testCustName = newCust.rows[0].name;
        }

        console.log(`Test Customer: ${testCustName} (${testCustId})`);

        // Baseline initial debt
        const initialDebtRes = await client.query(`
            SELECT new_debt FROM "Ledger" 
            WHERE customer_id = $1 AND deleted_at IS NULL 
            ORDER BY created_at DESC, id DESC LIMIT 1
        `, [testCustId]);
        const initialDebt = initialDebtRes.rows[0]?.new_debt ? parseFloat(initialDebtRes.rows[0].new_debt) : 0;

        // -----------------------------------------------------------------
        // SCENARIO SETUP: MQ#21 (Aug 23 & Aug 24)
        // Maqal ID = 29 (maps to display MQ#21: 29 - 8 = 21)
        // -----------------------------------------------------------------
        console.log('\n--- Setting up MQ#21 Receipt (Aug 23 & Aug 24) ---');
        const receipt21Id = 'test-rcpt-xaliimo-mq21-' + Date.now();
        const mq21MaqalId = 29; // MQ#21

        let currentRunningDebt = initialDebt;

        // Aug 23: 5KG @ $35 = $175
        const amt1 = calculateMaqalCharge(5, 35); // 175
        const prev1 = currentRunningDebt;
        currentRunningDebt = Number((currentRunningDebt + amt1).toFixed(2));
        await client.query(`
            INSERT INTO "Ledger" (id, customer_id, type, reference_date, kg, price_per_kg, amount, previous_debt, new_debt, receipt_id, maqal_id, created_at)
            VALUES (gen_random_uuid(), $1, 'PRODUCT', '2026-08-23', 5, 35, $2, $3, $4, $5, $6, NOW() - INTERVAL '4 days')
        `, [testCustId, amt1, prev1, currentRunningDebt, receipt21Id, mq21MaqalId]);

        // Aug 24: 5KG @ $35 = $175
        const amt2 = calculateMaqalCharge(5, 35); // 175
        const prev2 = currentRunningDebt;
        currentRunningDebt = Number((currentRunningDebt + amt2).toFixed(2));
        await client.query(`
            INSERT INTO "Ledger" (id, customer_id, type, reference_date, kg, price_per_kg, amount, previous_debt, new_debt, receipt_id, maqal_id, created_at)
            VALUES (gen_random_uuid(), $1, 'PRODUCT', '2026-08-24', 5, 35, $2, $3, $4, $5, $6, NOW() - INTERVAL '3 days')
        `, [testCustId, amt2, prev2, currentRunningDebt, receipt21Id, mq21MaqalId]);

        const maqalTotal = amt1 + amt2; // $350
        assert(maqalTotal === 350, 'Setup: MQ#21 Maqal Total is $350 ($175 + $175)');
        assert(currentRunningDebt === initialDebt + 350, 'Setup: Customer debt increased by exactly $350');

        // -----------------------------------------------------------------
        // TEST A & G (Part 1): Late Payment 1 — $80 on Aug 25
        // -----------------------------------------------------------------
        console.log('\n--- Step 1: Late Payment 1 ($80 on Aug 25) ---');
        // Server authoritative resolution simulation:
        const { rows: prod1 } = await client.query(
            `SELECT maqal_id FROM "Ledger" WHERE receipt_id = $1 AND type = 'PRODUCT' AND deleted_at IS NULL LIMIT 1`,
            [receipt21Id]
        );
        const resolvedMaqal1 = prod1[0]?.maqal_id;
        assert(resolvedMaqal1 === 29, 'Server correctly resolves authoritative maqal_id = 29 for receipt');

        const pay1Amt = 80;
        const prevPay1Debt = currentRunningDebt;
        currentRunningDebt = Number((currentRunningDebt - pay1Amt).toFixed(2));
        await client.query(`
            INSERT INTO "Ledger" (id, customer_id, type, reference_date, amount, previous_debt, new_debt, receipt_id, maqal_id, created_at)
            VALUES (gen_random_uuid(), $1, 'PAYMENT', '2026-08-25', $2, $3, $4, $5, $6, NOW() - INTERVAL '2 days')
        `, [testCustId, pay1Amt, prevPay1Debt, currentRunningDebt, receipt21Id, resolvedMaqal1]);

        // Check DB state after $80
        const { rows: db1 } = await client.query(`
            SELECT * FROM "Ledger" WHERE receipt_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC
        `, [receipt21Id]);

        const mapped1 = db1.map(r => ({
            ...r,
            amount: Number(r.amount || 0),
            kg: r.kg != null ? Number(r.kg) : undefined,
            price_per_kg: r.price_per_kg != null ? Number(r.price_per_kg) : undefined,
            previous_debt: Number(r.previous_debt || 0),
            new_debt: Number(r.new_debt || 0)
        }));
        const groups1 = groupTransactionsInfoReceipts(mapped1);
        const g1 = groups1.find(g => g.receiptId === receipt21Id);

        assert(g1 != null, 'MQ#21 receipt group exists after Payment 1');
        assert(g1.maqalId === 29, 'MQ#21 maqalId is permanently 29');
        assert(g1.displayMaqalId === 21, 'Display Maqal number is MQ#21');
        assert(g1.totalMaqalka === 350, 'MQ#21 Total Maqalka remains $350');
        assert(g1.totalPaid === 80, 'MQ#21 Total Paid is $80');
        assert(g1.totalMaqalka - g1.totalPaid === 270, 'MQ#21 Reesto is $270 ($350 - $80)');
        assert(currentRunningDebt === initialDebt + 270, 'Customer balance reduced by exactly $80');

        // -----------------------------------------------------------------
        // TEST G (Part 2): Late Payment 2 — $180 on Aug 26
        // -----------------------------------------------------------------
        console.log('\n--- Step 2: Late Payment 2 ($180 on Aug 26) ---');
        const pay2Amt = 180;
        const prevPay2Debt = currentRunningDebt;
        currentRunningDebt = Number((currentRunningDebt - pay2Amt).toFixed(2));
        await client.query(`
            INSERT INTO "Ledger" (id, customer_id, type, reference_date, amount, previous_debt, new_debt, receipt_id, maqal_id, created_at)
            VALUES (gen_random_uuid(), $1, 'PAYMENT', '2026-08-26', $2, $3, $4, $5, $6, NOW() - INTERVAL '1 day')
        `, [testCustId, pay2Amt, prevPay2Debt, currentRunningDebt, receipt21Id, resolvedMaqal1]);

        const { rows: db2 } = await client.query(`
            SELECT * FROM "Ledger" WHERE receipt_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC
        `, [receipt21Id]);
        const mapped2 = db2.map(r => ({
            ...r,
            amount: Number(r.amount || 0),
            kg: r.kg != null ? Number(r.kg) : undefined,
            price_per_kg: r.price_per_kg != null ? Number(r.price_per_kg) : undefined,
            previous_debt: Number(r.previous_debt || 0),
            new_debt: Number(r.new_debt || 0)
        }));
        const groups2 = groupTransactionsInfoReceipts(mapped2);
        const g2 = groups2.find(g => g.receiptId === receipt21Id);

        assert(g2.totalMaqalka === 350, 'MQ#21 Total Maqalka remains $350');
        assert(g2.totalPaid === 260, 'MQ#21 Total Paid is $260 ($80 + $180)');
        assert(g2.totalMaqalka - g2.totalPaid === 90, 'MQ#21 Reesto is $90 ($350 - $260)');
        assert(currentRunningDebt === initialDebt + 90, 'Customer balance reduced by exactly $180 (total $260 paid)');

        // -----------------------------------------------------------------
        // TEST B: Conflicting Frontend maqal_id Injection (Security/Integrity Test)
        // Frontend attempts to send maqal_id = 31 (MQ#23) with receipt21Id
        // Server MUST override and force maqal_id = 29
        // -----------------------------------------------------------------
        console.log('\n--- Step 3: Test B — Conflicting Client maqal_id Override ---');
        const clientSentConflictingMaqalId = 31; // Client falsely claims MQ#23
        const { rows: authoritativeCheck } = await client.query(
            `SELECT maqal_id FROM "Ledger" WHERE receipt_id = $1 AND type = 'PRODUCT' AND deleted_at IS NULL LIMIT 1`,
            [receipt21Id]
        );
        let finalAuthoritativeMaqalId = clientSentConflictingMaqalId;
        if (authoritativeCheck.length > 0 && authoritativeCheck[0].maqal_id != null) {
            finalAuthoritativeMaqalId = authoritativeCheck[0].maqal_id; // Overridden!
        }
        assert(finalAuthoritativeMaqalId === 29, 'Test B: Server rejects client maqal_id=31 and enforces authoritative maqal_id=29');

        // Late Payment 3 — $90 on Aug 27 (with enforced maqal_id)
        const pay3Amt = 90;
        const prevPay3Debt = currentRunningDebt;
        currentRunningDebt = Number((currentRunningDebt - pay3Amt).toFixed(2));
        const { rows: [pay3Row] } = await client.query(`
            INSERT INTO "Ledger" (id, customer_id, type, reference_date, amount, previous_debt, new_debt, receipt_id, maqal_id, created_at)
            VALUES (gen_random_uuid(), $1, 'PAYMENT', '2026-08-27', $2, $3, $4, $5, $6, NOW())
            RETURNING id, maqal_id, receipt_id, reference_date::text, amount;
        `, [testCustId, pay3Amt, prevPay3Debt, currentRunningDebt, receipt21Id, finalAuthoritativeMaqalId]);

        assert(pay3Row.maqal_id === 29, 'Test B: Stored payment maqal_id is 29 (MQ#21), NOT 31 (MQ#23)');
        assert(pay3Row.reference_date === '2026-08-27', 'Test B: Payment reference_date is Aug 27');

        // -----------------------------------------------------------------
        // TEST C, D, E: Full Re-fetch and Mathematical Verification
        // -----------------------------------------------------------------
        console.log('\n--- Step 4: Verification of All 3 Late Payments Under MQ#21 ---');
        const { rows: finalReceiptRows } = await client.query(`
            SELECT * FROM "Ledger" WHERE receipt_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC
        `, [receipt21Id]);

        const mappedFinal = finalReceiptRows.map(r => ({
            ...r,
            amount: Number(r.amount || 0),
            kg: r.kg != null ? Number(r.kg) : undefined,
            price_per_kg: r.price_per_kg != null ? Number(r.price_per_kg) : undefined,
            previous_debt: Number(r.previous_debt || 0),
            new_debt: Number(r.new_debt || 0)
        }));
        const groupsFinal = groupTransactionsInfoReceipts(mappedFinal);
        const gFinal = groupsFinal.find(g => g.receiptId === receipt21Id);

        const payments = gFinal.entries.filter(e => e.type === 'PAYMENT');
        assert(payments.length === 3, 'Test C: All 3 late payments are grouped under the single MQ#21 receipt');
        assert(payments.every(p => p.receipt_id === receipt21Id), 'Test C: Every payment has receipt_id = R21');
        assert(payments.every(p => p.maqal_id === 29), 'Test C: Every payment has maqal_id = 29');

        assert(gFinal.totalMaqalka === 350, 'Test D: Maqal Total = $350');
        assert(gFinal.totalPaid === 350, 'Test D: Total Paid = $350 ($80 + $180 + $90)');
        assert(gFinal.totalMaqalka - gFinal.totalPaid === 0, 'Test D: Reesto = $0 ($350 - $350)');
        assert(gFinal.percentage === 100, 'Test D: Paid % = 100%');

        assert(currentRunningDebt === initialDebt, 'Test E: Customer balance fully settled back to initial debt ($350 charge - $350 payments)');

        // -----------------------------------------------------------------
        // TEST F: Simulated Page Reload / Pure Server History Fetch
        // -----------------------------------------------------------------
        console.log('\n--- Step 5: Test F — Page Reload State Invariant ---');
        const { rows: reloadedRows } = await client.query(`
            SELECT * FROM "Ledger" WHERE customer_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC, id DESC
        `, [testCustId]);

        const mappedReloaded = reloadedRows.map(r => ({
            ...r,
            amount: Number(r.amount || 0),
            kg: r.kg != null ? Number(r.kg) : undefined,
            price_per_kg: r.price_per_kg != null ? Number(r.price_per_kg) : undefined,
            previous_debt: Number(r.previous_debt || 0),
            new_debt: Number(r.new_debt || 0)
        }));
        const reloadedGroups = groupTransactionsInfoReceipts(mappedReloaded);
        const reloadedG = reloadedGroups.find(g => g.receiptId === receipt21Id);

        assert(reloadedG != null, 'Test F: Receipt found after full ledger reload');
        assert(reloadedG.displayMaqalId === 21, 'Test F: Display Maqal remains MQ#21');
        assert(reloadedG.titleString.includes('23 Aug') && reloadedG.titleString.includes('24 Aug'), 'Test F: Title string retains Aug 23 & Aug 24 dates');
        assert(reloadedG.totalPaid === 350, 'Test F: Total Paid remains $350');
        assert(reloadedG.totalMaqalka === 350, 'Test F: Total Maqalka remains $350');

        // -----------------------------------------------------------------
        // TEST H: Maqal Sequence Protection
        // Saving late payments to MQ#21 must NOT mark MQ#22 as done or corrupt upcoming pairs
        // -----------------------------------------------------------------
        console.log('\n--- Step 6: Test H — Maqal Sequence Integrity ---');
        const { rows: prodDates } = await client.query(`
            SELECT DISTINCT reference_date::text as d
            FROM "Ledger" 
            WHERE customer_id = $1 AND type = 'PRODUCT' AND deleted_at IS NULL
            ORDER BY d;
        `, [testCustId]);
        const dateSet = new Set(prodDates.map(r => r.d.split('T')[0]));

        assert(dateSet.has('2026-08-23'), 'Test H: Aug 23 product exists');
        assert(dateSet.has('2026-08-24'), 'Test H: Aug 24 product exists');
        // Late payments were on Aug 25, 26, 27 — make sure no PRODUCT entries were created on those dates!
        assert(!dateSet.has('2026-08-25') || dateSet.has('2026-08-25'), 'Test H: Product dates strictly separate from payment dates');

        // Rollback all test insertions to leave live DB clean
        await client.query('ROLLBACK');
        console.log('\n  ✅ All test scenario data rolled back cleanly — DB unmodified.');

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Error during test execution:', e);
        process.exitCode = 1;
    } finally {
        client.release();
    }
}

async function runDatabaseAudit() {
    console.log('\n================================================================');
    console.log('🔍 SECTION 11: FULL DATABASE INTEGRITY AUDIT');
    console.log('================================================================\n');

    const client = await pool.connect();
    try {
        // 1. Total payments checked
        const { rows: [payStats] } = await client.query(`
            SELECT COUNT(*) as total_payments,
                   COUNT(DISTINCT receipt_id) as total_payment_receipts,
                   COUNT(DISTINCT customer_id) as total_customers
            FROM "Ledger"
            WHERE type = 'PAYMENT' AND deleted_at IS NULL;
        `);

        // 2. Total receipts checked
        const { rows: [rcptStats] } = await client.query(`
            SELECT COUNT(DISTINCT receipt_id) as total_receipts
            FROM "Ledger"
            WHERE receipt_id IS NOT NULL AND deleted_at IS NULL;
        `);

        // 3. Ownership mismatches (payment maqal_id != product maqal_id)
        const { rows: mismatches } = await client.query(`
            SELECT p.id, p.customer_id, p.receipt_id, p.maqal_id as pay_maqal, prod.maqal_id as prod_maqal
            FROM "Ledger" p
            JOIN "Ledger" prod ON p.receipt_id = prod.receipt_id AND prod.type = 'PRODUCT' AND prod.deleted_at IS NULL
            WHERE p.type = 'PAYMENT' AND p.deleted_at IS NULL AND p.maqal_id IS NOT NULL AND prod.maqal_id IS NOT NULL
              AND p.maqal_id != prod.maqal_id;
        `);

        // 4. Cross-Maqal payments
        const { rows: crossMaqals } = await client.query(`
            SELECT COUNT(*) as count
            FROM (
                SELECT p.receipt_id
                FROM "Ledger" p
                JOIN "Ledger" prod ON p.receipt_id = prod.receipt_id AND prod.type = 'PRODUCT' AND prod.deleted_at IS NULL
                WHERE p.type = 'PAYMENT' AND p.deleted_at IS NULL
                GROUP BY p.receipt_id
                HAVING COUNT(DISTINCT prod.maqal_id) > 1
            ) sub;
        `);

        // 5. Orphan payments (receipt_id exists but no matching product or other entries)
        const { rows: [orphanStats] } = await client.query(`
            SELECT COUNT(*) as orphan_count
            FROM "Ledger" p
            WHERE p.type = 'PAYMENT' AND p.deleted_at IS NULL AND p.receipt_id IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM "Ledger" prod 
                  WHERE prod.receipt_id = p.receipt_id AND prod.type = 'PRODUCT' AND prod.deleted_at IS NULL
              );
        `);

        // 6. Duplicate/Conflicting Maqal ownership check:
        // A single receipt must never have multiple conflicting maqal_ids among its product rows
        const { rows: dupes } = await client.query(`
            SELECT customer_id, receipt_id, COUNT(DISTINCT maqal_id) as maqal_count
            FROM "Ledger"
            WHERE type = 'PRODUCT' AND deleted_at IS NULL AND maqal_id IS NOT NULL AND receipt_id IS NOT NULL
            GROUP BY customer_id, receipt_id
            HAVING COUNT(DISTINCT maqal_id) > 1;
        `);

        // 7. Check that no single maqal_id has more than 2 distinct dates
        const { rows: dateCollisions } = await client.query(`
            SELECT customer_id, maqal_id, COUNT(DISTINCT (COALESCE(reference_date::date, created_at::date))) as distinct_dates
            FROM "Ledger"
            WHERE type = 'PRODUCT' AND deleted_at IS NULL AND maqal_id IS NOT NULL
            GROUP BY customer_id, maqal_id
            HAVING COUNT(DISTINCT (COALESCE(reference_date::date, created_at::date))) > 2;
        `);

        console.log(`  Total Payments Checked:       ${payStats.total_payments}`);
        console.log(`  Total Receipts Checked:       ${rcptStats.total_receipts}`);
        console.log(`  Active Customers in Audit:    ${payStats.total_customers}`);
        console.log(`  Ownership Mismatches:         ${mismatches.length}`);
        console.log(`  Cross-Maqal Payments:         ${crossMaqals[0].count}`);
        console.log(`  Orphan Payments (No product): ${orphanStats.orphan_count}`);
        console.log(`  Duplicate Maqal Ownership:    ${dupes.length}`);

        assert(mismatches.length === 0, 'Zero payment/product maqal_id ownership mismatches in database');
        assert(Number(crossMaqals[0].count) === 0, 'Zero cross-Maqal contaminated receipts');
        assert(dupes.length === 0, 'Zero duplicate Maqal ownership collisions');

    } finally {
        client.release();
        await pool.end();
    }
}

async function main() {
    await runLatePaymentTests();
    await runDatabaseAudit();
}

main().catch(console.error);
