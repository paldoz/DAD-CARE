import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireSession } from '@/lib/require-session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { session, errorResponse } = await requireSession(request);
    
    // Only Super Admins can view security alerts
    if (errorResponse || session?.role !== 'SUPER_ADMIN') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const client = await pool.connect();
        try {
            // Auto-create table if it doesn't exist
            await client.query(`
                CREATE TABLE IF NOT EXISTS "PendingApprovals" (
                    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                    username text NOT NULL,
                    action_type text NOT NULL,
                    customer_id text NOT NULL,
                    ledger_id text,
                    payload jsonb NOT NULL,
                    status text NOT NULL DEFAULT 'PENDING',
                    created_at timestamp with time zone DEFAULT now()
                );
            `);

            // Fetch pending approvals
            const { rows } = await client.query(`
                SELECT id, username, action_type, customer_id, ledger_id, payload, status, created_at 
                FROM "PendingApprovals"
                WHERE status = 'PENDING'
                ORDER BY created_at DESC
                LIMIT 50
            `);

            return NextResponse.json({ alerts: rows });
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error fetching security alerts:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
