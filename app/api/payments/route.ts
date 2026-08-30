import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/require-session';
import { logAudit } from '@/lib/audit';
import { trackApiRoute } from '@/lib/egress-tracker';
import { revalidateTag } from 'next/cache';
import { MAQAL_PAIRS_CTE } from '@/lib/maqal-utils';

export const dynamic = 'force-dynamic';

export const GET = trackApiRoute('/api/payments', async (request: Request) => {
    const { errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(request.url);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')));
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0'));
    const customerId = searchParams.get('customerId');
    const period = searchParams.get('period') || 'all';
    const search = searchParams.get('search')?.trim();

    try {
        const filters: string[] = [`l.type = 'PAYMENT'`, `l.deleted_at IS NULL`];
        const params: any[] = [];

        // Customer filter
        if (customerId && customerId !== 'all') {
            params.push(customerId);
            filters.push(`l.customer_id = $${params.length}`);
        }

        // Period filter
        if (period === 'today') {
            filters.push(`COALESCE(l.reference_date::date, l.created_at::date) = (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Mogadishu')::date`);
        } else if (period === 'week') {
            filters.push(`COALESCE(l.reference_date::date, l.created_at::date) >= date_trunc('week', (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Mogadishu')::date)`);
        } else if (period === 'month') {
            filters.push(`COALESCE(l.reference_date::date, l.created_at::date) >= date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Mogadishu')::date)`);
        } else if (period === 'year') {
            filters.push(`COALESCE(l.reference_date::date, l.created_at::date) >= date_trunc('year', (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Mogadishu')::date)`);
        }

        // Search filter
        if (search) {
            params.push(`%${search}%`);
            const pIdx = params.length;
            filters.push(`(c.name ILIKE $${pIdx} OR c.customer_code ILIKE $${pIdx} OR l.note ILIKE $${pIdx})`);
        }

        const whereClause = filters.join(' AND ');

        // Customer-only filter for totalAllTime
        const customerOnlyWhere = (customerId && customerId !== 'all') 
            ? `AND customer_id = $1` 
            : ``;

        params.push(limit);
        const limitParam = `$${params.length}`;
        params.push(offset);
        const offsetParam = `$${params.length}`;

        const query = `
            ${MAQAL_PAIRS_CTE},
            filtered_payments AS (
                SELECT
                    l.id, l.customer_id, l.type, l.reference_date, l.amount, l.previous_debt, l.new_debt, l.note, l.created_at, l.receipt_id,
                    COALESCE(np.mq_num, CASE WHEN l.maqal_id IS NOT NULL THEN (l.maqal_id - 8) ELSE NULL END) as maqal_id,
                    json_build_object(
                        'id', c.id,
                        'name', c.name,
                        'customer_code', c.customer_code
                    ) as customer
                FROM "Ledger" l
                LEFT JOIN "Customer" c ON c.id = l.customer_id
                LEFT JOIN pairs np ON np.maqal_id = l.maqal_id
                WHERE ${whereClause}
            ),
            stats AS (
                SELECT
                    COUNT(*)::int AS total_count,
                    COALESCE(SUM(amount), 0)::float AS period_total,
                    (SELECT COALESCE(SUM(amount), 0)::float FROM "Ledger" WHERE type = 'PAYMENT' AND deleted_at IS NULL ${customerOnlyWhere}) AS total_all_time
                FROM filtered_payments
            )
            SELECT 
                (SELECT total_count FROM stats) AS _total_count,
                (SELECT period_total FROM stats) AS _period_total,
                (SELECT total_all_time FROM stats) AS _total_all_time,
                fp.*
            FROM filtered_payments fp
            ORDER BY fp.created_at DESC, fp.id DESC
            LIMIT ${limitParam} OFFSET ${offsetParam}
        `;

        const { rows } = await pool.query(query, params);

        let totalCount = 0;
        let periodTotal = 0;
        let totalAllTime = 0;

        if (rows.length > 0) {
            totalCount = rows[0]._total_count || 0;
            periodTotal = rows[0]._period_total || 0;
            totalAllTime = rows[0]._total_all_time || 0;
        } else if (offset > 0) {
            const statsQuery = `
                SELECT 
                    COUNT(*)::int AS total_count,
                    COALESCE(SUM(amount), 0)::float AS period_total,
                    (SELECT COALESCE(SUM(amount), 0)::float FROM "Ledger" WHERE type = 'PAYMENT' AND deleted_at IS NULL ${customerOnlyWhere}) AS total_all_time
                FROM "Ledger" l
                LEFT JOIN "Customer" c ON c.id = l.customer_id
                WHERE ${whereClause}
            `;
            const statsRes = await pool.query(statsQuery, params.slice(0, params.length - 2));
            totalCount = statsRes.rows[0]?.total_count || 0;
            periodTotal = statsRes.rows[0]?.period_total || 0;
            totalAllTime = statsRes.rows[0]?.total_all_time || 0;
        }

        const payments = rows.map(({ _total_count, _period_total, _total_all_time, amount, previous_debt, new_debt, ...rest }) => ({
            ...rest,
            amount: Number(amount) || 0,
            previous_debt: Number(previous_debt) || 0,
            new_debt: Number(new_debt) || 0,
        }));

        const hasMore = offset + payments.length < totalCount;
        const nextOffset = hasMore ? offset + payments.length : null;

        const response = NextResponse.json({
            payments,
            totalCount,
            periodTotal,
            totalAllTime,
            hasMore,
            nextOffset,
            todayTotal: period === 'today' ? periodTotal : 0,
            count: payments.length
        });
        response.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
        return response;
    } catch (error: any) {
        console.error('Payments Fetch Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});

export const POST = trackApiRoute('/api/payments', async (request: Request) => {
    const { errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;
    const body = await request.json();
    const { customerId, amount, note, date, maqal_id } = body;

    try {
        if (!customerId || !amount) {
            return NextResponse.json({ error: 'Customer and amount required' }, { status: 400 });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Lock the customer row and get latest debt atomically
            const { rows: lastEntries } = await client.query(
                `SELECT new_debt FROM "Ledger"
                 WHERE customer_id = $1 AND deleted_at IS NULL
                 ORDER BY created_at DESC, id DESC LIMIT 1
                 FOR UPDATE SKIP LOCKED`,
                [customerId]
            );

            const previousDebt = lastEntries[0]?.new_debt || 0;
            const paymentAmount = Math.round(parseFloat(amount));
            const newDebt = Math.round(previousDebt - paymentAmount);
            const refDate = date || new Date().toISOString().split('T')[0];

            await client.query(
                `INSERT INTO "Ledger" (id, customer_id, type, reference_date, amount, previous_debt, new_debt, note, receipt_id, maqal_id)
                 VALUES (gen_random_uuid(), $1, 'PAYMENT', $2, $3, $4, $5, $6, $7, $8)`,
                [customerId, refDate, paymentAmount, previousDebt, newDebt, note || null, body.receipt_id || null, maqal_id || null]
            );

            await client.query('COMMIT');

            // BUST CACHE FOR FULL AUTOMATIC REFRESH
            // @ts-ignore
            revalidateTag('ledger');
            // @ts-ignore
            revalidateTag('customers');
            // @ts-ignore
            revalidateTag('dashboard');
            // @ts-ignore
            revalidateTag('customer-daily-entries');
            // @ts-ignore
            revalidateTag(`ledger-${customerId}`);
            // @ts-ignore
            revalidateTag(`daily-entries-${customerId}`);

            await logAudit(request, 'ADD_PAYMENT', `Payment of ${paymentAmount} recorded for customer ID: ${customerId}`);
            return NextResponse.json({ success: true, newDebt });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error: any) {
        console.error('Payment Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
