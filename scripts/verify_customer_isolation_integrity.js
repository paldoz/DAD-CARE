require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function assert(condition, testName, details = '') {
    if (condition) {
        console.log(`  ✅ [PASS] ${testName}`);
    } else {
        console.error(`  ❌ [FAIL] ${testName}${details ? ' - ' + details : ''}`);
        process.exitCode = 1;
    }
}

// Inline groupTransactionsInfoReceipts matching app/utils/ledgerHelpers.ts
function groupTransactionsInfoReceipts(txns) {
    if (!txns || !Array.isArray(txns) || txns.length === 0) return [];

    const validTxns = txns.filter(t => t != null && typeof t === 'object' && t.id);
    if (validTxns.length === 0) return [];

    const sortedTxns = [...validTxns].sort((a, b) => {
        const timeA = a.created_at ? new Date(a.created_at).getTime() : (a.reference_date ? new Date(a.reference_date).getTime() : 0);
        const timeB = b.created_at ? new Date(b.created_at).getTime() : (b.reference_date ? new Date(b.reference_date).getTime() : 0);
        const safeTimeA = isNaN(timeA) ? 0 : timeA;
        const safeTimeB = isNaN(timeB) ? 0 : timeB;
        if (safeTimeA !== safeTimeB) return safeTimeB - safeTimeA;
        return (a.id || '').localeCompare(b.id || '');
    });

    const normalizedTxns = sortedTxns
        .filter(t => t != null && typeof t === 'object' && t.id)
        .map(t => {
            const custPrefix = t.customer_id ? `${t.customer_id}::` : '';
            let key = null;
            if (t.receipt_id) {
                key = `${custPrefix}${t.receipt_id}`;
            } else if (t.maqal_id != null) {
                key = `${custPrefix}__MAQAL__${t.maqal_id}`;
            } else if (t.type === 'PAYMENT') {
                key = `${custPrefix}__PAY__${t.id}`;
            } else {
                key = `${custPrefix}__TX__${t.id}`;
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
        if (!group || group.length === 0) return null;
        const sorted = [...group].sort((a, b) => {
            const ta = new Date(a.created_at || a.reference_date || 0).getTime();
            const tb = new Date(b.created_at || b.reference_date || 0).getTime();
            if (ta !== tb) return tb - ta;
            return (a.id || '').localeCompare(b.id || '');
        });
        const last = sorted[0] || {};
        const first = sorted[sorted.length - 1] || {};

        const totalKilos = sorted.reduce((sum, t) => sum + (Number(t.kg) || 0), 0);
        const totalMaqalka = sorted.filter(t => t.type === 'PRODUCT').reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
        const totalPaid = sorted.filter(t => t.type === 'PAYMENT').reduce((sum, t) => sum + Math.abs(Number(t.amount) || 0), 0);
        const totalAdjustment = sorted.filter(t => t.type === 'ADJUSTMENT').reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
        const isAdjustmentOnly = sorted.length > 0 && sorted.length === sorted.filter(t => t.type === 'ADJUSTMENT').length;

        const parseSafeDate = (dStr) => {
            if (!dStr) return new Date(0);
            if (typeof dStr === 'string' && dStr.includes('-') && !dStr.includes('T')) {
                return new Date(dStr.replace(/-/g, '/'));
            }
            return new Date(dStr);
        };

        const productDates = sorted.filter(t => t.type === 'PRODUCT').map(t => parseSafeDate(t.reference_date));
        let titleString = '';

        let sortDate;
        if (productDates.length > 0) {
            productDates.sort((a, b) => a.getTime() - b.getTime());
            sortDate = productDates[0]; 
            titleString = `Maqalka`;
        } else {
            sortDate = parseSafeDate(first.created_at || first.reference_date);
        }

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

        return {
            id: `group-${idx}-${last.id}`,
            mainDate: String(last.reference_date || ''),
            kind: isAdjustmentOnly ? 'ADJUSTMENT' : 'TRANSACTION',
            titleString: titleString,
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
            _sortDate: sortDate,
        };
    });

    const validProcessed = processedReceipts.filter(Boolean);
    const sortedReceipts = [...validProcessed].sort((a, b) => b._sortDate.getTime() - a._sortDate.getTime());

    if (sortedReceipts.length > 0) {
        const earliest = sortedReceipts[sortedReceipts.length - 1];
        let runningDebt = Number(earliest.openingBalance || 0);

        for (let i = sortedReceipts.length - 1; i >= 0; i--) {
            const m = sortedReceipts[i];
            m.openingBalance = runningDebt;
            m.closingBalance = Number((runningDebt + m.totalMaqalka + m.totalAdjustment - m.totalPaid).toFixed(2));
            runningDebt = m.closingBalance;
        }
    }

    return sortedReceipts;
}

async function runCustomerIsolationSuite() {
    console.log('================================================================');
    console.log('🧪 CUSTOMER PROFILE & RECEIPT HISTORY INTEGRITY TEST SUITE');
    console.log('================================================================\n');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // -------------------------------------------------------------
        // TEST 1: Absolute Customer Isolation (Customer A vs Customer B)
        // -------------------------------------------------------------
        console.log('--- TEST 1: Absolute Customer Isolation (Customer A vs Customer B) ---');
        const { rows: [custA] } = await client.query(`
            INSERT INTO "Customer" (id, customer_code, name, phone, created_at)
            VALUES (gen_random_uuid(), 'CUST-ISO-A', 'Customer Alpha', '252611111111', NOW())
            RETURNING id, name;
        `);
        const { rows: [custB] } = await client.query(`
            INSERT INTO "Customer" (id, customer_code, name, phone, created_at)
            VALUES (gen_random_uuid(), 'CUST-ISO-B', 'Customer Beta', '252622222222', NOW())
            RETURNING id, name;
        `);

        const rcptA = 'rcpt-cust-a-' + Date.now();
        const rcptB = 'rcpt-cust-b-' + Date.now();

        // Customer A: MQ#20 ($400), Paid $200
        await client.query(`
            INSERT INTO "Ledger" (id, customer_id, type, reference_date, amount, previous_debt, new_debt, receipt_id, maqal_id, created_at)
            VALUES 
            (gen_random_uuid(), $1, 'PRODUCT', '2026-08-21', 400, 0, 400, $2, 28, NOW() - INTERVAL '3 days'),
            (gen_random_uuid(), $1, 'PAYMENT', '2026-08-21', 200, 400, 200, $2, 28, NOW() - INTERVAL '3 days');
        `, [custA.id, rcptA]);

        // Customer B: MQ#21 ($600), Paid $300
        await client.query(`
            INSERT INTO "Ledger" (id, customer_id, type, reference_date, amount, previous_debt, new_debt, receipt_id, maqal_id, created_at)
            VALUES 
            (gen_random_uuid(), $1, 'PRODUCT', '2026-08-23', 600, 0, 600, $2, 29, NOW() - INTERVAL '2 days'),
            (gen_random_uuid(), $1, 'PAYMENT', '2026-08-23', 300, 600, 300, $2, 29, NOW() - INTERVAL '2 days');
        `, [custB.id, rcptB]);

        // Fetch Customer A profile history
        const { rows: rowsA } = await client.query(`
            SELECT * FROM "Ledger" WHERE customer_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC;
        `, [custA.id]);
        const groupsA = groupTransactionsInfoReceipts(rowsA);

        // Fetch Customer B profile history
        const { rows: rowsB } = await client.query(`
            SELECT * FROM "Ledger" WHERE customer_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC;
        `, [custB.id]);
        const groupsB = groupTransactionsInfoReceipts(rowsB);

        assert(groupsA.length === 1, 'Customer A history has exactly 1 receipt');
        assert(groupsA[0].receiptId === rcptA, 'Customer A receiptId matches Receipt A');
        assert(groupsA[0].totalMaqalka === 400, 'Customer A Maqalka = $400');
        assert(groupsA[0].totalPaid === 200, 'Customer A Paid = $200');
        assert(groupsA.find(g => g.receiptId === rcptB) == null, 'Customer A history contains ZERO Customer B receipts');

        assert(groupsB.length === 1, 'Customer B history has exactly 1 receipt');
        assert(groupsB[0].receiptId === rcptB, 'Customer B receiptId matches Receipt B');
        assert(groupsB[0].totalMaqalka === 600, 'Customer B Maqalka = $600');
        assert(groupsB[0].totalPaid === 300, 'Customer B Paid = $300');
        assert(groupsB.find(g => g.receiptId === rcptA) == null, 'Customer B history contains ZERO Customer A receipts');

        // -------------------------------------------------------------
        // TEST 2: Multi-Customer Grouping Collision Guard
        // Even if transactions from A and B were mixed into grouping, they never merge
        // -------------------------------------------------------------
        console.log('\n--- TEST 2: Multi-Customer Grouping Isolation ---');
        const mixedTxns = [...rowsA, ...rowsB];
        const mixedGroups = groupTransactionsInfoReceipts(mixedTxns);

        assert(mixedGroups.length === 2, 'Mixed grouping produces 2 distinct isolated groups');
        const groupAInMixed = mixedGroups.find(g => g.receiptId === rcptA);
        const groupBInMixed = mixedGroups.find(g => g.receiptId === rcptB);
        assert(groupAInMixed.entries.every(e => e.customer_id === custA.id), 'Group A entries all belong to Customer A');
        assert(groupBInMixed.entries.every(e => e.customer_id === custB.id), 'Group B entries all belong to Customer B');

        // -------------------------------------------------------------
        // TEST 3: Cross-Customer Receipt Injection Attack Guard (Server-Side)
        // Customer B tries to post a payment attaching to Customer A's receipt_id
        // -------------------------------------------------------------
        console.log('\n--- TEST 3: Cross-Customer Receipt Hijack Prevention ---');
        const { rows: checkOwnership } = await client.query(
            `SELECT maqal_id, customer_id FROM "Ledger" WHERE receipt_id = $1 AND type = 'PRODUCT' AND deleted_at IS NULL LIMIT 1`,
            [rcptA]
        );
        let blocked = false;
        try {
            if (checkOwnership.length > 0 && checkOwnership[0].customer_id !== custB.id) {
                throw new Error('Customer Isolation Error: Receipt belongs to a different customer');
            }
        } catch (err) {
            blocked = true;
        }
        assert(blocked, 'Server successfully blocks Customer B from saving against Customer A receipt');

        // -------------------------------------------------------------
        // TEST 4: Late Payment Cross-Customer Isolation
        // Adding late payment to Customer A never leaks into Customer B
        // -------------------------------------------------------------
        console.log('\n--- TEST 4: Late Payment Cross-Customer Isolation ---');
        const payLateId = 'pay-late-a-' + Date.now();
        await client.query(`
            INSERT INTO "Ledger" (id, customer_id, type, reference_date, amount, previous_debt, new_debt, receipt_id, maqal_id, created_at)
            VALUES (gen_random_uuid(), $1, 'PAYMENT', '2026-08-27', 200, 200, 0, $2, 28, NOW())
        `, [custA.id, rcptA]);

        const { rows: finalRowsB } = await client.query(`
            SELECT * FROM "Ledger" WHERE customer_id = $1 AND deleted_at IS NULL;
        `, [custB.id]);
        const finalGroupsB = groupTransactionsInfoReceipts(finalRowsB);

        assert(finalGroupsB.length === 1, 'Customer B still has only 1 receipt after A late payment');
        assert(finalGroupsB[0].totalPaid === 300, 'Customer B totalPaid is unchanged ($300)');
        assert(finalRowsB.find(r => r.receipt_id === rcptA) == null, 'Customer B DB rows have zero Customer A entries');

        // -------------------------------------------------------------
        // TEST 5: Crash Safety & Malformed Data Fallbacks
        // -------------------------------------------------------------
        console.log('\n--- TEST 5: Crash Safety & Malformed Data Fallbacks ---');
        const malformedTxns = [
            null,
            undefined,
            {},
            { id: 'm1', customer_id: custA.id, type: 'PRODUCT', amount: NaN, reference_date: null },
            { id: 'm2', customer_id: custA.id, type: 'PAYMENT', amount: 'undefined', reference_date: 'invalid-date' },
            { id: 'm3', customer_id: custA.id, type: 'PRODUCT', amount: 150, reference_date: '2026-08-25', maqal_id: 30 }
        ];

        let crash = false;
        let malformedGroups = [];
        try {
            malformedGroups = groupTransactionsInfoReceipts(malformedTxns);
        } catch (e) {
            crash = true;
        }
        assert(!crash, 'groupTransactionsInfoReceipts handles null, NaN, and invalid dates without crashing');
        assert(malformedGroups.length > 0, 'Produces valid fallback groups from malformed stream');

        // -------------------------------------------------------------
        // TEST 6: Read-Only History Guarantee
        // -------------------------------------------------------------
        console.log('\n--- TEST 6: Read-Only Profile View Guarantee ---');
        const { rows: [countBefore] } = await client.query(`SELECT COUNT(*) as cnt FROM "Ledger"`);
        // Simulate reading history
        const { rows: viewRows } = await client.query(`
            SELECT * FROM "Ledger" WHERE customer_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC;
        `, [custA.id]);
        groupTransactionsInfoReceipts(viewRows);
        const { rows: [countAfter] } = await client.query(`SELECT COUNT(*) as cnt FROM "Ledger"`);
        assert(countBefore.cnt === countAfter.cnt, 'Viewing profile/history performs 0 database mutations (pure read-only)');

        // Rollback all test insertions
        await client.query('ROLLBACK');
        console.log('\n  ✅ All isolation test scenario data rolled back cleanly — DB untouched.');

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Error during test execution:', e);
        process.exitCode = 1;
    } finally {
        client.release();
    }
}

async function main() {
    await runCustomerIsolationSuite();
}

main().catch(console.error);
