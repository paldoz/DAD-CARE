import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireSession } from '@/lib/require-session';
import { trackApiRoute } from '@/lib/egress-tracker';

import { unstable_cache } from 'next/cache';

const getDailyBookInit = unstable_cache(
    async () => {
        // Fetch customers sorted by their numeric customer_code (so #1 comes before #2, etc.)
        const { rows: customers } = await pool.query(`
          SELECT id, name, customer_code, is_kabarka, is_unassignable, created_at, deleted_at, first_daily_book_date::text as first_daily_book_date
          FROM "Customer"
          ORDER BY 
            CASE WHEN customer_code ~ '^[0-9]+$' THEN customer_code::int ELSE 9999 END ASC,
            name ASC
        `);

        // Get the most recent daily-book date (no full history)
        const { rows: recent } = await pool.query(`
          SELECT date::text as date FROM "DailyBook"
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

        // Fetch configured BusinessDays (e.g. ABSENCE days) — RESTORED, do not remove
        const { rows: bDays } = await pool.query(`
          SELECT date::text as date, status, reason FROM "BusinessDay"
          ORDER BY date DESC
        `);

        // Get VIP Caadi config from Settings (additive — does not replace businessDays)
        let vipCaadiConfig: any[] = [];
        try {
            const { rows: vipSetting } = await pool.query(`
              SELECT value FROM "Settings"
              WHERE key = 'dadwork_vip_caadi_config'
              LIMIT 1
            `);
            if (vipSetting.length > 0 && vipSetting[0].value) {
                vipCaadiConfig = typeof vipSetting[0].value === 'string'
                    ? JSON.parse(vipSetting[0].value)
                    : vipSetting[0].value;
            }
        } catch (e) {
            // If Settings table doesn't exist yet or query fails, default to empty array
        }

        return {
          customers,
          latestDate,
          historyCount,
          businessDays: bDays,
          vipCaadiConfig,
        };
    },
    ['daily-book-init-cache'],
    { revalidate: 3600, tags: ['daily-book-init', 'customers', 'business-days', 'settings'] }
);

export const GET = trackApiRoute('/api/daily-book-init', async (request: Request) => {
    const { errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;
    try {
        const data = await getDailyBookInit();
        const response = NextResponse.json(data);
        // Reverting to max-age=0 because a browser cache (max-age > 0) intercepts SWR mutate() calls,
        // causing the UI to fail to update instantly when a customer is reordered or toggled.
        response.headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
        return response;
    } catch (error: any) {
        console.error('Daily Book Init Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
