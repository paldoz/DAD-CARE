require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
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

    // Sort chronologically newest-first
    const sortedReceipts = [...processedReceipts].sort((a, b) => b._sortDate.getTime() - a._sortDate.getTime());

    // Recalculate running debt across all receipts in chronological order (oldest to newest)
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

    // Calculate sequential displayMaqalId fallback if maqalId was null
    let fallbackCounter = 1;
    for (let i = sortedReceipts.length - 1; i >= 0; i--) {
        const m = sortedReceipts[i];
        if (m.totalMaqalka > 0 && m.displayMaqalId == null) {
            m.displayMaqalId = fallbackCounter;
        }
        if (m.totalMaqalka > 0) {
            fallbackCounter++;
        }
    }

    return sortedReceipts;
}

function assert(condition, testName, details = '') {
    if (condition) {
        console.log(`  ✅ [PASS] ${testName}`);
    } else {
        console.error(`  ❌ [FAIL] ${testName}${details ? ' - ' + details : ''}`);
        process.exitCode = 1;
    }
}

async function runRecalculationTests() {
    const client = await pool.connect();
    console.log('================================================================');
    console.log('🧪 LATE PAYMENT MULTI-MAQAL RUNNING REESTO RECALCULATION SUITE');
    console.log('================================================================\n');

    try {
        await client.query('BEGIN');

        // Setup test customer
        const { rows: [testCust] } = await client.query(`
            INSERT INTO "Customer" (id, customer_code, name, phone, created_at)
            VALUES (gen_random_uuid(), 'CUST-TEST-999', 'Test Recalc Customer', '252699999999', NOW())
            RETURNING id, name;
        `);
        const custId = testCust.id;

        // Baseline initial debt = $880
        const initialDebt = 880;
        await client.query(`
            INSERT INTO "Ledger" (id, customer_id, type, reference_date, amount, previous_debt, new_debt, created_at)
            VALUES (gen_random_uuid(), $1, 'ADJUSTMENT', '2026-08-20', $2, 0, $2, NOW() - INTERVAL '6 days')
        `, [custId, initialDebt]);

        // -------------------------------------------------------------
        // 1. SETUP MQ#21 (Aug 23 & Aug 24)
        // Maqal Total = $350 ($175 + $175)
        // Payments: $80 on Aug 25, $180 on Aug 26
        // -------------------------------------------------------------
        console.log('--- 1. Creating MQ#21 (Aug 23-24) with initial payments ($80 + $180) ---');
        const rcpt21 = 'rcpt-mq21-' + Date.now();
        const mq21MaqalId = 29;

        // Products
        await client.query(`
            INSERT INTO "Ledger" (id, customer_id, type, reference_date, kg, price_per_kg, amount, previous_debt, new_debt, receipt_id, maqal_id, created_at)
            VALUES 
            (gen_random_uuid(), $1, 'PRODUCT', '2026-08-23', 5, 35, 175, 880, 1055, $2, $3, NOW() - INTERVAL '5 days'),
            (gen_random_uuid(), $1, 'PRODUCT', '2026-08-24', 5, 35, 175, 1055, 1230, $2, $3, NOW() - INTERVAL '4 days');
        `, [custId, rcpt21, mq21MaqalId]);

        // Payments
        await client.query(`
            INSERT INTO "Ledger" (id, customer_id, type, reference_date, amount, previous_debt, new_debt, receipt_id, maqal_id, created_at)
            VALUES 
            (gen_random_uuid(), $1, 'PAYMENT', '2026-08-25', 80, 1230, 1150, $2, $3, NOW() - INTERVAL '3 days'),
            (gen_random_uuid(), $1, 'PAYMENT', '2026-08-26', 180, 1150, 970, $2, $3, NOW() - INTERVAL '2 days');
        `, [custId, rcpt21, mq21MaqalId]);

        // -------------------------------------------------------------
        // 2. SETUP MQ#22 (Aug 25 & Aug 26)
        // Maqal Total = $360 ($180 + $180)
        // Payment: $100 on Aug 26
        // (Saved when MQ#21 was only partially paid, so its closing debt was $970 + $360 - $100 = $1,230)
        // -------------------------------------------------------------
        console.log('--- 2. Creating MQ#22 (Aug 25-26) with $100 payment ---');
        const rcpt22 = 'rcpt-mq22-' + Date.now();
        const mq22MaqalId = 30;

        await client.query(`
            INSERT INTO "Ledger" (id, customer_id, type, reference_date, kg, price_per_kg, amount, previous_debt, new_debt, receipt_id, maqal_id, created_at)
            VALUES 
            (gen_random_uuid(), $1, 'PRODUCT', '2026-08-25', 6, 30, 180, 970, 1150, $2, $3, NOW() - INTERVAL '2 days'),
            (gen_random_uuid(), $1, 'PRODUCT', '2026-08-26', 6, 30, 180, 1150, 1330, $2, $3, NOW() - INTERVAL '2 days');
        `, [custId, rcpt22, mq22MaqalId]);

        await client.query(`
            INSERT INTO "Ledger" (id, customer_id, type, reference_date, amount, previous_debt, new_debt, receipt_id, maqal_id, created_at)
            VALUES 
            (gen_random_uuid(), $1, 'PAYMENT', '2026-08-26', 100, 1330, 1230, $2, $3, NOW() - INTERVAL '2 days');
        `, [custId, rcpt22, mq22MaqalId]);

        // Verify state BEFORE the $90 late payment
        const { rows: beforeRows } = await client.query(`
            SELECT * FROM "Ledger" WHERE customer_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC
        `, [custId]);
        const beforeGroups = groupTransactionsInfoReceipts(beforeRows.map(r => ({
            ...r,
            amount: Number(r.amount || 0),
            kg: r.kg != null ? Number(r.kg) : undefined,
            price_per_kg: r.price_per_kg != null ? Number(r.price_per_kg) : undefined,
            previous_debt: Number(r.previous_debt || 0),
            new_debt: Number(r.new_debt || 0)
        })));

        const b21 = beforeGroups.find(g => g.receiptId === rcpt21);
        const b22 = beforeGroups.find(g => g.receiptId === rcpt22);

        console.log(`\n  BEFORE LATE PAYMENT:`);
        console.log(`    MQ#21: Maqalka=$${b21.totalMaqalka}, Paid=$${b21.totalPaid}, Reesto=$${b21.totalMaqalka - b21.totalPaid}, Closing=$${b21.closingBalance}`);
        console.log(`    MQ#22: Maqalka=$${b22.totalMaqalka}, Paid=$${b22.totalPaid}, Reesto=$${b22.totalMaqalka - b22.totalPaid}, Closing=$${b22.closingBalance}`);

        assert(b21.totalMaqalka === 350, 'Before: MQ#21 Maqal Total = $350');
        assert(b21.totalPaid === 260, 'Before: MQ#21 Total Paid = $260');
        assert(b21.totalMaqalka - b21.totalPaid === 90, 'Before: MQ#21 Reesto = $90');
        assert(b22.closingBalance === 1230, 'Before: MQ#22 Closing Running Balance = $1230');

        // -------------------------------------------------------------
        // 3. ADD LATE PAYMENT: $90 on Aug 27 for MQ#21 (rcpt21)
        // -------------------------------------------------------------
        console.log('\n--- 3. Adding Late Payment of $90 on Aug 27 to MQ#21 ---');
        // Server authoritative maqal_id lookup:
        const { rows: pRows } = await client.query(
            `SELECT maqal_id FROM "Ledger" WHERE receipt_id = $1 AND type = 'PRODUCT' AND deleted_at IS NULL LIMIT 1`,
            [rcpt21]
        );
        const authMaqalId = pRows[0].maqal_id;
        assert(authMaqalId === 29, 'Server resolves maqal_id = 29 for MQ#21');

        await client.query(`
            INSERT INTO "Ledger" (id, customer_id, type, reference_date, amount, previous_debt, new_debt, receipt_id, maqal_id, created_at)
            VALUES (gen_random_uuid(), $1, 'PAYMENT', '2026-08-27', 90, 1230, 1140, $2, $3, NOW())
        `, [custId, rcpt21, authMaqalId]);

        // Re-read entire ledger authoritatively from DB (Simulating after-save fetch)
        const { rows: afterRows } = await client.query(`
            SELECT * FROM "Ledger" WHERE customer_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC
        `, [custId]);

        const afterGroups = groupTransactionsInfoReceipts(afterRows.map(r => ({
            ...r,
            amount: Number(r.amount || 0),
            kg: r.kg != null ? Number(r.kg) : undefined,
            price_per_kg: r.price_per_kg != null ? Number(r.price_per_kg) : undefined,
            previous_debt: Number(r.previous_debt || 0),
            new_debt: Number(r.new_debt || 0)
        })));

        const a21 = afterGroups.find(g => g.receiptId === rcpt21);
        const a22 = afterGroups.find(g => g.receiptId === rcpt22);

        console.log(`\n  AFTER LATE PAYMENT:`);
        console.log(`    MQ#21: Maqalka=$${a21.totalMaqalka}, Paid=$${a21.totalPaid}, Reesto=$${a21.totalMaqalka - a21.totalPaid}, Opening=$${a21.openingBalance}, Closing=$${a21.closingBalance}`);
        console.log(`    MQ#22: Maqalka=$${a22.totalMaqalka}, Paid=$${a22.totalPaid}, Reesto=$${a22.totalMaqalka - a22.totalPaid}, Opening=$${a22.openingBalance}, Closing=$${a22.closingBalance}`);

        // Assertions for MQ#21
        assert(a21.receiptId === rcpt21, 'MQ#21 receipt_id is unchanged');
        assert(a21.maqalId === 29, 'MQ#21 maqal_id is unchanged (29)');
        assert(a21.displayMaqalId === 21, 'MQ#21 display number is unchanged (MQ#21)');
        assert(a21.totalMaqalka === 350, 'MQ#21 Maqal Total = $350');
        assert(a21.totalPaid === 350, 'MQ#21 Total Paid = $350 ($80 + $180 + $90)');
        assert(a21.totalMaqalka - a21.totalPaid === 0, 'MQ#21 Reesto is $0 (Fully Paid ✓)');
        assert(a21.closingBalance === 880, 'MQ#21 Closing Running Balance = $880 ($880 initial + $350 - $350)');

        // Assertions for MQ#22 (The later Maqal)
        assert(a22.receiptId === rcpt22, 'MQ#22 receipt_id is unchanged');
        assert(a22.maqalId === 30, 'MQ#22 maqal_id is unchanged (30)');
        assert(a22.displayMaqalId === 22, 'MQ#22 display number is unchanged (MQ#22)');
        assert(a22.openingBalance === 880, 'MQ#22 Opening Balance is recalculated to $880 (was $970)');
        assert(a22.closingBalance === 1140, 'MQ#22 Closing Running Balance is recalculated to $1140 (was $1230!)');
        assert(a22.totalMaqalka - a22.totalPaid === 260, 'MQ#22 Reesto = $260 ($360 - $100)');

        // -------------------------------------------------------------
        // 4. RELOAD TEST: Full page reload produces identical results
        // -------------------------------------------------------------
        console.log('\n--- 4. Page Reload Simulation (Identical values before vs after reload) ---');
        const { rows: reloadedRows } = await client.query(`
            SELECT id, customer_id, type, reference_date, kg, price_per_kg, amount, previous_debt, new_debt, note, receipt_id, maqal_id, created_at
            FROM "Ledger"
            WHERE customer_id = $1 AND deleted_at IS NULL
            ORDER BY created_at DESC, id DESC;
        `, [custId]);

        const reloadedGroups = groupTransactionsInfoReceipts(reloadedRows.map(r => ({
            ...r,
            amount: Number(r.amount || 0),
            kg: r.kg != null ? Number(r.kg) : undefined,
            price_per_kg: r.price_per_kg != null ? Number(r.price_per_kg) : undefined,
            previous_debt: Number(r.previous_debt || 0),
            new_debt: Number(r.new_debt || 0)
        })));

        const r21 = reloadedGroups.find(g => g.receiptId === rcpt21);
        const r22 = reloadedGroups.find(g => g.receiptId === rcpt22);

        assert(r21.totalPaid === a21.totalPaid, 'Reload: MQ#21 totalPaid matches after-save state ($350)');
        assert(r21.closingBalance === a21.closingBalance, 'Reload: MQ#21 closingBalance matches after-save state ($880)');
        assert(r22.closingBalance === a22.closingBalance, 'Reload: MQ#22 closingBalance matches after-save state ($1140)');

        // Rollback test data
        await client.query('ROLLBACK');
        console.log('\n  ✅ All test scenario data rolled back cleanly — DB untouched.');

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Error during test execution:', e);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

runRecalculationTests().catch(console.error);
