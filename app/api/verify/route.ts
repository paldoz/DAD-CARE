import pool from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const query = `
            WITH receipt_groups AS (
                SELECT 
                    customer_id,
                    COALESCE(
                        'maqal_' || maqal_id, 
                        'pair_' || FLOOR((COALESCE(reference_date::date, created_at::date) - '2026-06-28'::date) / 2)::text
                    ) as group_key,
                    MAX(created_at) as sort_date,
                    SUM(CASE WHEN type = 'PRODUCT' THEN amount ELSE 0 END) as product_amount,
                    SUM(CASE WHEN type IN ('PRODUCT', 'ADJUSTMENT') THEN amount ELSE 0 END) as debt_amount,
                    SUM(CASE WHEN type = 'PAYMENT' THEN amount ELSE 0 END) as group_paid
                FROM "Ledger"
                WHERE deleted_at IS NULL
                GROUP BY customer_id, group_key
            ),
            ordered_groups AS (
                SELECT 
                    *,
                    ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY sort_date DESC) as maqal_rank
                FROM receipt_groups
            ),
            completed_maqals AS (
                SELECT 
                    customer_id,
                    debt_amount,
                    group_paid,
                    CASE WHEN debt_amount = 0 THEN 0 ELSE LEAST(100, ROUND((group_paid::numeric / debt_amount::numeric) * 100))::int END as maqal_pct,
                    ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY sort_date DESC) as completed_rank
                FROM ordered_groups
                WHERE maqal_rank > 1
            ),
            reliability_scores AS (
                SELECT 
                    customer_id,
                    SUM(
                        CASE 
                            WHEN completed_rank = 1 THEN maqal_pct * 50
                            WHEN completed_rank = 2 THEN maqal_pct * 30
                            WHEN completed_rank = 3 THEN maqal_pct * 20
                            ELSE 0
                        END
                    ) / NULLIF(SUM(
                        CASE 
                            WHEN completed_rank = 1 THEN 50
                            WHEN completed_rank = 2 THEN 30
                            WHEN completed_rank = 3 THEN 20
                            ELSE 0
                        END
                    ), 0) as reliability_score,
                    MAX(CASE WHEN completed_rank = 1 THEN GREATEST(0, debt_amount - group_paid) ELSE 0 END) as last_completed_reesto
                FROM completed_maqals
                WHERE completed_rank <= 3
                GROUP BY customer_id
            )
            SELECT 
                c.id, 
                c.name,
                rs.reliability_score::int,
                rs.last_completed_reesto::float,
                (
                    SELECT json_agg(json_build_object(
                        'rank', cm.completed_rank, 
                        'debt', cm.debt_amount, 
                        'paid', cm.group_paid, 
                        'pct', cm.maqal_pct
                    )) 
                    FROM completed_maqals cm 
                    WHERE cm.customer_id = c.id 
                    AND cm.completed_rank <= 3
                ) as maqals
            FROM "Customer" c
            LEFT JOIN reliability_scores rs ON c.id = rs.customer_id
            WHERE c.deleted_at IS NULL
            ORDER BY c.name ASC
            LIMIT 50;
        `;
        const { rows } = await pool.query(query);
        return NextResponse.json(rows);
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
