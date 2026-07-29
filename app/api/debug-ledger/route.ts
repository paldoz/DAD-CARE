import pool from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code') || '14';
    
    try {
        const { rows: customers } = await pool.query('SELECT id, name FROM "Customer" WHERE customer_code = $1 LIMIT 1', [code]);
        if (customers.length === 0) return NextResponse.json({ error: 'Not found' });
        
        const customerId = customers[0].id;
        
        const { rows: ledger } = await pool.query(
            'SELECT id, type, amount, previous_debt, new_debt, created_at, deleted_at FROM "Ledger" WHERE customer_id = $1 ORDER BY created_at ASC',
            [customerId]
        );
        
        return NextResponse.json({
            customer: customers[0].name,
            ledger
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message });
    }
}
