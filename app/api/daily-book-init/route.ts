import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireSession } from '@/lib/require-session';
import { trackApiRoute } from '@/lib/egress-tracker';

async function getDailyBookInit() {
    // Fetch customers sorted by their numeric customer_code (so #1 comes before #2, etc.)
    const { rows: customers } = await pool.query(`
      SELECT id, name, customer_code, gender, phone
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
}

export const GET = trackApiRoute('/api/daily-book-init', async (request: Request) => {
    const { errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;
    try {
        const data = await getDailyBookInit();
        const response = NextResponse.json(data);
        // Allow Vercel edge to cache for 60s, then serve stale while revalidating in background.
        // Customers list + latestDate change infrequently — this saves a DB hit on every page load.
        response.headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
        return response;
    } catch (error: any) {
        console.error('Daily Book Init Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
