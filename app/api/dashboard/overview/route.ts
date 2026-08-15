import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { validateSession } from '@/lib/sessions-store';
import { trackApiRoute } from '@/lib/egress-tracker';
import { unstable_cache } from 'next/cache';

export const dynamic = 'force-dynamic';

type Period = 'week' | 'month' | 'year';

interface BucketRow {
    bucket_label: string;
    bucket_order: number;
    expected: number;
    paid: number;
    kg: number;
}

const getOverviewData = async (period: Period, today: string): Promise<BucketRow[]> => {
    let query = '';

    if (period === 'week') {
        // Group by day of current ISO week (Mon–Sun), using reference_date
        query = `
            SELECT
                TO_CHAR(ref_day, 'Dy') AS bucket_label,
                EXTRACT(DOW FROM ref_day)::int AS bucket_order,
                COALESCE(SUM(CASE WHEN type = 'PRODUCT' THEN amount ELSE 0 END), 0)::float AS expected,
                COALESCE(SUM(CASE WHEN type = 'PAYMENT' THEN amount ELSE 0 END), 0)::float AS paid,
                COALESCE(SUM(CASE WHEN type = 'PRODUCT' THEN kg ELSE 0 END), 0)::float AS kg
            FROM (
                SELECT
                    type,
                    amount,
                    kg,
                    COALESCE(reference_date::date, created_at::date) AS ref_day
                FROM "Ledger"
                WHERE deleted_at IS NULL
                  AND COALESCE(reference_date::date, created_at::date) >= date_trunc('week', $1::date)
                  AND COALESCE(reference_date::date, created_at::date) < date_trunc('week', $1::date) + INTERVAL '7 days'
            ) sub
            GROUP BY ref_day
            ORDER BY ref_day ASC
        `;
    } else if (period === 'month') {
        // Group by week-of-month for current month using reference_date
        query = `
            SELECT
                'Week ' || CEIL(EXTRACT(DAY FROM ref_day) / 7.0)::int AS bucket_label,
                CEIL(EXTRACT(DAY FROM ref_day) / 7.0)::int AS bucket_order,
                COALESCE(SUM(CASE WHEN type = 'PRODUCT' THEN amount ELSE 0 END), 0)::float AS expected,
                COALESCE(SUM(CASE WHEN type = 'PAYMENT' THEN amount ELSE 0 END), 0)::float AS paid,
                COALESCE(SUM(CASE WHEN type = 'PRODUCT' THEN kg ELSE 0 END), 0)::float AS kg
            FROM (
                SELECT
                    type,
                    amount,
                    kg,
                    COALESCE(reference_date::date, created_at::date) AS ref_day
                FROM "Ledger"
                WHERE deleted_at IS NULL
                  AND COALESCE(reference_date::date, created_at::date) >= date_trunc('month', $1::date)
                  AND COALESCE(reference_date::date, created_at::date) < date_trunc('month', $1::date) + INTERVAL '1 month'
            ) sub
            GROUP BY bucket_label, bucket_order
            ORDER BY bucket_order ASC
        `;
    } else {
        // Group by month of current year using reference_date
        query = `
            SELECT
                TO_CHAR(DATE_TRUNC('month', ref_day), 'Mon') AS bucket_label,
                EXTRACT(MONTH FROM ref_day)::int AS bucket_order,
                COALESCE(SUM(CASE WHEN type = 'PRODUCT' THEN amount ELSE 0 END), 0)::float AS expected,
                COALESCE(SUM(CASE WHEN type = 'PAYMENT' THEN amount ELSE 0 END), 0)::float AS paid,
                COALESCE(SUM(CASE WHEN type = 'PRODUCT' THEN kg ELSE 0 END), 0)::float AS kg
            FROM (
                SELECT
                    type,
                    amount,
                    kg,
                    COALESCE(reference_date::date, created_at::date) AS ref_day
                FROM "Ledger"
                WHERE deleted_at IS NULL
                  AND COALESCE(reference_date::date, created_at::date) >= date_trunc('year', $1::date)
                  AND COALESCE(reference_date::date, created_at::date) < date_trunc('year', $1::date) + INTERVAL '1 year'
            ) sub
            GROUP BY DATE_TRUNC('month', ref_day), bucket_label, bucket_order
            ORDER BY bucket_order ASC
        `;
    }

    const result = await pool.query(query, [today]);
    return result.rows.map(r => ({
        bucket_label: r.bucket_label as string,
        bucket_order: Number(r.bucket_order),
        expected: Number(r.expected || 0),
        paid: Number(r.paid || 0),
        kg: Number(r.kg || 0),
    }));
};

