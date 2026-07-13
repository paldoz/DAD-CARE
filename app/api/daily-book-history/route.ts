import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/require-session';
import pool from '@/lib/db';
import { trackApiRoute } from '@/lib/egress-tracker';
import { unstable_cache } from 'next/cache';

// Cache history for 2 minutes — these records almost never change within a minute
const getCachedHistory = unstable_cache(
    async (limit: number, offset: number) => {
        const { rows } = await pool.query(`
            SELECT 
                db.id, 
                db.date,
                COALESCE(SUM(dbi.kg), 0)::float as total_kg,
                COUNT(dbi.id) as item_count,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'customer_id', dbi.customer_id,
                            'kg',          dbi.kg,
                            'present',     dbi.present,
                            'note',        dbi.note
                        )
                    ) FILTER (WHERE dbi.id IS NOT NULL),
                    '[]'::json
                ) as items
            FROM "DailyBook" db
            LEFT JOIN "DailyBookItem" dbi ON dbi.daily_book_id = db.id AND dbi.deleted_at IS NULL
            WHERE db.deleted_at IS NULL
            GROUP BY db.id, db.date
            ORDER BY db.date DESC
            LIMIT $1 OFFSET $2
        `, [limit, offset]);
        return rows;
    },
    ['daily-book-history-cache'],
    { revalidate: 120, tags: ['daily-book-history'] }
);

export const GET = trackApiRoute('/api/daily-book-history', async (request: Request) => {
    const { errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '7', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const historyResult = await getCachedHistory(limit, offset);

    try {
        const history = (historyResult || []).map((book: any) => {
            const itemsList: any[] = typeof book.items === 'string'
                ? JSON.parse(book.items)
                : (book.items || []);

            return {
                id: book.id,
                date: book.date,
                totalKg: parseFloat(book.total_kg) || 0,
                itemCount: parseInt(book.item_count) || 0,
                items: itemsList.map((item: any) => ({
                    customer_id: item.customer_id,
                    kg:          item.kg,
                    note:        item.note    || null,
                    present:     item.present ?? true,
                }))
            };
        });

        const response = NextResponse.json(history);
        response.headers.set('Cache-Control', 'private, max-age=120, stale-while-revalidate=300');
        return response;
    } catch (error: any) {
        console.error('Fetch Daily Book History Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});

