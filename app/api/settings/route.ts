import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit';
import { requireSession } from '@/lib/require-session';
import { trackApiRoute } from '@/lib/egress-tracker';
import { z } from 'zod';

const settingSchema = z.object({
    key: z.string().min(1, 'Key is required'),
    value: z.union([z.string(), z.number(), z.boolean()]),
});

export const GET = trackApiRoute('/api/settings', async (request: Request) => {
    const { errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;
    try {
        const { rows } = await pool.query('SELECT key, value FROM "Settings"');
        const settings = rows.reduce((acc, row) => {
            acc[row.key] = row.value;
            return acc;
        }, {});

        const res = NextResponse.json(settings);
        res.headers.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
        return res;
    } catch (error: any) {
        console.error('Settings GET Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});

export const POST = trackApiRoute('/api/settings', async (request: Request) => {
    const { errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;
    try {
        const body = await request.json();
        const result = settingSchema.safeParse(body);
        if (!result.success) {
            return NextResponse.json({ error: result.error.issues[0].message }, { status: 400 });
        }
        const { key, value } = result.data;

        // Ensure table exists
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "Settings" (
                key VARCHAR(255),
                value TEXT NOT NULL
            );
        `);

        // Safe upsert: UPDATE existing row, INSERT only if no row was updated.
        // This works even if the table has no UNIQUE/PRIMARY KEY constraint.
        const strVal = value.toString();
        const updateResult = await pool.query(
            `UPDATE "Settings" SET value = $2 WHERE key = $1`,
            [key, strVal]
        );

        if (updateResult.rowCount === 0) {
            // No existing row — delete any stale duplicates then insert fresh
            await pool.query(`DELETE FROM "Settings" WHERE key = $1`, [key]);
            await pool.query(
                `INSERT INTO "Settings" (key, value) VALUES ($1, $2)`,
                [key, strVal]
            );
        }

        await logAudit(request, 'UPDATE_SETTING', `Updated setting ${key} to ${value}`);

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Settings POST Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});

export const DELETE = trackApiRoute('/api/settings', async (request: Request) => {
    const { errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;
    try {
        const { searchParams } = new URL(request.url);
        const key = searchParams.get('key');
        if (!key) {
            return NextResponse.json({ error: 'Key is required' }, { status: 400 });
        }

        await pool.query(`DELETE FROM "Settings" WHERE key = $1`, [key]);
        await logAudit(request, 'DELETE_SETTING', `Deleted setting ${key}`);

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Settings DELETE Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
