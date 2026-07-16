import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireSession } from '@/lib/require-session';
import { trackApiRoute } from '@/lib/egress-tracker';

/**
 * GET /api/customer-priority
 * Returns the list of customer_ids that the current admin has starred.
 */
export const GET = trackApiRoute('/api/customer-priority', async (request: Request) => {
    const { errorResponse, session } = await requireSession(request);
    if (errorResponse) return errorResponse;

    try {
        const { rows } = await pool.query(
            `SELECT assigned_customer_ids FROM "User" WHERE username = $1`,
            [session.username]
        );
        const priorityIds = rows.length ? (rows[0].assigned_customer_ids || []) : [];
        const res = NextResponse.json({ priorityIds });
        // Short cache — priority data is personal and rarely changes
        res.headers.set('Cache-Control', 'private, max-age=60');
        return res;
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});

/**
 * POST /api/customer-priority
 * Toggles a customer's priority star for the current admin.
 * Body: { customerId: string }
 */
export const POST = trackApiRoute('/api/customer-priority', async (request: Request) => {
    const { errorResponse, session } = await requireSession(request);
    if (errorResponse) return errorResponse;

    try {
        const body = await request.json();
        const { customerId } = body;
        if (!customerId) {
            return NextResponse.json({ error: 'customerId required' }, { status: 400 });
        }

        // Fetch current assigned_customer_ids
        const { rows } = await pool.query(`SELECT assigned_customer_ids FROM "User" WHERE username = $1`, [session.username]);
        if (!rows.length) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        let assignedIds: string[] = rows[0].assigned_customer_ids || [];
        const isStarred = assignedIds.includes(customerId);

        if (isStarred) {
            // Unstar: remove from array
            assignedIds = assignedIds.filter(id => id !== customerId);
            await pool.query(`UPDATE "User" SET assigned_customer_ids = $1 WHERE username = $2`, [assignedIds, session.username]);
            return NextResponse.json({ starred: false });
        } else {
            // Star: add to array
            assignedIds.push(customerId);
            await pool.query(`UPDATE "User" SET assigned_customer_ids = $1 WHERE username = $2`, [assignedIds, session.username]);
            return NextResponse.json({ starred: true });
        }
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
