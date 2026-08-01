import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { SHARED_RELIABILITY_CTE } from '@/lib/sql-snippets';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const fullQuery = `
            WITH ${SHARED_RELIABILITY_CTE}
            SELECT 
                c.name,
                o.customer_id,
                o.group_key,
                o.sort_date,
                o.product_amount,
                o.debt_amount,
                o.group_paid,
                o.maqal_rank,
                CASE WHEN o.debt_amount = 0 THEN 100 ELSE LEAST(100, ROUND((o.group_paid::numeric / o.debt_amount::numeric) * 100))::int END as maqal_pct
            FROM ordered_groups o
            JOIN "Customer" c ON o.customer_id = c.id
            WHERE c.name ILIKE '%hamdi shaahle%'
            ORDER BY o.sort_date DESC, o.group_key DESC;
        `;
        
        const { rows } = await pool.query(fullQuery);
        return NextResponse.json({ success: true, maqals: rows });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
