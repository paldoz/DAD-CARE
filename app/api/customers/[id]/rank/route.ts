import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/require-session';
import { trackApiRoute } from '@/lib/egress-tracker';

export const dynamic = 'force-dynamic';

export const GET = trackApiRoute('/api/customers/[id]/rank', async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const { errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;

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
                    SUM(GREATEST(0, debt_amount)) OVER (PARTITION BY customer_id ORDER BY sort_date ASC) as running_owed,
                    ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY sort_date DESC) as maqal_rank
                FROM receipt_groups
            ),
            latest_receipt_amount AS (
                SELECT DISTINCT ON (customer_id)
                    customer_id,
                    product_amount,
                    debt_amount,
                    group_paid
                FROM ordered_groups
                ORDER BY customer_id, sort_date DESC
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
            ),
            customer_stats AS (
                SELECT 
                    c.id,
                    c.created_at as customer_created_at,
                    COALESCE(rs.reliability_score, 0)::int as pct,
                    COALESCE(lk.total_ledger_debt, 0) - COALESCE(p.total_paid, 0) as current_debt,
                    COALESCE(p.total_paid, 0) as total_paid,
                    COALESCE(rs.last_completed_reesto, 0) as last_completed_reesto,
                    COALESCE(gs.perfect_maqals, 0) as perfect_maqals
                FROM "Customer" c
                LEFT JOIN customer_payments p ON c.id = p.customer_id
                LEFT JOIN (
                    SELECT customer_id, 
                           SUM(CASE WHEN type = 'PRODUCT' THEN amount ELSE 0 END) as total_ledger_maqal,
                           SUM(amount) as total_ledger_debt
                    FROM "Ledger"
                    WHERE type IN ('PRODUCT', 'ADJUSTMENT') AND deleted_at IS NULL
                    GROUP BY customer_id
                ) lk ON c.id = lk.customer_id
                LEFT JOIN latest_receipt_amount lra ON c.id = lra.customer_id
                LEFT JOIN reliability_scores rs ON c.id = rs.customer_id
                LEFT JOIN (
                    SELECT customer_id, COUNT(*) FILTER (WHERE group_paid >= debt_amount) as perfect_maqals
                    FROM ordered_groups
                    WHERE maqal_rank > 1
                    GROUP BY customer_id
                ) gs ON c.id = gs.customer_id
                WHERE c.deleted_at IS NULL
            ),
            ranked_customers AS (
                SELECT 
                    id,
                    pct,
                    RANK() OVER (
                        ORDER BY 
                            pct DESC, 
                            CASE WHEN current_debt < 0 THEN 1 ELSE 2 END ASC,
                            CASE WHEN current_debt < 0 THEN current_debt ELSE 0 END ASC,
                            last_completed_reesto ASC,
                            perfect_maqals DESC,
                            customer_created_at ASC,
                            id ASC
                    ) as rank_maqal,
                    RANK() OVER (
                        ORDER BY
                            current_debt ASC,
                            total_paid DESC,
                            id ASC
                    ) as rank_lacag,
                    COUNT(*) OVER() as total_customers
                FROM customer_stats
            )
            SELECT rank_maqal, rank_lacag, pct, total_customers FROM ranked_customers WHERE id = $1;
        `;
        
        const { rows } = await pool.query(query, [id]);
        if (rows.length === 0) {
            return NextResponse.json({ rank_maqal: null, rank_lacag: null, pct: null, total_customers: 0 });
        }
        
        return NextResponse.json(rows[0]);
    } catch (error: any) {
        console.error('Fetch Rank Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
