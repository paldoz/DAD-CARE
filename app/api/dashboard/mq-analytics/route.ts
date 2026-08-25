import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { validateSession } from '@/lib/sessions-store';
import { trackApiRoute } from '@/lib/egress-tracker';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Period = 'week' | 'month' | 'year' | 'all';

/**
 * THE ONLY SOURCE OF TRUTH FOR PAYMENT ASSIGNMENT:
 *
 * A payment belongs to a Maqal if and only if:
 *   (A) payment.maqal_id is non-null AND at least one PRODUCT row with that maqal_id
 *       falls within this MQ's (date1, date2), OR
 *   (B) payment.receipt_id is non-null AND at least one PRODUCT row with that receipt_id
 *       falls within this MQ's (date1, date2).
 *
 * NO waterfall. NO orphan merging. NO date-of-payment guessing.
 * NO lifetime-payment attribution. NO oldest-unpaid logic.
 *
 * This exactly mirrors how the Customer Profile Maqal History identifies payments —
 * it groups by maqal_id or receipt_id, never by naked payment dates.
 */

import { MAQAL_PAIRS_CTE, validateMaqalPairs } from '@/lib/maqal-utils';

const getMqAnalyticsData = async (period: Period, today: string) => {

    // ─── STEP 1: Derive MQ date pairs from DailyBook (Authoritative Chronological ASC) ──
    const pairsResult = await pool.query(`
        ${MAQAL_PAIRS_CTE}
        SELECT mq_num, date1::text, date2::text
        FROM pairs
        ORDER BY mq_num ASC;
    `);

    // All MQ date pairs, indexed by mq_num
    interface MqPair {
        mq_num: number;
        date1: string;
        date2: string;
    }
    const allPairs: MqPair[] = pairsResult.rows.map(r => ({
        mq_num: Number(r.mq_num),
        date1: String(r.date1).split('T')[0],
        date2: String(r.date2).split('T')[0],
    }));

    validateMaqalPairs(allPairs);

    if (allPairs.length === 0) {
        return { period, mqs: [], unassignedPayments: [], totals: { expected: 0, paid: 0, remaining: 0, overpaid: 0, kg: 0, paymentProgress: 0, totalMqs: 0, totalUnassigned: 0 } };
    }

    // Build a fast lookup: date string → mq_num
    const dateToMqNum = new Map<string, number>();
    for (const p of allPairs) {
        // A date can only belong to one pair — date1 is the earlier date
        dateToMqNum.set(p.date1, p.mq_num);
        dateToMqNum.set(p.date2, p.mq_num);
    }

    // Apply period filter
    let filteredPairs = allPairs;
    if (period !== 'all') {
        const todayDate = new Date(today);
        let start: Date, end: Date;
        if (period === 'week') {
            const day = todayDate.getDay();
            start = new Date(todayDate); start.setDate(todayDate.getDate() - day);
            end   = new Date(start);     end.setDate(start.getDate() + 7);
        } else if (period === 'month') {
            start = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);
            end   = new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 1);
        } else { // year
            start = new Date(todayDate.getFullYear(), 0, 1);
            end   = new Date(todayDate.getFullYear() + 1, 0, 1);
        }
        const startStr = start.toISOString().split('T')[0];
        const endStr   = end.toISOString().split('T')[0];
        filteredPairs = allPairs.filter(p => p.date2 >= startStr && p.date2 < endStr);
    }

    if (filteredPairs.length === 0) {
        return { period, mqs: [], unassignedPayments: [], totals: { expected: 0, paid: 0, remaining: 0, overpaid: 0, kg: 0, paymentProgress: 0, totalMqs: 0, totalUnassigned: 0 } };
    }

    const filteredMqNums = new Set(filteredPairs.map(p => p.mq_num));
    const filteredDates  = new Set(filteredPairs.flatMap(p => [p.date1, p.date2]));
    const filteredDatesArr = Array.from(filteredDates);

    // ─── STEP 2: Find all customers with PRODUCT entries on MQ dates ──────────
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
    `, [filteredDatesArr]);

    const customers = customerResult.rows.map(r => ({
        id:   String(r.customer_id),
        name: String(r.customer_name),
        code: String(r.customer_code),
    }));

    if (customers.length === 0) {
        return { period, mqs: [], unassignedPayments: [], totals: { expected: 0, paid: 0, remaining: 0, overpaid: 0, kg: 0, paymentProgress: 0, totalMqs: 0, totalUnassigned: 0 } };
    }

    const customerIds = customers.map(c => c.id);

    // ─── STEP 3: Bulk fetch ALL transactions for all relevant customers ───────
    // We fetch EVERY transaction (product + payment + adjustment) so we can
    // correctly identify which payments link to which Maqal via maqal_id / receipt_id.
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

    // Group raw rows by customer_id
    interface RawTxn {
        id: string;
        customer_id: string;
        type: 'PRODUCT' | 'PAYMENT' | 'ADJUSTMENT';
        ref_date: string;
        kg: number | null;
        price_per_kg: number | null;
        amount: number;
        receipt_id: string | null;
        maqal_id: number | null;
        note: string | null;
        created_at: string;
    }

    const txnsByCustomer = new Map<string, RawTxn[]>();
    for (const row of txnResult.rows as RawTxn[]) {
        const list = txnsByCustomer.get(row.customer_id) || [];
        list.push(row);
        txnsByCustomer.set(row.customer_id, list);
    }

    // ─── STEP 4–6: Per customer, per MQ — calculate Expected, Collected ───────
    // 
    // For each customer:
    //   For each MQ (within filteredPairs):
    //     1. Find PRODUCT rows on date1 or date2  → these define Expected
    //     2. Collect the maqal_ids and receipt_ids from those PRODUCT rows
    //     3. Match PAYMENT rows where:
    //            payment.maqal_id   IN (maqal_ids from step 2)
    //         OR payment.receipt_id IN (receipt_ids from step 2)
    //     4. Collected = sum of those payments
    //     5. Never assign the same payment to two MQs
    //
    // To enforce "each payment appears once only", we track which payment IDs
    // have already been assigned.

    interface CustomerMqResult {
        customerId: string;
        customerName: string;
        customerCode: string;
        mqNum: number;
        expected: number;
        collected: number;
        remaining: number;
        overpaid: number;
        kg: number;
        pricePerKg: number;
        kgDay1: number;
        kgDay2: number;
        paymentPct: number;
        payments: { id: string; date: string; amount: number; receiptId: string | null; maqalId: number | null; note: string | null; }[];
    }

    const mqMap = new Map<number, {
        mqNum: number;
        date1: string;
        date2: string;
        customers: CustomerMqResult[];
    }>();

    for (const pair of filteredPairs) {
        mqMap.set(pair.mq_num, { mqNum: pair.mq_num, date1: pair.date1, date2: pair.date2, customers: [] });
    }

    // Track globally assigned payment IDs to enforce zero double-counting
    const assignedPaymentIds = new Set<string>();
    // Track globally assigned payment IDs per customer (for unassigned detection)
    const assignedPaymentIdsByCustomer = new Map<string, Set<string>>();

    // We process customers oldest-MQ-first so that if a payment could theoretically
    // match two MQs (edge case with same receipt_id in two MQs), the earlier MQ wins.
    for (const customer of customers) {
        const txns = txnsByCustomer.get(customer.id) || [];
        const products  = txns.filter(t => t.type === 'PRODUCT');
        const payments  = txns.filter(t => t.type === 'PAYMENT');

        const assignedForThisCustomer = new Set<string>();
        assignedPaymentIdsByCustomer.set(customer.id, assignedForThisCustomer);

        for (const pair of filteredPairs) {
            // Products on this MQ's dates for this customer
            const mqProducts = products.filter(p =>
                p.ref_date === pair.date1 || p.ref_date === pair.date2
            );
            if (mqProducts.length === 0) continue; // customer not in this MQ

            const expected = mqProducts.reduce((s, p) => s + Math.abs(Number(p.amount || 0)), 0);
            const kg       = mqProducts.reduce((s, p) => s + Number(p.kg || 0), 0);
            const kgDay1   = mqProducts.filter(p => p.ref_date === pair.date1).reduce((s, p) => s + Number(p.kg || 0), 0);
            const kgDay2   = mqProducts.filter(p => p.ref_date === pair.date2).reduce((s, p) => s + Number(p.kg || 0), 0);
            const pricePerKg = mqProducts.reduce((max, p) => Math.max(max, Number(p.price_per_kg || 0)), 0);

            // Reliable link sets: maqal_ids and receipt_ids from the product rows
            const mqMaqalIds  = new Set<number>(mqProducts.map(p => p.maqal_id).filter((id): id is number => id != null));
            const mqReceiptIds = new Set<string>(mqProducts.map(p => p.receipt_id).filter((id): id is string => id != null));

            // Match payments using ONLY reliable evidence (direct maqal_id, linked maqal_id, OR receipt_id)
            const mqPayments = payments.filter(pay => {
                if (assignedPaymentIds.has(pay.id)) return false; // already assigned globally
                if (pay.maqal_id != null && (pay.maqal_id === pair.mq_num || mqMaqalIds.has(pay.maqal_id))) return true;
                if (pay.receipt_id != null && mqReceiptIds.has(pay.receipt_id)) return true;
                return false;
            });

            // Mark all matched payments as assigned (globally + per customer)
            for (const pay of mqPayments) {
                assignedPaymentIds.add(pay.id);
                assignedForThisCustomer.add(pay.id);
            }

            const collected = mqPayments.reduce((s, pay) => s + Math.abs(Number(pay.amount || 0)), 0);
            const remaining = Math.max(0, expected - collected);
            const overpaid  = Math.max(0, collected - expected);
            const paymentPct = expected > 0 ? (collected / expected) * 100 : (collected > 0 ? 100 : 0);

            const mqEntry = mqMap.get(pair.mq_num)!;
            mqEntry.customers.push({
                customerId:   customer.id,
                customerName: customer.name,
                customerCode: customer.code,
                mqNum:        pair.mq_num,
                expected,
                collected,
                remaining,
                overpaid,
                kg,
                pricePerKg,
                kgDay1,
                kgDay2,
                paymentPct,
                payments: mqPayments.map(pay => ({
                    id:        pay.id,
                    date:      pay.ref_date,
                    amount:    Math.abs(Number(pay.amount || 0)),
                    receiptId: pay.receipt_id,
                    maqalId:   pair.mq_num,
                    note:      pay.note,
                })),
            });
        }
    }

    // ─── STEP 7: Build final MQ output ────────────────────────────────────────
    const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

    let globalReconciliationPassed = true;

    const mqs = Array.from(mqMap.values())
        .filter(mq => mq.customers.length > 0)
        .map(mq => {
            const mqExpected       = Number(mq.customers.reduce((s, c) => s + c.expected,   0).toFixed(2));
            const mqCollected      = Number(mq.customers.reduce((s, c) => s + c.collected,  0).toFixed(2));
            const mqGrossRemaining = Number(mq.customers.reduce((s, c) => s + c.remaining,  0).toFixed(2));
            const mqGrossReesto    = Number(mq.customers.reduce((s, c) => s + c.overpaid,   0).toFixed(2));
            const mqKg             = Number(mq.customers.reduce((s, c) => s + c.kg,         0).toFixed(2));
            
            // Net balance: positive means net debt, negative means net reesto
            const mqNetBalance     = Number((mqExpected - mqCollected).toFixed(2));
            const mqNetDebt        = mqNetBalance > 0 ? mqNetBalance : 0;
            const mqNetReesto      = mqNetBalance < 0 ? Math.abs(mqNetBalance) : 0;

            // Paid % = (Collected / Expected) * 100 — Never cap at 100%
            const mqPayPct         = mqExpected > 0 ? (mqCollected / mqExpected) * 100 : (mqCollected > 0 ? 100 : 0);

            // ── ACCOUNTING ASSERTIONS ──
            const expMinusCol = Number((mqExpected - mqCollected).toFixed(2));
            const remMinusReesto = Number((mqGrossRemaining - mqGrossReesto).toFixed(2));
            const isAccountingIdentityValid = Math.abs(expMinusCol - remMinusReesto) < 0.01;

            const paymentsSum = Number(mq.customers.flatMap(c => c.payments).reduce((s, p) => s + p.amount, 0).toFixed(2));
            const isPaymentSumValid = Math.abs(paymentsSum - mqCollected) < 0.01;

            if (!isAccountingIdentityValid || !isPaymentSumValid) {
                globalReconciliationPassed = false;
                console.error(`[mq-analytics] RECONCILIATION FAILED MQ#${mq.mqNum}:`, {
                    expected: mqExpected,
                    collected: mqCollected,
                    grossRemaining: mqGrossRemaining,
                    grossReesto: mqGrossReesto,
                    expMinusCol,
                    remMinusReesto,
                    paymentsSum,
                });
            }

            const startDate = fmt(mq.date1);
            const endDate   = fmt(mq.date2);

            return {
                id:                String(mq.mqNum),
                mqNumber:          mq.mqNum,
                label:             `MQ#${mq.mqNum}`,
                dateRange:         `${startDate} – ${endDate}`,
                startDate,
                endDate,
                kg:                mqKg,
                expected:          mqExpected,
                paid:              mqCollected,
                remaining:         mqGrossRemaining, // Gross customer debts
                overpaid:          mqGrossReesto,    // Gross customer Reesto
                netDebt:           mqNetDebt,
                netReesto:         mqNetReesto,
                paymentPercentage: Number(mqPayPct.toFixed(2)),
                reconciliationStatus: (isAccountingIdentityValid && isPaymentSumValid) ? 'PASSED' : 'FAILED',
                customerCount:     mq.customers.length,
                customers: mq.customers
                    .sort((a, b) => b.remaining - a.remaining)
                    .map(c => ({
                        id:          c.customerId,
                        name:        c.customerName,
                        code:        c.customerCode,
                        expected:    c.expected,
                        paid:        c.collected,
                        kg:          c.kg,
                        pricePerKg:  c.pricePerKg,
                        kgDay1:      c.kgDay1,
                        kgDay2:      c.kgDay2,
                        remaining:   c.remaining,
                        overpaid:    c.overpaid,
                        paymentPct:  Number(c.paymentPct.toFixed(2)),
                        payments:    c.payments,
                    })),
            };
        });

    // ─── STEP 8: Unassigned payments ─────────────────────────────────────────
    const unassignedResult = await pool.query(`
        WITH
        all_pairs AS (
            WITH
            past_dates AS (SELECT DISTINCT date::date AS db_date FROM "DailyBook" WHERE deleted_at IS NULL),
            numbered_dates AS (SELECT db_date, ROW_NUMBER() OVER (ORDER BY db_date DESC) AS rn FROM past_dates),
            raw_pairs AS (SELECT n2.db_date AS date1, n1.db_date AS date2 FROM numbered_dates n1 JOIN numbered_dates n2 ON n1.rn = n2.rn - 1 WHERE n1.rn % 2 = 1)
            SELECT date1, date2 FROM raw_pairs
        ),
        mq_dates AS (
            SELECT DISTINCT date1 AS mq_date FROM all_pairs
            UNION
            SELECT DISTINCT date2 AS mq_date FROM all_pairs
        ),
        anchored_receipts AS (
            SELECT DISTINCT l.receipt_id
            FROM "Ledger" l
            JOIN mq_dates md ON COALESCE(l.reference_date::date, l.created_at::date) = md.mq_date
            WHERE l.type = 'PRODUCT' AND l.deleted_at IS NULL AND l.receipt_id IS NOT NULL
        )
        SELECT
            l.id,
            l.customer_id,
            c.name AS customer_name,
            TO_CHAR(COALESCE(l.reference_date::date, l.created_at::date), 'YYYY-MM-DD') AS date,
            ABS(l.amount) AS amount,
            l.receipt_id,
            l.note
        FROM "Ledger" l
        JOIN "Customer" c ON c.id = l.customer_id AND c.deleted_at IS NULL
        LEFT JOIN anchored_receipts ar ON ar.receipt_id = l.receipt_id
        WHERE l.type = 'PAYMENT'
          AND l.deleted_at IS NULL
          AND l.maqal_id IS NULL
          AND ar.receipt_id IS NULL
        ORDER BY COALESCE(l.reference_date, l.created_at) DESC
    `);

    const unassignedPayments = unassignedResult.rows.map(r => ({
        id:           String(r.id),
        customerId:   String(r.customer_id),
        customerName: String(r.customer_name),
        date:         String(r.date),
        amount:       Number(r.amount || 0),
        receiptId:    r.receipt_id ?? null,
        note:         r.note ?? null,
    }));

    // ─── STEP 9: Global totals ─────────────────────────────────────────────────
    // Derived ONLY from the displayed Maqals as single source of truth
    const totalExpected  = Number(mqs.reduce((s, m) => s + m.expected,  0).toFixed(2));
    const totalPaid      = Number(mqs.reduce((s, m) => s + m.paid,      0).toFixed(2));
    const totalRemaining = Number(mqs.reduce((s, m) => s + m.remaining, 0).toFixed(2));
    const totalOverpaid  = Number(mqs.reduce((s, m) => s + m.overpaid,  0).toFixed(2));
    const totalKg        = Number(mqs.reduce((s, m) => s + m.kg,        0).toFixed(2));
    const overallPct     = totalExpected > 0 ? (totalPaid / totalExpected) * 100 : (totalPaid > 0 ? 100 : 0);
    const totalUnassigned = Number(unassignedPayments.reduce((s, p) => s + p.amount, 0).toFixed(2));

    return {
        period,
        reconciliationStatus: globalReconciliationPassed ? 'PASSED' : 'FAILED',
        mqs,
        unassignedPayments,
        totals: {
            expected:        totalExpected,
            paid:            totalPaid,
            remaining:       totalRemaining,
            overpaid:        totalOverpaid,
            kg:              totalKg,
            paymentProgress: Number(overallPct.toFixed(2)),
            totalMqs:        mqs.length,
            totalUnassigned,
        },
    };
};

export const GET = trackApiRoute('/api/dashboard/mq-analytics', async (request: Request) => {
    const cookieHeader = request.headers.get('cookie') || '';
    const cookieToken  = cookieHeader.match(/dadwork_session=([^;]+)/)?.[1];
    const token        = cookieToken || request.headers.get('x-session-token');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const session = await validateSession(token);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const rawPeriod = searchParams.get('period') || 'all';
    const period: Period = ['week', 'month', 'year', 'all'].includes(rawPeriod)
        ? rawPeriod as Period
        : 'all';

    try {
        const today = new Date().toISOString().split('T')[0];
        const data  = await getMqAnalyticsData(period, today);

        const response = NextResponse.json(data);
        response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        response.headers.set('Pragma', 'no-cache');
        return response;
    } catch (error: any) {
        console.error('[mq-analytics] Error:', error);
        return NextResponse.json({ error: 'Failed to fetch MQ analytics', details: error.message }, { status: 500 });
    }
});
