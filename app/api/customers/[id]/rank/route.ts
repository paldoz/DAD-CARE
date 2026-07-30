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
                    SUM(amount) as debt_amount
                FROM "Ledger"
                WHERE type IN ('PRODUCT', 'ADJUSTMENT') AND deleted_at IS NULL
                GROUP BY customer_id, group_key
            ),
            linked_payments AS (
                SELECT 
                    customer_id,
                    'maqal_' || maqal_id as group_key,
                    SUM(amount) as paid
                FROM "Ledger"
                WHERE type = 'PAYMENT' AND maqal_id IS NOT NULL AND deleted_at IS NULL
                GROUP BY customer_id, maqal_id
            ),
            orphan_payments AS (
                SELECT customer_id, SUM(amount) as total_orphan_paid
                FROM "Ledger"
                WHERE type = 'PAYMENT' AND (maqal_id IS NULL) AND deleted_at IS NULL
                GROUP BY customer_id
            ),
            ordered_groups AS (
                SELECT 
                    rg.*,
                    COALESCE(lp.paid, 0) as linked_paid,
                    SUM(GREATEST(0, rg.debt_amount - COALESCE(lp.paid, 0))) OVER (PARTITION BY rg.customer_id ORDER BY rg.sort_date ASC) as running_owed
                FROM receipt_groups rg
                LEFT JOIN linked_payments lp ON rg.customer_id = lp.customer_id AND rg.group_key = lp.group_key
            ),
            group_status AS (
                SELECT 
                    o.*,
                    COALESCE(op.total_orphan_paid, 0) as total_paid,
                    o.linked_paid + LEAST(
                        GREATEST(0, o.debt_amount - o.linked_paid), 
                        GREATEST(0, COALESCE(op.total_orphan_paid, 0) - (o.running_owed - GREATEST(0, o.debt_amount - o.linked_paid)))
                    ) as group_paid
                FROM ordered_groups o
                LEFT JOIN orphan_payments op ON o.customer_id = op.customer_id
            ),
            latest_receipt_amount AS (
                SELECT DISTINCT ON (customer_id)
                    customer_id,
                    product_amount,
                    debt_amount,
                    group_paid
                FROM group_status
                ORDER BY customer_id, sort_date DESC
            ),
            customer_stats AS (
                SELECT 
                    c.id,
                    c.created_at as customer_created_at,
                    CASE 
                        WHEN COALESCE(p.total_paid, 0) <= (COALESCE(lk.total_ledger_debt, 0) - COALESCE(lra.debt_amount, 0)) 
                        THEN GREATEST(0, (COALESCE(lk.total_ledger_maqal, 0) - COALESCE(lra.product_amount, 0)))
                        ELSE COALESCE(lk.total_ledger_maqal, 0)
                    END as all_time_maqal_total,
                    CASE 
                        WHEN (
                            CASE 
                                WHEN COALESCE(p.total_paid, 0) <= (COALESCE(lk.total_ledger_debt, 0) - COALESCE(lra.debt_amount, 0)) 
                                THEN GREATEST(0, (COALESCE(lk.total_ledger_maqal, 0) - COALESCE(lra.product_amount, 0)))
                                ELSE COALESCE(lk.total_ledger_maqal, 0)
                            END
                        ) = 0 THEN 0
                        ELSE LEAST(100, ROUND((COALESCE(p.total_paid, 0)::numeric / (
                            CASE 
                                WHEN COALESCE(p.total_paid, 0) <= (COALESCE(lk.total_ledger_debt, 0) - COALESCE(lra.debt_amount, 0)) 
                                THEN GREATEST(0, (COALESCE(lk.total_ledger_maqal, 0) - COALESCE(lra.product_amount, 0)))
                                ELSE COALESCE(lk.total_ledger_maqal, 0)
                            END
                        )::numeric) * 100))::int
                    END as pct,
                    COALESCE(lk.total_ledger_debt, 0) - COALESCE(p.total_paid, 0) as current_debt,
                    COALESCE(p.total_paid, 0) as total_paid,
                    GREATEST(0, (COALESCE(lk.total_ledger_debt, 0) - COALESCE(lra.debt_amount, 0)) - COALESCE(p.total_paid, 0)) as last_completed_reesto,
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
                LEFT JOIN (
                    SELECT customer_id, COUNT(*) FILTER (WHERE group_paid >= debt_amount) as perfect_maqals
                    FROM group_status
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
                            CASE WHEN all_time_maqal_total > 0 THEN 0 ELSE 1 END ASC,
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
