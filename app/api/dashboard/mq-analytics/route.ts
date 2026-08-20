import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { validateSession } from '@/lib/sessions-store';
import { trackApiRoute } from '@/lib/egress-tracker';

// Always fetch fresh data — no caching at all
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

type Period = 'week' | 'month' | 'year' | 'all';

const getMqAnalyticsData = async (period: Period, today: string) => {
    /*
     * Strategy:
     * 1. Pull the ENTIRE lifetime history of every official MQ (maqal_id IS NOT NULL).
     *    This guarantees Expected, KG, and Paid are ALWAYS 100% accurate — even if
     *    a customer delivered in July but paid in August.
     * 2. Group by maqal_id to calculate totals.
     * 3. THEN filter by period on the MQ's own start_date so the period selector
     *    (week/month/year) still works correctly.
     */

    const periodFilter = period !== 'all'
        ? `AND COALESCE(mg.start_date, mg.fallback_start) >= date_trunc($1, $2::date)
           AND COALESCE(mg.start_date, mg.fallback_start) < date_trunc($1, $2::date) + (
               CASE
                   WHEN $1 = 'week'  THEN INTERVAL '1 week'
                   WHEN $1 = 'month' THEN INTERVAL '1 month'
                   ELSE INTERVAL '1 year'
               END
           )`
        : '';

    const query = `
        WITH full_ledger AS (
            SELECT
                l.customer_id,
                l.type,
                l.amount,
                l.kg,
                l.maqal_id,
                COALESCE(l.reference_date::date, l.created_at::date) AS ref_day,
                c.name  AS customer_name,
                c.id    AS cid,
                c.customer_code
            FROM "Ledger" l
            JOIN "Customer" c ON c.id = l.customer_id
            WHERE l.deleted_at  IS NULL
              AND c.deleted_at  IS NULL
              AND l.maqal_id    IS NOT NULL
        ),
        mq_groups AS (
            SELECT
                maqal_id::text AS mq_key,
                maqal_id,
                -- Use PRODUCT rows for the real date pair
                MIN(CASE WHEN type = 'PRODUCT' THEN ref_day END) AS start_date,
                MAX(CASE WHEN type = 'PRODUCT' THEN ref_day END) AS end_date,
                MIN(ref_day) AS fallback_start,
                -- Totals
                SUM(CASE WHEN type = 'PRODUCT' THEN amount    ELSE 0 END) AS expected,
                SUM(CASE WHEN type = 'PAYMENT' THEN amount    ELSE 0 END) AS paid,
                SUM(CASE WHEN type = 'PRODUCT' THEN COALESCE(kg, 0) ELSE 0 END) AS kg,
                COUNT(DISTINCT customer_id) AS total_customers,
                -- Per-row detail for customer breakdown
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'customer_id', customer_id,
                        'name',        customer_name,
                        'code',        customer_code,
                        'type',        type,
                        'amount',      amount,
                        'kg',          kg
                    )
                ) AS entries
            FROM full_ledger
            GROUP BY maqal_id
        ),
        filtered AS (
            SELECT * FROM mq_groups mg
            WHERE 1=1
            ${periodFilter}
        )
        SELECT * FROM filtered
        ORDER BY maqal_id ASC NULLS LAST
    `;

    const params = period !== 'all' ? [period, today] : [];
    const result = await pool.query(query, params);

    const mqs = result.rows.map(row => {
        const expected          = Number(row.expected  || 0);
        const paid              = Number(row.paid      || 0);
        const kg                = Number(row.kg        || 0);
        const remaining         = Math.max(0, expected - paid);
        const paymentPercentage = expected > 0
            ? Math.min(100, Math.round((paid / expected) * 100))
            : (paid > 0 ? 100 : 0);

        // Date range from PRODUCT rows (the true delivery dates)
        const actualStart = row.start_date  || row.fallback_start;
        const actualEnd   = row.end_date    || row.fallback_start;
        const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        const startDate   = actualStart ? fmt(actualStart) : '';
        const endDate     = actualEnd   ? fmt(actualEnd)   : '';
        const dateRange   = startDate === endDate ? startDate : `${startDate} – ${endDate}`;

        // Per-customer breakdown
        const customerMap = new Map<string, any>();
        for (const entry of row.entries) {
            if (!customerMap.has(entry.customer_id)) {
                customerMap.set(entry.customer_id, {
                    id:       entry.customer_id,
                    name:     entry.name,
                    code:     entry.code,
                    expected: 0,
                    paid:     0,
                    kg:       0,
                });
            }
            const c = customerMap.get(entry.customer_id);
            if (entry.type === 'PRODUCT') {
                c.expected += Number(entry.amount || 0);
                c.kg       += Number(entry.kg     || 0);
            } else if (entry.type === 'PAYMENT') {
                c.paid += Number(entry.amount || 0);
            }
        }

        const customers = Array.from(customerMap.values())
            .map(c => ({
                ...c,
                remaining:  Math.max(0, c.expected - c.paid),
                paymentPct: c.expected > 0
                    ? Math.min(100, Math.round((c.paid / c.expected) * 100))
                    : (c.paid > 0 ? 100 : 0),
            }))
            .sort((a, b) => b.remaining - a.remaining);

        return {
            id:                row.mq_key,
            mqNumber:          row.maqal_id ? Number(row.maqal_id) : null,
            label:             `MQ#${row.maqal_id}`,
            dateRange,
            startDate,
            endDate,
            kg,
            expected,
            paid,
            remaining,
            paymentPercentage,
            customerCount:     Number(row.total_customers),
            customers,
        };
    });

    const totalExpected  = mqs.reduce((s, m) => s + m.expected,  0);
    const totalPaid      = mqs.reduce((s, m) => s + m.paid,      0);
    const totalKg        = mqs.reduce((s, m) => s + m.kg,        0);
    const totalRemaining = Math.max(0, totalExpected - totalPaid);
    const overallPct     = totalExpected > 0
        ? Math.min(100, Math.round((totalPaid / totalExpected) * 100))
        : 0;

    return {
        period,
        mqs,
        totals: {
            expected:        totalExpected,
            paid:            totalPaid,
            remaining:       totalRemaining,
            kg:              totalKg,
            paymentProgress: overallPct,
            totalMqs:        mqs.length,
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
        // Kill every possible cache layer
        response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        response.headers.set('Pragma', 'no-cache');
        return response;
    } catch (error: any) {
        console.error('[mq-analytics] Error:', error);
        return NextResponse.json({ error: 'Failed to fetch MQ analytics', details: error.message }, { status: 500 });
    }
});
