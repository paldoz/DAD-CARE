import { NextResponse, NextRequest } from 'next/server';
import pool from '@/lib/db';
import { requireSession } from '@/lib/require-session';
import { unstable_cache } from 'next/cache';

import { MAQAL_PAIRS_CTE, validateMaqalPairs } from '@/lib/maqal-utils';

const getCachedMaqalPairs = unstable_cache(
    async () => {
        // Query authoritative chronological non-overlapping pairs from DailyBook
        const query = `
            ${MAQAL_PAIRS_CTE}
            SELECT 
                p.mq_num as maqal_id,
                p.date1::text as date1, 
                p.date2::text as date2,
                (
                    SELECT EXISTS (
                        SELECT 1
                        FROM "Ledger" prod
                        WHERE prod.type = 'PRODUCT' AND prod.deleted_at IS NULL
                        AND COALESCE(prod.reference_date::date, prod.created_at::date) IN (p.date1, p.date2)
                        AND (
                            COALESCE((SELECT SUM(amount) FROM "Ledger" WHERE customer_id = prod.customer_id AND type = 'PAYMENT' AND deleted_at IS NULL), 0)
                            > 
                            COALESCE((SELECT SUM(amount) FROM "Ledger" WHERE customer_id = prod.customer_id AND type = 'PRODUCT' AND deleted_at IS NULL AND COALESCE(reference_date::date, created_at::date) < p.date1), 0)
                        )
                    )
                ) as has_payments,
                -- Count of distinct customers who have products in this pair
                (
                    SELECT COUNT(DISTINCT prod.customer_id)
                    FROM "Ledger" prod
                    WHERE prod.type = 'PRODUCT' AND prod.deleted_at IS NULL
                    AND COALESCE(prod.reference_date::date, prod.created_at::date) IN (p.date1, p.date2)
                ) as total_customers,
                -- Count of distinct customers who have payments for this pair
                (
                    SELECT COUNT(DISTINCT prod.customer_id)
                    FROM "Ledger" prod
                    WHERE prod.type = 'PRODUCT' AND prod.deleted_at IS NULL
                    AND COALESCE(prod.reference_date::date, prod.created_at::date) IN (p.date1, p.date2)
                    AND (
                        COALESCE((SELECT SUM(amount) FROM "Ledger" WHERE customer_id = prod.customer_id AND type = 'PAYMENT' AND deleted_at IS NULL), 0)
                        > 
                        COALESCE((SELECT SUM(amount) FROM "Ledger" WHERE customer_id = prod.customer_id AND type = 'PRODUCT' AND deleted_at IS NULL AND COALESCE(reference_date::date, created_at::date) < p.date1), 0)
                    )
                ) as payment_count
            FROM pairs p
            ORDER BY p.date1 DESC;
        `;
        
        const result = await pool.query(query);
        const pairsToValidate = result.rows.map(r => ({
            mq_num: Number(r.maqal_id),
            date1: String(r.date1).split('T')[0],
            date2: String(r.date2).split('T')[0]
        }));
        validateMaqalPairs(pairsToValidate.slice().reverse());
        return result.rows;
    },
    ['maqal-pairs-data'],
    { revalidate: 3600, tags: ['customers', 'dashboard'] }
);

export async function GET(request: NextRequest) {
    try {
        const sessionRes = await requireSession(request);
        if (sessionRes instanceof NextResponse) return sessionRes;

        // Auto-migration for maqal_id
        try {
            await pool.query('ALTER TABLE "Ledger" ADD COLUMN IF NOT EXISTS maqal_id INTEGER;');
        } catch (e) {
            console.error('Migration failed:', e);
        }

        const rows = await getCachedMaqalPairs();
        
        const res = NextResponse.json(rows);
        res.headers.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=3600');
        return res;
    } catch (error: any) {
        console.error('Error fetching maqal pairs:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error', stack: error.stack }, { status: 500 });
    }
}
