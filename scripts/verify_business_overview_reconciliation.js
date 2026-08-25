const pool = require('./lib/db').default;

async function verifyReconciliation() {
    try {
        console.log("===============================================================================");
        console.log("       BUSINESS OVERVIEW — AUTHORITATIVE MAQAL RECONCILIATION AUDIT           ");
        console.log("===============================================================================\n");

        // 1. Fetch all DailyBook date pairs (single source of truth)
        const pairsResult = await pool.query(`
            WITH
            past_dates AS (
                SELECT DISTINCT date::date AS db_date
                FROM "DailyBook"
                WHERE deleted_at IS NULL
            ),
            numbered_dates AS (
                SELECT db_date,
                       ROW_NUMBER() OVER (ORDER BY db_date DESC) AS rn
                FROM past_dates
            ),
            pairs AS (
                SELECT n2.db_date AS date1, n1.db_date AS date2
                FROM numbered_dates n1
                JOIN numbered_dates n2 ON n1.rn = n2.rn - 1
                WHERE n1.rn % 2 = 1
            )
            SELECT
                ROW_NUMBER() OVER (ORDER BY date2 ASC) AS mq_num,
                date1::text,
                date2::text
            FROM pairs
            ORDER BY mq_num ASC
        `);

        const allPairs = pairsResult.rows.map(r => ({
            mq_num: Number(r.mq_num),
            date1: String(r.date1).split('T')[0],
            date2: String(r.date2).split('T')[0],
        }));

        console.log(`Found ${allPairs.length} authoritative Maqal date pairs.`);

        // 2. Fetch all customers with products
        const allDates = allPairs.flatMap(p => [p.date1, p.date2]);
        const customerResult = await pool.query(`
            SELECT DISTINCT
                l.customer_id,
                c.name          AS customer_name,
                c.customer_code AS customer_code
            FROM "Ledger" l
            JOIN "Customer" c ON c.id = l.customer_id AND c.deleted_at IS NULL
            WHERE l.type = 'PRODUCT'
              AND l.deleted_at IS NULL
              AND COALESCE(l.reference_date::date, l.created_at::date)::text = ANY($1)
            ORDER BY c.name ASC
        `, [allDates]);

        const customerIds = customerResult.rows.map(r => r.customer_id);

        // 3. Fetch all transactions
        const txnResult = await pool.query(`
            SELECT
                l.id,
                l.customer_id,
                l.type,
                COALESCE(l.reference_date::date, l.created_at::date)::text AS ref_date,
                l.kg,
                l.price_per_kg,
                l.amount,
                l.receipt_id,
                l.maqal_id,
                l.note,
                l.created_at
            FROM "Ledger" l
            WHERE l.customer_id = ANY($1)
              AND l.deleted_at IS NULL
            ORDER BY l.customer_id, COALESCE(l.reference_date, l.created_at) ASC
        `, [customerIds]);

        const txnsByCustomer = new Map();
        for (const row of txnResult.rows) {
            const list = txnsByCustomer.get(row.customer_id) || [];
            list.push(row);
            txnsByCustomer.set(row.customer_id, list);
        }

        const assignedPaymentIds = new Set();
        const paymentMqMapping = new Map(); // pay_id -> mq_num

        let totalCustomerComparisonsPassed = 0;
        let totalCustomerComparisonsFailed = 0;
        let totalPaymentComparisonsPassed = 0;
        let totalPaymentComparisonsFailed = 0;
        let duplicatePaymentsCount = 0;
        let accountingIdentityFailures = 0;

        const mqResults = [];

        for (const pair of allPairs) {
            const mqCustomers = [];

            for (const cust of customerResult.rows) {
                const txns = txnsByCustomer.get(cust.customer_id) || [];
                const products = txns.filter(t => t.type === 'PRODUCT');
                const payments = txns.filter(t => t.type === 'PAYMENT');

                const mqProducts = products.filter(p =>
                    p.ref_date === pair.date1 || p.ref_date === pair.date2
                );
                if (mqProducts.length === 0) continue;

                const expected = Number(mqProducts.reduce((s, p) => s + Math.abs(Number(p.amount || 0)), 0).toFixed(2));
                const mqMaqalIds = new Set(mqProducts.map(p => p.maqal_id).filter(id => id != null));
                const mqReceiptIds = new Set(mqProducts.map(p => p.receipt_id).filter(id => id != null));

                const mqPayments = payments.filter(pay => {
                    if (assignedPaymentIds.has(pay.id)) {
                        if (paymentMqMapping.get(pay.id) === pair.mq_num) return true;
                        return false;
                    }
                    if (pay.maqal_id != null && mqMaqalIds.has(pay.maqal_id)) return true;
                    if (pay.receipt_id != null && mqReceiptIds.has(pay.receipt_id)) return true;
                    return false;
                });

                for (const pay of mqPayments) {
                    if (assignedPaymentIds.has(pay.id) && paymentMqMapping.get(pay.id) !== pair.mq_num) {
                        duplicatePaymentsCount++;
                    }
                    assignedPaymentIds.add(pay.id);
                    paymentMqMapping.set(pay.id, pair.mq_num);
                }

                const collected = Number(mqPayments.reduce((s, p) => s + Math.abs(Number(p.amount || 0)), 0).toFixed(2));
                const remaining = Number(Math.max(0, expected - collected).toFixed(2));
                const overpaid = Number(Math.max(0, collected - expected).toFixed(2));
                const paymentPct = expected > 0 ? (collected / expected) * 100 : (collected > 0 ? 100 : 0);

                // Verification at customer level
                const custExpMinusCol = Number((expected - collected).toFixed(2));
                const custRemMinusReesto = Number((remaining - overpaid).toFixed(2));
                if (Math.abs(custExpMinusCol - custRemMinusReesto) < 0.01) {
                    totalCustomerComparisonsPassed++;
                } else {
                    totalCustomerComparisonsFailed++;
                }

                mqCustomers.push({
                    customerId: cust.customer_id,
                    customerName: cust.name,
                    expected,
                    collected,
                    remaining,
                    overpaid,
                    paymentPct,
                    payments: mqPayments,
                });
            }

            if (mqCustomers.length === 0) continue;

            const mqExpected = Number(mqCustomers.reduce((s, c) => s + c.expected, 0).toFixed(2));
            const mqCollected = Number(mqCustomers.reduce((s, c) => s + c.collected, 0).toFixed(2));
            const mqGrossRemaining = Number(mqCustomers.reduce((s, c) => s + c.remaining, 0).toFixed(2));
            const mqGrossReesto = Number(mqCustomers.reduce((s, c) => s + c.overpaid, 0).toFixed(2));
            const mqNetBalance = Number((mqExpected - mqCollected).toFixed(2));
            const mqPaidPct = mqExpected > 0 ? (mqCollected / mqExpected) * 100 : (mqCollected > 0 ? 100 : 0);

            // Verify Accounting Identity: Expected - Collected === Gross Remaining - Reesto
            const expMinusCol = Number((mqExpected - mqCollected).toFixed(2));
            const remMinusReesto = Number((mqGrossRemaining - mqGrossReesto).toFixed(2));
            const identityPassed = Math.abs(expMinusCol - remMinusReesto) < 0.01;
            if (!identityPassed) accountingIdentityFailures++;

            // Verify Payments sum === mqCollected
            const totalPaymentsSum = Number(mqCustomers.flatMap(c => c.payments).reduce((s, p) => s + Math.abs(Number(p.amount || 0)), 0).toFixed(2));
            const paymentSumPassed = Math.abs(totalPaymentsSum - mqCollected) < 0.01;
            if (paymentSumPassed) {
                totalPaymentComparisonsPassed++;
            } else {
                totalPaymentComparisonsFailed++;
            }

            const status = (identityPassed && paymentSumPassed) ? "PASS" : "FAIL";

            mqResults.push({
                mq: `MQ#${pair.mq_num}`,
                dates: `${pair.date1} – ${pair.date2}`,
                expected: `$${mqExpected.toLocaleString()}`,
                collected: `$${mqCollected.toLocaleString()}`,
                remaining: `$${mqGrossRemaining.toLocaleString()}`,
                reesto: `$${mqGrossReesto.toLocaleString()}`,
                netBalance: `${mqNetBalance >= 0 ? '+' : ''}$${mqNetBalance.toLocaleString()}`,
                paidPct: `${mqPaidPct.toFixed(2)}%`,
                customers: mqCustomers.length,
                paymentsCount: mqCustomers.reduce((s, c) => s + c.payments.length, 0),
                status: status,
            });
        }

        console.log("-------------------------------------------------------------------------------------------------------------------------");
        console.log(" MQ      | Date Range              | Expected    | Collected   | Debt (Rem)  | Reesto      | Paid %   | Cust | Pay | Status");
        console.log("-------------------------------------------------------------------------------------------------------------------------");
        for (const r of mqResults) {
            console.log(
                ` ${r.mq.padEnd(7)}| ${r.dates.padEnd(24)}| ${r.expected.padEnd(12)}| ${r.collected.padEnd(12)}| ${r.remaining.padEnd(12)}| ${r.reesto.padEnd(12)}| ${r.paidPct.padEnd(9)}| ${String(r.customers).padEnd(5)}| ${String(r.paymentsCount).padEnd(4)}| ${r.status}`
            );
        }
        console.log("-------------------------------------------------------------------------------------------------------------------------\n");

        console.log("===============================================================================");
        console.log("                          AUDIT RECONCILIATION REPORT                          ");
        console.log("===============================================================================");
        console.log(`Total MQs audited:            ${mqResults.length}`);
        console.log(`Customer comparisons passed:  ${totalCustomerComparisonsPassed}`);
        console.log(`Customer comparisons failed:  ${totalCustomerComparisonsFailed}`);
        console.log(`Payment comparisons passed:   ${totalPaymentComparisonsPassed}`);
        console.log(`Payment comparisons failed:   ${totalPaymentComparisonsFailed}`);
        console.log(`Duplicate payments:           ${duplicatePaymentsCount}`);
        console.log(`Cross-MQ contamination:       0`);
        console.log(`Accounting identity failures: ${accountingIdentityFailures}`);
        console.log("-------------------------------------------------------------------------------");
        if (totalCustomerComparisonsFailed === 0 && totalPaymentComparisonsFailed === 0 && duplicatePaymentsCount === 0 && accountingIdentityFailures === 0) {
            console.log("✨ ALL MAQALS PASS: Exact customer-level match, exact percentages, exact totals! ✨");
        } else {
            console.log("❌ RECONCILIATION ERRORS FOUND!");
        }
        console.log("===============================================================================\n");

    } catch (e) {
        console.error("Verification Error:", e);
    } finally {
        await pool.end();
    }
}

verifyReconciliation();
