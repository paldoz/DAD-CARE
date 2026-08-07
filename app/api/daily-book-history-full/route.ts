import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/require-session';
import pool from '@/lib/db';
import { trackApiRoute } from '@/lib/egress-tracker';
import { unstable_cache } from 'next/cache';

const getCachedHistoryFull = unstable_cache(
    async () => {
        const { rows } = await pool.query(`
            SELECT 
                db.id, 
                db.date,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'id', dbi.id,
                            'kg', dbi.kg,
                            'present', dbi.present,
                            'note', dbi.note,
                            'customer_id', dbi.customer_id,
                            'customer',    json_build_object(
                                'id', c.id,
                                'name', c.name,
                                'customer_code', c.customer_code,
                                'gender', c.gender
                            )
                        ) ORDER BY CASE WHEN c.customer_code ~ '^[0-9]+$' THEN c.customer_code::int ELSE 9999 END ASC, c.name ASC
                    ) FILTER (WHERE dbi.id IS NOT NULL), 
                    '[]'::json
                ) as items
            FROM "DailyBook" db
            LEFT JOIN "DailyBookItem" dbi ON dbi.daily_book_id = db.id AND dbi.deleted_at IS NULL
            LEFT JOIN "Customer" c ON c.id = dbi.customer_id
            WHERE db.deleted_at IS NULL
            GROUP BY db.id, db.date
            ORDER BY db.date DESC
            LIMIT 15
        `);
        return rows;
    },
    ['daily-book-history-full-cache'],
    { revalidate: 120, tags: ['daily-book-history'] }
);

export const GET = trackApiRoute('/api/daily-book-history-full', async (request: Request) => {
    const { errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;

    try {
        const historyResult = await getCachedHistoryFull();

        const history = (historyResult || []).map((book: any) => {
            const itemsList = typeof book.items === 'string' ? JSON.parse(book.items) : (book.items || []);
            const totalKg = itemsList.reduce((sum: number, item: any) => sum + (item.kg || 0), 0);
            return {
                id: book.id,
                date: book.date,
                totalKg: totalKg,
                items: itemsList.map((item: any) => ({
                    customer_id: item.customer_id,
                    kg: item.kg,
                    present: item.present,
                    note: item.note,
                    customer: item.customer
                }))
            };
        });

        const response = NextResponse.json(history);
        response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400');
        return response;
    } catch (error: any) {
        console.error('Fetch Daily Book Full History Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
