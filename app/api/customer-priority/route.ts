import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireSession } from '@/lib/require-session';
import { trackApiRoute } from '@/lib/egress-tracker';

/**
 * Auto-creates the AdminCustomerPriority table if it doesn't exist.
 */
let tableReady = false;
async function ensureTable() {
    if (tableReady) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS "AdminCustomerPriority" (
            username    TEXT NOT NULL,
            customer_id TEXT NOT NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (username, customer_id)
        );
        CREATE INDEX IF NOT EXISTS idx_acp_username ON "AdminCustomerPriority"(username);
    `);
    tableReady = true;
}

/**
 * GET /api/customer-priority
 * Returns the list of customer_ids that the current admin has starred.
 */
export const GET = trackApiRoute('/api/customer-priority', async (request: Request) => {
    const { errorResponse, session } = await requireSession(request);
    if (errorResponse) return errorResponse;

    try {
        await ensureTable();
        const { rows } = await pool.query(
            `SELECT customer_id FROM "AdminCustomerPriority" WHERE username = $1`,
            [session.username]
        );
        const res = NextResponse.json({ priorityIds: rows.map(r => r.customer_id) });
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

        await ensureTable();

        // Check if it's already starred
        const { rows: existing } = await pool.query(
            `SELECT 1 FROM "AdminCustomerPriority" WHERE username = $1 AND customer_id = $2`,
            [session.username, customerId]
        );

        if (existing.length > 0) {
            // Already starred → unstar it
            await pool.query(
                `DELETE FROM "AdminCustomerPriority" WHERE username = $1 AND customer_id = $2`,
                [session.username, customerId]
            );
            return NextResponse.json({ starred: false });
        } else {
            // Not starred → star it
            await pool.query(
                `INSERT INTO "AdminCustomerPriority" (username, customer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [session.username, customerId]
            );
            return NextResponse.json({ starred: true });
        }
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
