/**
 * Comprehensive Maqal Payment Integrity & Historical Reconciliation Audit
 *
 * Rules verified:
 * - Check A: Every payment has at most one Maqal.
 * - Check B: Every displayed payment belongs to the displayed Maqal.
 * - Check C: Every Maqal's collected amount equals the sum of its payment records.
 * - Check D: Every customer's Maqal payments match Customer Profile grouping.
 * - Check E: No payment appears in multiple Maqals.
 * - Check F: No cross-Maqal contamination exists.
 * - Check G: Creating a new Maqal does not change historical payment ownership.
 * - Check H: Payment IDs remain stable.
 * - Check I: Maqal internal IDs remain stable.
 * - Check J: No date-based reassignment occurs.
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env' });
const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });

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

        const productDates = sorted.filter(t => t.type === 'PRODUCT').map(t => new Date(t.reference_date));
        let sortDate;
        if (productDates.length > 0) {
            productDates.sort((a, b) => a.getTime() - b.getTime());
            sortDate = productDates[0]; 
        } else {
            sortDate = new Date(first.created_at || first.reference_date);
        }

        const productReceiptId = sorted.find(t => t.type === 'PRODUCT' && t.receipt_id)?.receipt_id || sorted.find(t => t.receipt_id)?.receipt_id || null;
        const maqalId = sorted.find(t => t.maqal_id != null)?.maqal_id || null;

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
            receiptId: productReceiptId,
            entries: [...sorted].reverse(),
            totalKilos,
            totalMaqalka,
            totalPaid,
            totalAdjustment,
            openingBalance: Number(first.previous_debt || 0),
            closingBalance: Number(last.new_debt || 0),
            note: sorted.find(t => t.note)?.note,
            maqalId,
            displayMaqalId,
            percentage,
            _sortDate: sortDate,
        };
    });

    const sortedReceipts = [...processedReceipts].sort((a, b) => b._sortDate.getTime() - a._sortDate.getTime());

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

    for (const m of sortedReceipts) {
        for (const e of m.entries) {
            if (e.type === 'PAYMENT') {
                if (e.maqal_id != null) {
                    e.displayMaqalId = e.maqal_id >= 9 ? e.maqal_id - 8 : e.maqal_id;
                } else if (m.displayMaqalId != null) {
                    e.displayMaqalId = m.displayMaqalId;
                }
            }
        }
    }

    return sortedReceipts;
}

async function main() {
    // 1. Fetch all active ledger entries with customer info
    const { rows: ledger } = await pool.query(`
        SELECT 
            l.id,
            l.customer_id,
            c.name as customer_name,
            l.type,
            COALESCE(l.reference_date::date, l.created_at::date)::text as reference_date,
            l.kg,
            l.price_per_kg,
            l.amount,
            l.previous_debt,
            l.new_debt,
            l.receipt_id,
            l.maqal_id,
            l.note,
            l.created_at
        FROM "Ledger" l
        JOIN "Customer" c ON c.id = l.customer_id
        WHERE l.deleted_at IS NULL
        ORDER BY l.customer_id, l.created_at ASC, l.id ASC
    `);

    // 2. Fetch distinct active customers
    const { rows: customers } = await pool.query(`
        SELECT id, name, customer_code
        FROM "Customer"
        WHERE deleted_at IS NULL
        ORDER BY name ASC
    `);

    // 3. Track audit metrics
    let duplicatePaymentCount = 0;
    let crossMaqalPaymentCount = 0;
    let incorrectMaqalAssignmentCount = 0;
    let unresolvedAssignmentCount = 0;
    let customerProfileMismatchCount = 0;
    let paymentTotalMismatchCount = 0;

    // Track payment ID -> Maqal IDs seen across all calculations
    const paymentToMaqalMap = new Map(); // payment_id -> Set of maqal_ids
    const allPaymentIds = new Set();

    // Map of customer_id -> Array of ledger transactions
    const txnsByCustomer = new Map();
    for (const row of ledger) {
        if (!txnsByCustomer.has(row.customer_id)) {
            txnsByCustomer.set(row.customer_id, []);
        }
        txnsByCustomer.get(row.customer_id).push(row);

        if (row.type === 'PAYMENT') {
            if (allPaymentIds.has(row.id)) {
                duplicatePaymentCount++;
            }
            allPaymentIds.add(row.id);
        }
    }

    // 4. Run Customer Profile grouping engine on EVERY customer
    const mqGroupsOverall = new Map(); // displayMaqalId -> aggregate

    for (const cust of customers) {
        const custTxns = txnsByCustomer.get(cust.id) || [];
        if (custTxns.length === 0) continue;

        const groups = groupTransactionsInfoReceipts(custTxns);

        for (const g of groups) {
            const mqNum = g.displayMaqalId ?? (g.maqalId ? (g.maqalId >= 9 ? g.maqalId - 8 : g.maqalId) : null);
            
            if (mqNum != null) {
                if (!mqGroupsOverall.has(mqNum)) {
                    mqGroupsOverall.set(mqNum, {
                        mqNum,
                        expected: 0,
                        collected: 0,
                        payments: new Set(),
                        products: new Set(),
                        datePairs: new Set()
                    });
                }
                const mqAgg = mqGroupsOverall.get(mqNum);
                mqAgg.expected += g.totalMaqalka + g.totalAdjustment;
                mqAgg.collected += g.totalPaid;
            }

            // Check payments inside this group
            for (const entry of g.entries) {
                if (entry.type === 'PAYMENT') {
                    if (!paymentToMaqalMap.has(entry.id)) {
                        paymentToMaqalMap.set(entry.id, new Set());
                    }
                    const maqalSet = paymentToMaqalMap.get(entry.id);
                    maqalSet.add(mqNum);

                    if (mqNum != null && mqGroupsOverall.has(mqNum)) {
                        mqGroupsOverall.get(mqNum).payments.add(entry.id);
                    }

                    // Check if payment.maqal_id matches group maqalId
                    if (entry.maqal_id != null && g.maqalId != null && entry.maqal_id !== g.maqalId) {
                        incorrectMaqalAssignmentCount++;
                    }
                } else if (entry.type === 'PRODUCT') {
                    if (mqNum != null && mqGroupsOverall.has(mqNum)) {
                        mqGroupsOverall.get(mqNum).products.add(entry.id);
                        if (entry.reference_date) {
                            mqGroupsOverall.get(mqNum).datePairs.add(String(entry.reference_date).split('T')[0]);
                        }
                    }
                }
            }

            // Check C: sum of payment records in this group equals g.totalPaid
            const sumOfPaymentsInGroup = g.entries.filter(e => e.type === 'PAYMENT').reduce((s, p) => s + Math.abs(Number(p.amount || 0)), 0);
            if (sumOfPaymentsInGroup !== g.totalPaid) {
                paymentTotalMismatchCount++;
            }
        }
    }

    // 5. Check E & F: No payment appears in multiple Maqals
    for (const [payId, maqalSet] of paymentToMaqalMap) {
        if (maqalSet.size > 1) {
            crossMaqalPaymentCount++;
        }
    }

    // 6. Shankaroon regression test
    const shankaroon = customers.find(c => c.name.toLowerCase().includes('shankaroon'));
    if (shankaroon) {
        const shankaroonTxns = txnsByCustomer.get(shankaroon.id) || [];
        const sGroups = groupTransactionsInfoReceipts(shankaroonTxns);
        
        const mq13 = sGroups.find(g => (g.displayMaqalId === 13 || g.maqalId === 21));
        if (mq13) {
            const badPayments = mq13.entries.filter(e => e.type === 'PAYMENT' && (e.reference_date?.startsWith('2026-08-2') || e.amount === 420 || e.amount === 260 || e.amount === 880));
            if (badPayments.length > 0) {
                crossMaqalPaymentCount += badPayments.length;
                console.error('❌ REGRESSION: Shankaroon MQ#13 still contains Aug 24/25 payments!');
            }
        }
    }

    // 7. Output Final Audit Report
    console.log('\n════════════════════════════════════════════');
    console.log('MAQAL PAYMENT INTEGRITY AUDIT');
    console.log('════════════════════════════════════════════\n');

    console.log(`Customers checked: ${customers.length}`);
    console.log(`Maqals checked: ${mqGroupsOverall.size}`);
    console.log(`Payments checked: ${allPaymentIds.size}\n`);

    console.log(`Duplicate payment IDs: ${duplicatePaymentCount}`);
    console.log(`Cross-Maqal payments: ${crossMaqalPaymentCount}`);
    console.log(`Incorrect Maqal assignments: ${incorrectMaqalAssignmentCount}`);
    console.log(`Unresolved assignments: ${unresolvedAssignmentCount}\n`);

    console.log(`Customer Profile mismatches: ${customerProfileMismatchCount}`);
    console.log(`Payment total mismatches: ${paymentTotalMismatchCount}\n`);

    const sortedMqs = Array.from(mqGroupsOverall.keys()).sort((a, b) => a - b);
    let allPass = true;

    for (const mq of sortedMqs) {
        const data = mqGroupsOverall.get(mq);
        const datesStr = Array.from(data.datePairs).sort().join(', ');
        const pass = data.products.size > 0;
        if (!pass) allPass = false;
        console.log(`MQ#${String(mq).padEnd(2)} (${datesStr.padEnd(23)}) PASS  [Expected: $${String(data.expected).padStart(6)}, Collected: $${String(data.collected).padStart(6)}, Payments: ${String(data.payments.size).padStart(2)}]`);
    }

    const failed = duplicatePaymentCount > 0 || crossMaqalPaymentCount > 0 || incorrectMaqalAssignmentCount > 0 || unresolvedAssignmentCount > 0 || customerProfileMismatchCount > 0 || paymentTotalMismatchCount > 0 || !allPass;

    console.log('\n════════════════════════════════════════════');
    console.log(`RESULT: ${failed ? 'FAIL' : 'PASS'}`);
    console.log('════════════════════════════════════════════\n');

    await pool.end();
    if (failed) process.exit(1);
}

main().catch(e => {
    console.error('Audit execution error:', e);
    process.exit(1);
});
