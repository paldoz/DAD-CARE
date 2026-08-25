import { NextResponse, NextRequest } from 'next/server';
import pool from '@/lib/db';
import { requireSession } from '@/lib/require-session';

import { unstable_cache } from 'next/cache';

import { MAQAL_PAIRS_CTE } from '@/lib/maqal-utils';

const getCachedMaqalLatest = unstable_cache(
    async () => {
        const query = `
            ${MAQAL_PAIRS_CTE},
            latest_pair AS (
                SELECT date1, date2, mq_num as maqal_id
                FROM pairs
                ORDER BY mq_num DESC
                LIMIT 1
            ),
            pair_customers AS (
                SELECT DISTINCT
                    c.id,
                    c.name,
                    c.customer_code
                FROM "Customer" c
                JOIN "Ledger" l ON l.customer_id = c.id
                CROSS JOIN latest_pair lp
                WHERE l.type = 'PRODUCT'
                  AND l.deleted_at IS NULL
                  AND c.deleted_at IS NULL
                  AND COALESCE(l.reference_date::date, l.created_at::date) IN (lp.date1, lp.date2)
            ),
            customer_payments AS (
                SELECT
                    pc.id as customer_id,
                    EXISTS (
                        SELECT 1
                        FROM "Ledger" prod
                        JOIN latest_pair lp ON TRUE
                        WHERE prod.customer_id = pc.id
                          AND prod.type = 'PRODUCT'
                          AND prod.deleted_at IS NULL
                          AND COALESCE(prod.reference_date::date, prod.created_at::date) IN (lp.date1, lp.date2)
                          AND EXISTS (
                              SELECT 1
                              FROM "Ledger" pay
                              WHERE pay.customer_id = prod.customer_id
                                AND pay.type = 'PAYMENT'
                                AND pay.deleted_at IS NULL
                                AND pay.created_at >= prod.created_at
                                AND pay.created_at < COALESCE(
                                    (SELECT MIN(created_at) FROM "Ledger" next_prod
                                     WHERE next_prod.customer_id = prod.customer_id
                                       AND next_prod.type = 'PRODUCT'
                                       AND next_prod.deleted_at IS NULL
                                       AND next_prod.created_at > prod.created_at
                                    ),
                                    'infinity'::timestamp
                                )
                          )
                    ) as has_payment
                FROM pair_customers pc
            )
            SELECT
                (SELECT maqal_id FROM latest_pair) as maqal_id,
                (SELECT date1::text FROM latest_pair) as date1,
                (SELECT date2::text FROM latest_pair) as date2,
                json_agg(
                    json_build_object(
                        'id', pc.id,
                        'name', pc.name,
                        'customer_code', pc.customer_code,
                        'has_payment', cp.has_payment
                    ) ORDER BY pc.customer_code ASC
                ) as customers
            FROM pair_customers pc
            JOIN customer_payments cp ON cp.customer_id = pc.id;
        `;

        const result = await pool.query(query);
        return result.rows[0];
    },
    ['maqal-latest-cache'],
    { revalidate: 300, tags: ['maqal-latest', 'customers'] }
);

// Returns the LATEST maqal pair with full customer list and payment status per customer
export async function GET(request: NextRequest) {
    try {
        const sessionRes = await requireSession(request);
        if (sessionRes instanceof NextResponse) return sessionRes;

        const row = await getCachedMaqalLatest();

        if (!row || !row.date1) {
            return NextResponse.json({ date1: null, date2: null, customers: [] });
        }

        const res = NextResponse.json({
            date1: row.date1,
            date2: row.date2,
            customers: row.customers || [],
        });
        res.headers.set('Cache-Control', 'private, max-age=300, stale-while-revalidate=600');
        return res;
    } catch (error: any) {
        console.error('Error fetching latest maqal:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
