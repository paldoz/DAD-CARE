import { NextResponse, NextRequest } from 'next/server';
import pool from '@/lib/db';
import { requireSession } from '@/lib/require-session';
import { unstable_cache } from 'next/cache';

const getCachedMaqalPairs = unstable_cache(
    async () => {
        // Query historical pairs from DailyBook
        // We return ALL consecutive pairs of dates (rolling window) to guarantee no pairs are missed
        const query = `
            WITH past_dates AS (
                SELECT DISTINCT date::date as db_date
                FROM "DailyBook"
                WHERE deleted_at IS NULL
            ),
            numbered_dates AS (
                SELECT db_date,
                       ROW_NUMBER() OVER (ORDER BY db_date DESC) as rn
                FROM past_dates
            ),
            pairs AS (
                SELECT n2.db_date::date as date1, n1.db_date::date as date2
                FROM numbered_dates n1
                JOIN numbered_dates n2 ON n1.rn = n2.rn - 1
                WHERE n1.rn % 2 = 1
            ),
            numbered_pairs AS (
                SELECT date1, date2,
                       ROW_NUMBER() OVER (ORDER BY date2 ASC) as maqal_id
                FROM pairs
            )
            SELECT 
                p.maqal_id,
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
            FROM numbered_pairs p
            ORDER BY p.date1 DESC;
        `;
        
        const result = await pool.query(query);
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
