import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/require-session';
import { trackApiRoute } from '@/lib/egress-tracker';
import { unstable_cache } from 'next/cache';

export const dynamic = 'force-dynamic';

const getCachedReportsData = unstable_cache(
    async () => {
        const { rows } = await pool.query(`
            WITH latest_ledger AS (
                SELECT DISTINCT ON (customer_id)
                    customer_id, new_debt, type
                FROM "Ledger"
                WHERE deleted_at IS NULL
                ORDER BY customer_id, created_at DESC, id DESC
            )
            SELECT
                c.id,
                c.name,
                c.customer_code as code,

                -- Total KG from all PRODUCT entries
                COALESCE(SUM(CASE WHEN l.type = 'PRODUCT' THEN l.kg ELSE 0 END), 0)::float        AS "totalKg",

                -- Total PRODUCT amount (what they consumed = maqal)
                COALESCE(SUM(CASE WHEN l.type = 'PRODUCT' THEN l.amount ELSE 0 END), 0)::float    AS "totalProductAmount",

                -- Total payments made
                COALESCE(SUM(CASE WHEN l.type = 'PAYMENT' THEN l.amount ELSE 0 END), 0)::float    AS "totalPaid",

                -- Count of PRODUCT transactions
                COUNT(CASE WHEN l.type = 'PRODUCT' THEN 1 END)::int                               AS "productTxnCount",

                -- Current balance from DISTINCT ON join (single scan, not N correlated subqueries)
                COALESCE(ll.new_debt, 0)::float AS "currentDebt",

                -- Is Reesto = last transaction was a PAYMENT
                COALESCE((ll.type = 'PAYMENT'), false) AS "is_reesto"

            FROM "Customer" c
            LEFT JOIN "Ledger" l ON l.customer_id = c.id AND l.deleted_at IS NULL
            LEFT JOIN latest_ledger ll ON ll.customer_id = c.id
            GROUP BY c.id, c.name, c.customer_code, ll.new_debt, ll.type
            ORDER BY c.name ASC
        `);

        return rows.map((stats: any) => {
            const totalProductAmount = parseFloat(stats.totalProductAmount) || 0;
            const totalPaid = parseFloat(stats.totalPaid) || 0;
            const totalKg = parseFloat(stats.totalKg) || 0;
            const productTxnCount = parseInt(stats.productTxnCount) || 0;
            const averageKg = productTxnCount > 0 ? totalKg / productTxnCount : 0;

            let performanceScore = 0;
            if (totalProductAmount === 0 && totalPaid === 0) {
                performanceScore = 100;
            } else if (totalProductAmount === 0 && totalPaid > 0) {
                performanceScore = 100;
            } else {
                performanceScore = Math.min((totalPaid / totalProductAmount) * 100, 100);
            }

            return {
                id: stats.id,
                name: stats.name,
                code: stats.code,
                totalPaid,
                totalProductAmount,
                totalKg,
                averageKg,
                productTxnCount,
                currentDebt: parseFloat(stats.currentDebt) || 0,
                is_reesto: stats.is_reesto,
                performanceScore
            };
        });
    },
    ['reports-data'],
    { revalidate: 3600, tags: ['customers', 'dashboard', 'reports'] }
);

export const GET = trackApiRoute('/api/reports', async (request: Request) => {
    const { errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;

    try {
        const reportData = await getCachedReportsData();
        const res = NextResponse.json(reportData);
        res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        return res;
    } catch (error: any) {
        console.error('Reports API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
