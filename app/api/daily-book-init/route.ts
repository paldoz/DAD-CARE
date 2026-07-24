import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireSession } from '@/lib/require-session';
import { trackApiRoute } from '@/lib/egress-tracker';

import { unstable_cache } from 'next/cache';

const getDailyBookInit = unstable_cache(
    async () => {
        // Auto-migrate missing columns for dev environment gracefully
        try {
            await pool.query('ALTER TABLE "Customer" ADD COLUMN is_unassignable BOOLEAN DEFAULT false');
        } catch (e) { /* ignore */ }
        try {
            await pool.query('ALTER TABLE "Customer" ADD COLUMN is_kabarka BOOLEAN DEFAULT false');
        } catch (e) { /* ignore */ }

        // Fetch customers sorted by their numeric customer_code (so #1 comes before #2, etc.)
        const { rows: customers } = await pool.query(`
          SELECT id, name, customer_code, is_kabarka, is_unassignable
          FROM "Customer"
          WHERE deleted_at IS NULL
          ORDER BY 
            CASE WHEN customer_code ~ '^[0-9]+$' THEN customer_code::int ELSE 9999 END ASC,
            name ASC
        `);

        // Get the most recent daily-book date (no full history)
        const { rows: recent } = await pool.query(`
          SELECT date FROM "DailyBook"
          WHERE deleted_at IS NULL
          ORDER BY date DESC
          LIMIT 1
        `);
        const latestDate = recent.length > 0 ? recent[0].date : null;

        // Get total number of saved days
        const { rows: countRow } = await pool.query(`
          SELECT COUNT(*) as total FROM "DailyBook"
          WHERE deleted_at IS NULL
        `);
        const historyCount = parseInt(countRow[0].total, 10) || 0;

        return {
          customers,
          latestDate,
          historyCount,
        };
    },
    ['daily-book-init-cache'],
    { revalidate: 3600, tags: ['daily-book-init', 'customers'] }
);

export const GET = trackApiRoute('/api/daily-book-init', async (request: Request) => {
    const { errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;
    try {
        const data = await getDailyBookInit();
        const response = NextResponse.json(data);
        // Allow edge/browser to serve stale for up to 10 min while revalidating in bg.
        // Customers list + latestDate change infrequently — this saves a DB hit on every page load.
        response.headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
        return response;
    } catch (error: any) {
        console.error('Daily Book Init Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
