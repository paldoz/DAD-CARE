import pool from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const query = `
            SELECT id, type, amount, created_at, reference_date, deleted_at, maqal_id, receipt_id
            FROM "Ledger"
            WHERE customer_id = '70d283c6-a920-4628-b678-54861fac55c8'
            ORDER BY COALESCE(reference_date::date, created_at::date) DESC;
        `;
        
        const { rows } = await pool.query(query);
        return NextResponse.json({ success: true, transactions: rows });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
