import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { validateSession } from '@/lib/sessions-store';
import { trackApiRoute } from '@/lib/egress-tracker';
import { unstable_cache } from 'next/cache';

export const dynamic = 'force-dynamic';

type Period = 'week' | 'month' | 'year';

const getMqAnalyticsData = async (period: Period, today: string) => {
    // We group by maqal_id. If maqal_id is missing, we fallback to the reference_date.
    // The query safely filters by the selected period boundary using local database dates.
    const query = `
        WITH period_ledger AS (
            SELECT 
                l.id,
                l.customer_id,
                l.type,
                l.amount,
                l.kg,
                l.maqal_id,
                COALESCE(l.reference_date::date, l.created_at::date) as ref_day,
                c.name as customer_name,
                c.customer_code
            FROM "Ledger" l
            JOIN "Customer" c ON c.id = l.customer_id
            WHERE l.deleted_at IS NULL
              AND c.deleted_at IS NULL
              AND COALESCE(l.reference_date::date, l.created_at::date) >= date_trunc($1, $2::date)
              AND COALESCE(l.reference_date::date, l.created_at::date) < date_trunc($1, $2::date) + (
                  CASE 
                      WHEN $1 = 'week' THEN INTERVAL '1 week'
                      WHEN $1 = 'month' THEN INTERVAL '1 month'
                      ELSE INTERVAL '1 year'
                  END
              )
        ),
        mq_groups AS (
            SELECT
                COALESCE(maqal_id::text, TO_CHAR(ref_day, 'YYYY-MM-DD')) as mq_key,
                maqal_id,
                MIN(ref_day) as min_date,
                SUM(CASE WHEN type = 'PRODUCT' THEN amount ELSE 0 END) as expected,
                SUM(CASE WHEN type = 'PAYMENT' THEN amount ELSE 0 END) as paid,
                SUM(CASE WHEN type = 'PRODUCT' THEN kg ELSE 0 END) as kg,
                COUNT(DISTINCT customer_id) as total_customers,
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'customer_id', customer_id,
                        'name', customer_name,
                        'code', customer_code,
                        'type', type,
                        'amount', amount,
                        'kg', kg,
                        'ref_day', ref_day
                    )
                ) as entries
            FROM period_ledger
            GROUP BY COALESCE(maqal_id::text, TO_CHAR(ref_day, 'YYYY-MM-DD')), maqal_id
        )
        SELECT * FROM mq_groups
        ORDER BY min_date ASC, maqal_id ASC NULLS FIRST
    `;

    const result = await pool.query(query, [period, today]);
    
    // Process the raw rows into structured MQ records and aggregate per-customer stats
    const mqs = result.rows.map(row => {
        const expected = Number(row.expected || 0);
        const paid = Number(row.paid || 0);
        const kg = Number(row.kg || 0);
        const remaining = Math.max(0, expected - paid);
        const paymentPercentage = expected > 0 ? Math.min(100, Math.round((paid / expected) * 100)) : 0;
        
        // Aggregate the individual ledger entries into clean customer-level stats
        const customerMap = new Map();
        for (const entry of row.entries) {
            if (!customerMap.has(entry.customer_id)) {
                customerMap.set(entry.customer_id, {
                    id: entry.customer_id,
                    name: entry.name,
                    code: entry.code,
                    expected: 0,
                    paid: 0,
                    kg: 0
                });
            }
            const c = customerMap.get(entry.customer_id);
            if (entry.type === 'PRODUCT') {
                c.expected += Number(entry.amount || 0);
                c.kg += Number(entry.kg || 0);
            } else if (entry.type === 'PAYMENT') {
                c.paid += Number(entry.amount || 0);
            }
        }
        
        const customers = Array.from(customerMap.values()).map(c => ({
            ...c,
            remaining: Math.max(0, c.expected - c.paid)
        })).sort((a, b) => b.expected - a.expected); // Sort by highest expected first

        return {
            id: row.mq_key,
            label: row.maqal_id ? `MQ${row.maqal_id}` : `MQ ${new Date(row.min_date).toLocaleDateString('en-GB', {day:'numeric', month:'short'})}`,
            kg,
            expected,
            paid,
            remaining,
            paymentPercentage,
            customerCount: Number(row.total_customers),
            customers
        };
    });

    const totalExpected = mqs.reduce((sum, mq) => sum + mq.expected, 0);
    const totalPaid = mqs.reduce((sum, mq) => sum + mq.paid, 0);
    const totalKg = mqs.reduce((sum, mq) => sum + mq.kg, 0);
    const totalRemaining = Math.max(0, totalExpected - totalPaid);
    const overallProgress = totalExpected > 0 ? Math.min(100, Math.round((totalPaid / totalExpected) * 100)) : 0;

    return {
        period,
        mqs,
        totals: {
            expected: totalExpected,
            paid: totalPaid,
            remaining: totalRemaining,
            kg: totalKg,
            paymentProgress: overallProgress,
            totalMqs: mqs.length
        }
    };
};

export const GET = trackApiRoute('/api/dashboard/mq-analytics', async (request: Request) => {
    const cookieHeader = request.headers.get('cookie') || '';
    const cookieToken = cookieHeader.match(/dadwork_session=([^;]+)/)?.[1];
    const token = cookieToken || request.headers.get('x-session-token');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const session = await validateSession(token);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const rawPeriod = searchParams.get('period') || 'week';
    const period: Period = ['week', 'month', 'year'].includes(rawPeriod) ? rawPeriod as Period : 'week';

    try {
        const now = new Date();
        const today = now.toISOString().split('T')[0];

        // Unique cache key per period/date, invalidated by the global "dashboard" tag
        const cacheKey = `mq-analytics-${period}-${today}`;
        const getCached = unstable_cache(
            async () => getMqAnalyticsData(period, today),
            [cacheKey],
            { tags: ['dashboard'], revalidate: 3600 }
        );

        const data = await getCached();

        const response = NextResponse.json(data);
        response.headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
        return response;
    } catch (error: any) {
        console.error('MQ Analytics Error:', error);
        return NextResponse.json({ error: error.message || 'Failed to fetch MQ analytics' }, { status: 500 });
    }
});
