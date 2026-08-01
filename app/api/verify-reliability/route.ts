import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { SHARED_RELIABILITY_CTE } from '@/lib/sql-snippets';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const query = `
            WITH ${SHARED_RELIABILITY_CTE},
            debug_info AS (
                SELECT 
                    c.customer_id,
                    c.debt_amount,
                    c.product_amount,
                    c.group_paid,
                    c.maqal_pct,
                    c.completed_rank,
                    CASE 
                        WHEN c.completed_rank = 1 THEN c.maqal_pct * 0.35
                        WHEN c.completed_rank = 2 THEN c.maqal_pct * 0.25
                        WHEN c.completed_rank = 3 THEN c.maqal_pct * 0.20
                        WHEN c.completed_rank = 4 THEN c.maqal_pct * 0.12
                        WHEN c.completed_rank = 5 THEN c.maqal_pct * 0.08
                        ELSE 0
                    END as weight_contribution
                FROM completed_maqals c
                WHERE c.completed_rank <= 5
            )
            SELECT 
                cu.id as customer_id,
                cu.name as customer_name,
                rs.reliability_score as final_reliability_score,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'rank', d.completed_rank,
                            'debt_amount', d.debt_amount,
                            'product_amount', d.product_amount,
                            'paid_amount', d.group_paid,
                            'percentage', d.maqal_pct,
                            'weight_contribution', d.weight_contribution
                        ) ORDER BY d.completed_rank ASC
                    ) FILTER (WHERE d.completed_rank IS NOT NULL), 
                    '[]'
                ) as maqals_used
            FROM "Customer" cu
            LEFT JOIN reliability_scores rs ON cu.id = rs.customer_id
            LEFT JOIN debug_info d ON cu.id = d.customer_id
            WHERE cu.deleted_at IS NULL
            GROUP BY cu.id, cu.name, rs.reliability_score
            ORDER BY rs.reliability_score DESC NULLS LAST
            LIMIT 100;
        `;
        
        const { rows } = await pool.query(query);
        return NextResponse.json({ success: true, customers: rows });
    } catch (error: any) {
        console.error('Verification Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
