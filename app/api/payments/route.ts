import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/require-session';
import { logAudit } from '@/lib/audit';
import { trackApiRoute } from '@/lib/egress-tracker';
import { unstable_cache, revalidateTag } from 'next/cache';

const getCachedPayments = unstable_cache(
    async (limit: number, customerId: string | null, today: string) => {
        const params: any[] = [];
        const filters: string[] = [`l.type = 'PAYMENT'`, `l.deleted_at IS NULL`];

        if (customerId) {
            params.push(customerId);
            filters.push(`l.customer_id = $${params.length}`);
        }

        const whereClause = filters.join(' AND ');
        params.push(today);
        const todayParam = `$${params.length}`;

        const { rows } = await pool.query(
            `SELECT
                l.id, l.customer_id, l.type, l.reference_date, l.amount, l.previous_debt, l.new_debt, l.note, l.created_at, l.receipt_id, l.maqal_id,
                json_build_object(
                    'id', c.id,
                    'name', c.name,
                    'customer_code', c.customer_code
                ) as customer,
                -- Window aggregates computed in DB (zero extra round-trips)
                SUM(l.amount) OVER () AS _total_all_time,
                SUM(CASE WHEN COALESCE(l.reference_date, l.created_at::date) = ${todayParam}::date THEN l.amount ELSE 0 END) OVER () AS _today_total
             FROM "Ledger" l
             LEFT JOIN "Customer" c ON c.id = l.customer_id
             WHERE ${whereClause}
             ORDER BY l.created_at DESC, l.id DESC
             LIMIT ${limit}`,
            params
        );

        return rows;
    },
    ['payments-data'],
    { revalidate: 3600, tags: ['customers', 'dashboard'] }
);

export const GET = trackApiRoute('/api/payments', async (request: Request) => {
    const { errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const customerId = searchParams.get('customerId');

    try {
        const today = new Date().toISOString().split('T')[0];
        
        const rows = await getCachedPayments(limit, customerId, today);

        const totalAllTime = rows[0]?._total_all_time ? parseFloat(rows[0]._total_all_time) : 0;
        const todayTotal   = rows[0]?._today_total   ? parseFloat(rows[0]._today_total)   : 0;

        // Strip internal aggregate columns from the payment objects and parse numeric fields
        const payments = rows.map(({ _total_all_time, _today_total, amount, previous_debt, new_debt, ...rest }) => ({
            ...rest,
            amount: Number(amount) || 0,
            previous_debt: Number(previous_debt) || 0,
            new_debt: Number(new_debt) || 0
        }));

        const response = NextResponse.json({
            payments,
            todayTotal,
            totalAllTime,
            count: payments.length,
        });
        response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
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