// Build the full ordered label set for a given period so missing buckets show as 0
const buildFullLabels = (period: Period, today: Date): { label: string; order: number }[] => {
    if (period === 'week') {
        // Always return Mon–Sun in order (DOW: Mon=1 ... Sun=0)
        return [
            { label: 'Mon', order: 1 },
            { label: 'Tue', order: 2 },
            { label: 'Wed', order: 3 },
            { label: 'Thu', order: 4 },
            { label: 'Fri', order: 5 },
            { label: 'Sat', order: 6 },
            { label: 'Sun', order: 0 },
        ];
    } else if (period === 'month') {
        const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
        const numWeeks = Math.ceil(daysInMonth / 7);
        return Array.from({ length: numWeeks }, (_, i) => ({ label: `Week ${i + 1}`, order: i + 1 }));
    } else {
        return [
            { label: 'Jan', order: 1 }, { label: 'Feb', order: 2 }, { label: 'Mar', order: 3 },
            { label: 'Apr', order: 4 }, { label: 'May', order: 5 }, { label: 'Jun', order: 6 },
            { label: 'Jul', order: 7 }, { label: 'Aug', order: 8 }, { label: 'Sep', order: 9 },
            { label: 'Oct', order: 10 }, { label: 'Nov', order: 11 }, { label: 'Dec', order: 12 },
        ];
    }
};

export const GET = trackApiRoute('/api/dashboard/overview', async (request: Request) => {
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

        const cacheKey = `dashboard-overview-${period}-${today}`;
        const getCached = unstable_cache(
            async () => getOverviewData(period, today),
            [cacheKey],
            { tags: ['dashboard'], revalidate: 3600 }
        );

        const rows = await getCached();

        // Build full label set so every bucket exists even with 0 data
        const fullLabels = buildFullLabels(period, now);

        const labels: string[] = [];
        const expected: number[] = [];
        const paid: number[] = [];
        const kg: number[] = [];

        // For week, handle DOW=0 (Sunday) correctly — order it last
        const sortedLabels = period === 'week'
            ? fullLabels // Already in Mon-Sun order with Sun having order=0
            : fullLabels;

        let cumulativeExpected = 0;
        let cumulativePaid = 0;
        const remaining: number[] = [];

        for (const slot of sortedLabels) {
            const found = rows.find(r => {
                if (period === 'week') {
                    return r.bucket_label === slot.label;
                }
                return r.bucket_order === slot.order;
            });
            labels.push(slot.label);
            const e = found?.expected || 0;
            const p = found?.paid || 0;
            const k = found?.kg || 0;
            expected.push(e);
            paid.push(p);
            kg.push(k);
            cumulativeExpected += e;
            cumulativePaid += p;
            remaining.push(Math.max(0, cumulativeExpected - cumulativePaid));
        }

        const totalExpected = expected.reduce((a, b) => a + b, 0);
        const totalPaid = paid.reduce((a, b) => a + b, 0);
        const totalKg = kg.reduce((a, b) => a + b, 0);
        const totalRemaining = Math.max(0, totalExpected - totalPaid);
        const paymentProgress = totalExpected > 0 ? Math.min(100, Math.round((totalPaid / totalExpected) * 100)) : 0;

        const response = NextResponse.json({
            period,
            labels,
            expected,
            paid,
            kg,
            remaining,
            totals: {
                expected: totalExpected,
                paid: totalPaid,
                remaining: totalRemaining,
                kg: totalKg,
                paymentProgress,
            }
        });
        response.headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
        return response;
    } catch (error: any) {
        console.error('Dashboard Overview Error:', error);
        return NextResponse.json({ error: error.message || 'Failed to fetch overview' }, { status: 500 });
    }
});
