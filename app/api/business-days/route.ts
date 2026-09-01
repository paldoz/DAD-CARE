import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireSession } from '@/lib/require-session';
import { trackApiRoute } from '@/lib/egress-tracker';
import { unstable_cache, revalidateTag } from 'next/cache';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const BusinessDaySchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
    status: z.enum(['WORKED', 'ABSENCE']),
    reason: z.string().optional().nullable()
});

const getCachedBusinessDays = unstable_cache(
    async () => {
        const { rows } = await pool.query(`
            SELECT id, date::text as date, status, reason, created_by, created_at, updated_at
            FROM "BusinessDay"
            ORDER BY date DESC
        `);
        return rows;
    },
    ['business-days-cache'],
    { revalidate: 3600, tags: ['business-days'] }
);

export const GET = trackApiRoute('/api/business-days', async (request: Request) => {
    const { errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;

    try {
        const rows = await getCachedBusinessDays();
        return NextResponse.json(rows);
    } catch (error: any) {
        console.error('Fetch Business Days Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});

export const POST = trackApiRoute('/api/business-days', async (request: Request) => {
    const { errorResponse, session } = await requireSession(request);
    if (errorResponse) return errorResponse;

    // Strict Super Admin Authorization
    if (session.role !== 'SUPER_ADMIN') {
        return NextResponse.json(
            { error: 'Forbidden: Only Super Admin can modify business-day status' },
            { status: 403 }
        );
    }

    try {
        const body = await request.json();
        const parsed = BusinessDaySchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
        }

        const { date: dateStr, status, reason } = parsed.data;
        const username = session.username || session.userId || 'super_admin';

        if (status === 'WORKED') {
            // Reopening / setting to worked — update or delete entry
            await pool.query(
                `INSERT INTO "BusinessDay" (id, date, status, reason, created_by, updated_at)
                 VALUES (gen_random_uuid(), $1::date, 'WORKED', $2, $3, NOW())
                 ON CONFLICT (date) DO UPDATE
                 SET status = 'WORKED', reason = $2, updated_at = NOW(), created_by = $3`,
                [dateStr, reason || null, username]
            );
        } else {
            // Setting to ABSENCE — upsert status
            await pool.query(
                `INSERT INTO "BusinessDay" (id, date, status, reason, created_by, updated_at)
                 VALUES (gen_random_uuid(), $1::date, 'ABSENCE', $2, $3, NOW())
                 ON CONFLICT (date) DO UPDATE
                 SET status = 'ABSENCE', reason = $2, updated_at = NOW(), created_by = $3`,
                [dateStr, reason || null, username]
            );
        }

        // Cache tag revalidations
        try {
            (revalidateTag as any)('business-days');
            (revalidateTag as any)('daily-book-init');
            (revalidateTag as any)('daily-book-history');
            (revalidateTag as any)('daily-book-history-full');
        } catch (tagErr) {
            console.error('Revalidation error:', tagErr);
        }

        return NextResponse.json({
            success: true,
            date: dateStr,
            status,
            reason: reason || null
        });
    } catch (error: any) {
        console.error('Save Business Day Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
