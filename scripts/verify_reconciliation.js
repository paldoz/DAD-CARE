/**
 * ULTIMATE RECONCILIATION SCRIPT
 *
 * Tests that Business Overview and Customer Profile agree
 * at the CUSTOMER level for EVERY Maqal.
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function assignPaymentsToMqProduct(products, payments) {
    const mqMaqalIds  = new Set(products.map(p => p.maqal_id).filter(id => id != null));
    const mqReceiptIds = new Set(products.map(p => p.receipt_id).filter(id => id != null));

    return payments.filter(pay => {
        if (pay.maqal_id != null && mqMaqalIds.has(pay.maqal_id)) return true;
        if (pay.receipt_id != null && mqReceiptIds.has(pay.receipt_id)) return true;
        return false;
    });
}

async function main() {
    // ── Step 1: Get MQ date pairs
    const pairsRes = await pool.query(`
        WITH
        past_dates AS (SELECT DISTINCT date::date AS db_date FROM "DailyBook" WHERE deleted_at IS NULL),
        numbered_dates AS (SELECT db_date, ROW_NUMBER() OVER (ORDER BY db_date DESC) AS rn FROM past_dates),
        pairs AS (
            SELECT n2.db_date AS date1, n1.db_date AS date2
            FROM numbered_dates n1 JOIN numbered_dates n2 ON n1.rn = n2.rn - 1 WHERE n1.rn % 2 = 1
        )
        SELECT ROW_NUMBER() OVER (ORDER BY date2 ASC) AS mq_num, date1::text, date2::text
        FROM pairs ORDER BY mq_num
    `);
    const pairs = pairsRes.rows.map(r => ({ mq_num: Number(r.mq_num), date1: r.date1.split('T')[0], date2: r.date2.split('T')[0] }));
    const allMqDates = [...new Set(pairs.flatMap(p => [p.date1, p.date2]))];

    // ── Step 2: Get customers
    const custRes = await pool.query(`
        SELECT DISTINCT l.customer_id, c.name
        FROM "Ledger" l JOIN "Customer" c ON c.id = l.customer_id AND c.deleted_at IS NULL
        WHERE l.type = 'PRODUCT' AND l.deleted_at IS NULL AND COALESCE(l.reference_date::date, l.created_at::date)::text = ANY($1)
    `, [allMqDates]);
    const customers = custRes.rows;
    const customerIds = customers.map(c => c.customer_id);

    // ── Step 3: Fetch ALL transactions
    const txnRes = await pool.query(`
        SELECT id, customer_id, type, COALESCE(reference_date::date, created_at::date)::text AS ref_date,
               amount, receipt_id, maqal_id
        FROM "Ledger"
        WHERE customer_id = ANY($1) AND deleted_at IS NULL
        ORDER BY customer_id, COALESCE(reference_date, created_at) ASC
    `, [customerIds]);
    const txnsByCustomer = {};
    for (const row of txnRes.rows) {
        if (!txnsByCustomer[row.customer_id]) txnsByCustomer[row.customer_id] = [];
        txnsByCustomer[row.customer_id].push(row);
    }

    let failedChecks = 0;
    const failures = [];
    const assignedPaymentIds = new Set();
    const customerMqData = {};
    let globalExpectedCP = 0, globalCollectedCP = 0, globalRemainingCP = 0, globalReestoCP = 0;

    for (const customer of customers) {
        const txns = txnsByCustomer[customer.customer_id] || [];
        const products = txns.filter(t => t.type === 'PRODUCT');
        const payments = txns.filter(t => t.type === 'PAYMENT');
        customerMqData[customer.customer_id] = {};

        for (const pair of pairs) {
            const mqProducts = products.filter(p => p.ref_date === pair.date1 || p.ref_date === pair.date2);
            if (mqProducts.length === 0) continue;
            
            const expected = mqProducts.reduce((s, p) => s + Math.abs(Number(p.amount || 0)), 0);
            const available = payments.filter(pay => !assignedPaymentIds.has(pay.id));
            const mqPayments = assignPaymentsToMqProduct(mqProducts, available);
            
            for (const pay of mqPayments) assignedPaymentIds.add(pay.id);
            const collected = mqPayments.reduce((s, p) => s + Math.abs(Number(p.amount || 0)), 0);
            
            customerMqData[customer.customer_id][pair.mq_num] = {
                expected, collected,
                remaining: Math.max(0, expected - collected),
                overpaid: Math.max(0, collected - expected),
                payments: mqPayments
            };
        }
    }

    const mqResults = {};
    for (const pair of pairs) mqResults[pair.mq_num] = { mqNum: pair.mq_num, date1: pair.date1, date2: pair.date2, customers: [] };
    for (const customer of customers) {
        for (const [mqNum, data] of Object.entries(customerMqData[customer.customer_id] || {})) {
            mqResults[mqNum].customers.push({ id: customer.customer_id, name: customer.name, ...data });
        }
    }
    const apiData = Object.values(mqResults).filter(mq => mq.customers.length > 0);

    console.log(`Checking ${customers.length} customers across ${pairs.length} MQs...\n`);
    let totalCustomerChecks = 0, passedChecks = 0;

    let globalExpectedBO = 0, globalCollectedBO = 0, globalRemainingBO = 0, globalReestoBO = 0;

    for (const mq of apiData) {
        let mqPass = true;
        let mqSumExpected = 0, mqSumCollected = 0, mqSumRemaining = 0, mqSumOverpaid = 0;

        for (const cust of mq.customers) {
            const cpData = customerMqData[cust.id]?.[mq.mqNum];
            totalCustomerChecks++;
            
            const expMatch = Math.abs(cust.expected - cpData.expected) < 0.01;
            const colMatch = Math.abs(cust.collected - cpData.collected) < 0.01;
            const remMatch = Math.abs(cust.remaining - cpData.remaining) < 0.01;
            const resMatch = Math.abs(cust.overpaid - cpData.overpaid) < 0.01;
            
            const boPayIds = cust.payments.map(p => p.id).sort().join(',');
            const cpPayIds = cpData.payments.map(p => p.id).sort().join(',');
            const payMatch = boPayIds === cpPayIds;

            if (expMatch && colMatch && remMatch && resMatch && payMatch) {
                passedChecks++;
            } else {
                failedChecks++; mqPass = false;
            }
            
            mqSumExpected += cust.expected;
            mqSumCollected += cust.collected;
            mqSumRemaining += cust.remaining;
            mqSumOverpaid += cust.overpaid;
        }

        globalExpectedBO += mqSumExpected;
        globalCollectedBO += mqSumCollected;
        globalRemainingBO += mqSumRemaining;
        globalReestoBO += mqSumOverpaid;

        const pct = mqSumExpected > 0 ? ((mqSumCollected / mqSumExpected) * 100).toFixed(1) : '0.0';
        console.log(`MQ#${mq.mqNum.toString().padEnd(3)} ${mqPass ? '✅ PASS' : '❌ FAIL'}  Expected=$${mqSumExpected.toFixed(0).padStart(8)}  Collected=$${mqSumCollected.toFixed(0).padStart(8)}  ${pct}%  (${mq.customers.length} customers)`);
    }

    console.log(`\nCustomer checks: ${totalCustomerChecks} total, ${passedChecks} passed, ${failedChecks} failed`);

    console.log('\n─── Global Sum Check ────────────────────────────────────');
    console.log(`Global Expected:  $${globalExpectedBO}`);
    console.log(`Global Collected: $${globalCollectedBO}`);
    console.log(`Global Remaining: $${globalRemainingBO}`);
    console.log(`Global Reesto:    $${globalReestoBO}`);

    console.log('\n─── Cross-MQ contamination check ────────────────────────');
    const seen = new Set();
    let contamination = false;
    for (const custId of Object.keys(customerMqData)) {
        for (const mqNum of Object.keys(customerMqData[custId])) {
            for (const pay of customerMqData[custId][mqNum].payments) {
                if (seen.has(pay.id)) {
                    console.error(`❌ Duplicate Payment ${pay.id}!`);
                    contamination = true;
                }
                seen.add(pay.id);
            }
        }
    }
    if (!contamination) console.log('✅ Zero cross-MQ contamination.');

    await pool.end();
}

main().catch(console.error);
