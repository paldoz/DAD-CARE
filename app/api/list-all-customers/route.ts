import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/require-session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;

    try {
        const { rows } = await pool.query(`
            SELECT 
                customer_code,
                name,
                deleted_at,
                created_at
            FROM "Customer"
            ORDER BY created_at ASC, id ASC
        `);

        return NextResponse.json(rows.map(r => ({
            code: r.customer_code,
            name: r.name,
            status: r.deleted_at ? 'INACTIVE' : 'ACTIVE',
            created: r.created_at,
        })));
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
