import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { validateSession } from '@/lib/sessions-store';
import { trackApiRoute } from '@/lib/egress-tracker';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Period = 'week' | 'month' | 'year' | 'all';

const getMqAnalyticsData = async (period: Period, today: string) => {
    /*
     * MQ date-pair approach (matches the History page exactly):
     * 1. Derive MQ date pairs from DailyBook (sequential pairs of dates).
     * 2. For each MQ, calculate:
     *    - Expected = SUM of PRODUCT amounts on those two dates
     *    - KG       = SUM of KG on those two dates (PRODUCT rows)
     *    - Paid     = SUM of PAYMENT amounts with maqal_id matching this pair's number,
     *                 OR payments on those dates if maqal_id is unset
     *    - Remaining = Expected - Paid
     * 3. Per-customer breakdown using the same date-pair logic.
     */

    const periodFilter = period !== 'all'
        ? `AND (p.date2 >= date_trunc('${period}', '${today}'::date)
           AND p.date2 < date_trunc('${period}', '${today}'::date) + INTERVAL '1 ${period}')`
        : '';

    const query = `
        WITH
        -- Step 1: All distinct DailyBook dates
        past_dates AS (
            SELECT DISTINCT date::date AS db_date
            FROM "DailyBook"
            WHERE deleted_at IS NULL
        ),
        -- Step 2: Number the dates chronologically (newest first)
        numbered_dates AS (
            SELECT db_date,
                   ROW_NUMBER() OVER (ORDER BY db_date DESC) AS rn
            FROM past_dates
        ),
        -- Step 3: Pair consecutive dates into MQs (newest pairs first)
        pairs AS (
            SELECT n2.db_date AS date1, n1.db_date AS date2
            FROM numbered_dates n1
            JOIN numbered_dates n2 ON n1.rn = n2.rn - 1
            WHERE n1.rn % 2 = 1
        ),
        -- Step 4: Assign sequential MQ numbers (MQ#1 is the oldest pair)
        numbered_pairs AS (
            SELECT
                ROW_NUMBER() OVER (ORDER BY date2 ASC) AS mq_num,
                date1,
                date2
            FROM pairs
        ),
        -- Step 5: Filter by period if needed
        filtered_pairs AS (
            SELECT * FROM numbered_pairs p
            WHERE 1=1
            ${periodFilter}
        ),
        -- Step 6a: Fetch EXACT KG from DailyBookItem to guarantee 100% accuracy with History page
        mq_dailybook_items AS (
            SELECT
                fp.mq_num,
                dbi.customer_id,
                c.name    AS customer_name,
                c.customer_code,
                SUM(COALESCE(dbi.kg, 0)) AS db_kg
            FROM filtered_pairs fp
            JOIN "DailyBook" db ON db.deleted_at IS NULL AND db.date::date IN (fp.date1, fp.date2)
            JOIN "DailyBookItem" dbi ON dbi.daily_book_id = db.id AND dbi.deleted_at IS NULL
            JOIN "Customer" c ON c.id = dbi.customer_id AND c.deleted_at IS NULL
            GROUP BY fp.mq_num, dbi.customer_id, c.name, c.customer_code
        ),
        -- All PRODUCT ledger rows with price details for breakdown dialog
        mq_product_details AS (
            SELECT 
                fp.mq_num, 
                l.customer_id, 
                SUM(l.amount) AS expected,
                MAX(l.price_per_kg) AS price_per_kg,
                COALESCE(SUM(CASE WHEN COALESCE(l.reference_date::date, l.created_at::date) = fp.date1 THEN l.kg ELSE 0 END), 0) AS kg_day1,
                COALESCE(SUM(CASE WHEN COALESCE(l.reference_date::date, l.created_at::date) = fp.date2 THEN l.kg ELSE 0 END), 0) AS kg_day2
            FROM filtered_pairs fp
            JOIN "Ledger" l ON l.type = 'PRODUCT'
                            AND l.deleted_at IS NULL
                            AND COALESCE(l.reference_date::date, l.created_at::date) IN (fp.date1, fp.date2)
            GROUP BY fp.mq_num, l.customer_id
        ),

        -- Payments tagged to a specific MQ (maqal_id = integer)
        specific_payments AS (
            SELECT customer_id, maqal_id AS mq_num, SUM(amount) AS amount
            FROM "Ledger" 
            WHERE type = 'PAYMENT' AND deleted_at IS NULL AND maqal_id IS NOT NULL
            GROUP BY customer_id, maqal_id
        )
        -- Step 8: Join and aggregate per MQ
        SELECT
            fp.mq_num,
            fp.date1::text,
            fp.date2::text,
            COUNT(DISTINCT dbi.customer_id)          AS total_customers,
            COALESCE(SUM(mpd.expected), 0)           AS expected,
            -- ACCURATE: Only count payments explicitly tagged to this MQ via maqal_id
            COALESCE(SUM(COALESCE(sp.amount, 0)), 0) AS paid,
            COALESCE(SUM(dbi.db_kg), 0)              AS kg,
            -- Customer-level JSON for breakdown dialog
            JSON_AGG(
                JSON_BUILD_OBJECT(
                    'customer_id',   dbi.customer_id,
                    'name',          dbi.customer_name,
                    'code',          dbi.customer_code,
                    'expected',      COALESCE(mpd.expected, 0),
                    'paid',          COALESCE(sp.amount, 0),
                    'kg',            COALESCE(dbi.db_kg, 0),
                    'price_per_kg',  COALESCE(mpd.price_per_kg, 0),
                    'kg_day1',       COALESCE(mpd.kg_day1, 0),
                    'kg_day2',       COALESCE(mpd.kg_day2, 0)
                )
            ) FILTER (WHERE dbi.customer_id IS NOT NULL) AS customer_data
        FROM filtered_pairs fp
        LEFT JOIN mq_dailybook_items dbi ON dbi.mq_num = fp.mq_num
        LEFT JOIN mq_product_details mpd ON mpd.mq_num = fp.mq_num AND mpd.customer_id = dbi.customer_id
        LEFT JOIN specific_payments sp ON sp.customer_id = dbi.customer_id AND sp.mq_num = fp.mq_num
        GROUP BY fp.mq_num, fp.date1, fp.date2
        HAVING COALESCE(SUM(mpd.expected), 0) > 0 OR COALESCE(SUM(dbi.db_kg), 0) > 0
        ORDER BY fp.mq_num ASC
    `;

    const result = await pool.query(query);

    const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

    const mqs = result.rows.map(row => {
        const expected          = Number(row.expected  || 0);
        const paid              = Number(row.paid      || 0);
        const kg                = Number(row.kg        || 0);
        const remaining         = Math.max(0, expected - paid);
        const paymentPercentage = expected > 0
            ? Math.min(100, Math.round((paid / expected) * 100))
            : (paid > 0 ? 100 : 0);

        const startDate = row.date1 ? fmt(row.date1) : '';
        const endDate   = row.date2 ? fmt(row.date2) : '';
        const dateRange = `${startDate} – ${endDate}`;

        const rawCustomers: any[] = typeof row.customer_data === 'string'
            ? JSON.parse(row.customer_data)
            : (row.customer_data || []);

        const customers = rawCustomers
            .map(c => ({
                id:          c.customer_id,
                name:        c.name,
                code:        c.code,
                expected:    Number(c.expected    || 0),
                paid:        Number(c.paid        || 0),
                kg:          Number(c.kg          || 0),
                pricePerKg:  Number(c.price_per_kg || 0),
                kgDay1:      Number(c.kg_day1     || 0),
                kgDay2:      Number(c.kg_day2     || 0),
                remaining:   Math.max(0, Number(c.expected || 0) - Number(c.paid || 0)),
                paymentPct:  Number(c.expected || 0) > 0
                    ? Math.min(100, Math.round((Number(c.paid || 0) / Number(c.expected || 0)) * 100))
                    : (Number(c.paid || 0) > 0 ? 100 : 0),
            }))
            .sort((a, b) => b.remaining - a.remaining);

        return {
            id:                String(row.mq_num),
            mqNumber:          Number(row.mq_num),
            label:             `MQ#${row.mq_num}`,
            dateRange,
            startDate,
            endDate,
            kg,
            expected,
            paid,
            remaining,
            paymentPercentage,
            customerCount:     Number(row.total_customers || 0),
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
        response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        response.headers.set('Pragma', 'no-cache');
        return response;
    } catch (error: any) {
        console.error('[mq-analytics] Error:', error);
        return NextResponse.json({ error: 'Failed to fetch MQ analytics', details: error.message }, { status: 500 });
    }
});
