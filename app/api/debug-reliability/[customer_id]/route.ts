import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { SHARED_RELIABILITY_CTE } from '@/lib/sql-snippets';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ customer_id: string }> }) {
    try {
        const { customer_id } = await params;
        const query = `
            WITH ${SHARED_RELIABILITY_CTE},
            debug_info AS (
                SELECT 
                    o.customer_id,
                    o.group_key as maqal_id,
                    o.sort_date as open_date,
                    o.maqal_rank,
                    CASE WHEN o.maqal_rank = 1 THEN false ELSE true END as completed_status,
                    o.debt_amount as debt,
                    o.group_paid as paid,
                    CASE WHEN o.debt_amount = 0 THEN 100 ELSE LEAST(100, ROUND((o.group_paid::numeric / o.debt_amount::numeric) * 100))::int END as percentage,
                    cm.completed_rank as selected_rank,
                    CASE 
                        WHEN cm.completed_rank = 1 THEN 0.35
                        WHEN cm.completed_rank = 2 THEN 0.25
                        WHEN cm.completed_rank = 3 THEN 0.20
                        WHEN cm.completed_rank = 4 THEN 0.12
                        WHEN cm.completed_rank = 5 THEN 0.08
                        ELSE 0
                    END as applied_weight,
                    CASE 
                        WHEN cm.completed_rank = 1 THEN (CASE WHEN o.debt_amount = 0 THEN 100 ELSE LEAST(100, ROUND((o.group_paid::numeric / o.debt_amount::numeric) * 100))::int END) * 0.35
                        WHEN cm.completed_rank = 2 THEN (CASE WHEN o.debt_amount = 0 THEN 100 ELSE LEAST(100, ROUND((o.group_paid::numeric / o.debt_amount::numeric) * 100))::int END) * 0.25
                        WHEN cm.completed_rank = 3 THEN (CASE WHEN o.debt_amount = 0 THEN 100 ELSE LEAST(100, ROUND((o.group_paid::numeric / o.debt_amount::numeric) * 100))::int END) * 0.20
                        WHEN cm.completed_rank = 4 THEN (CASE WHEN o.debt_amount = 0 THEN 100 ELSE LEAST(100, ROUND((o.group_paid::numeric / o.debt_amount::numeric) * 100))::int END) * 0.12
                        WHEN cm.completed_rank = 5 THEN (CASE WHEN o.debt_amount = 0 THEN 100 ELSE LEAST(100, ROUND((o.group_paid::numeric / o.debt_amount::numeric) * 100))::int END) * 0.08
                        ELSE 0
                    END as contribution
                FROM ordered_groups o
                LEFT JOIN completed_maqals cm ON o.customer_id = cm.customer_id AND o.group_key = cm.group_key
                WHERE o.customer_id = $1
            )
            SELECT 
                cu.name as customer_name,
                rs.reliability_score as reliability_score_returned_by_api,
                (SELECT SUM(contribution) FROM debug_info WHERE selected_rank <= 5) as calculated_score_from_debug,
                COALESCE(json_agg(d ORDER BY d.open_date DESC), '[]') as maqals
            FROM "Customer" cu
            LEFT JOIN reliability_scores rs ON cu.id = rs.customer_id
            LEFT JOIN debug_info d ON cu.id = d.customer_id
            WHERE cu.id = $1
            GROUP BY cu.name, rs.reliability_score;
        `;
        
        const { rows } = await pool.query(query, [customer_id]);
        return NextResponse.json({ success: true, debug: rows[0] });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
