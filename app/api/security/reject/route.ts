import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireSession } from '@/lib/require-session';

export async function POST(request: Request) {
    const { session, errorResponse } = await requireSession(request);
    if (errorResponse || session?.role !== 'SUPER_ADMIN') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id } = await request.json();
        if (!id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 });

        const client = await pool.connect();
        try {
            const { rowCount } = await client.query(
                `UPDATE "PendingApprovals" SET status = 'REJECTED' WHERE id = $1 AND status = 'PENDING'`,
                [id]
            );

            if (rowCount === 0) {
                return NextResponse.json({ error: 'Approval not found or already processed' }, { status: 404 });
            }

            return NextResponse.json({ success: true });
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Reject error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
