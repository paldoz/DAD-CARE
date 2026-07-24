import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const GET = async () => {
    try {
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_ledger_coalesce_date 
            ON "Ledger" (COALESCE((reference_date AT TIME ZONE 'Africa/Mogadishu')::date, (created_at AT TIME ZONE 'Africa/Mogadishu')::date));
        `);
        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
};
