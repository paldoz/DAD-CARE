import pool from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const { rows } = await pool.query('SELECT count(*) as total, count(deleted_at) as deleted_count FROM "Customer"');
        const { rows: cRows } = await pool.query('SELECT id, name, deleted_at FROM "Customer" LIMIT 5');
        
        return NextResponse.json({
            stats: rows[0],
            sample: cRows
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message });
    }
}
