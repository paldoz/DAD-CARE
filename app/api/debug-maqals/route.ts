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
                cm.completed_rank,
                cm.maqal_pct,
                rs.reliability_score
            FROM ordered_groups o
            LEFT JOIN completed_maqals cm ON o.customer_id = cm.customer_id AND o.group_key = cm.group_key
            JOIN "Customer" c ON o.customer_id = c.id
            LEFT JOIN reliability_scores rs ON o.customer_id = rs.customer_id
            WHERE c.name ILIKE '%hamdi shaahle%'
            ORDER BY o.sort_date DESC, o.group_key DESC;
        `;
        
        const { rows } = await pool.query(fullQuery);
        return NextResponse.json({ success: true, maqals: rows });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
