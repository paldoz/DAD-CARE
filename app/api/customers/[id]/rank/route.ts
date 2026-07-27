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
            WITH latest_receipt_date AS (
                SELECT 
                    customer_id,
                    MAX(COALESCE(reference_date::date, created_at::date)) as max_date
                FROM "Ledger"
                WHERE type = 'PRODUCT' AND deleted_at IS NULL
                GROUP BY customer_id
            ),
            latest_receipt_amount AS (
                SELECT 
                    l.customer_id,
                    SUM(CASE WHEN l.type = 'PRODUCT' THEN l.amount ELSE 0 END) as product_amount,
                    SUM(l.amount) as debt_amount
                FROM "Ledger" l
                JOIN latest_receipt_date lrd ON l.customer_id = lrd.customer_id AND COALESCE(l.reference_date::date, l.created_at::date) = lrd.max_date
                WHERE l.type IN ('PRODUCT', 'ADJUSTMENT') AND l.deleted_at IS NULL
                GROUP BY l.customer_id
            ),
            customer_stats AS (
                SELECT 
                    c.id,
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
                    COALESCE(p.total_paid, 0) as total_paid,
                    COALESCE(dbk.total_daily_kg, 0) as total_kg
                FROM "Customer" c
                LEFT JOIN (
                    SELECT customer_id, SUM(amount) as total_paid
                    FROM "Ledger"
                    WHERE type = 'PAYMENT' AND deleted_at IS NULL
                    GROUP BY customer_id
                ) p ON c.id = p.customer_id
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
                    SELECT customer_id, SUM(kg) as total_daily_kg
                    FROM "DailyBookItem"
                    WHERE kg > 0 AND deleted_at IS NULL
                    GROUP BY customer_id
                ) dbk ON c.id = dbk.customer_id
                WHERE c.deleted_at IS NULL
            ),
            ranked_customers AS (
                SELECT 
                    id,
                    pct,
                    RANK() OVER (ORDER BY pct DESC, total_paid DESC, total_kg DESC, id ASC) as rank,
                    COUNT(*) OVER() as total_customers
                FROM customer_stats
            )
            SELECT rank, pct, total_customers FROM ranked_customers WHERE id = $1;
        `;
        
        const { rows } = await pool.query(query, [id]);
        if (rows.length === 0) {
            return NextResponse.json({ rank: null, pct: null, total_customers: 0 });
        }
        
        return NextResponse.json(rows[0]);
    } catch (error: any) {
        console.error('Fetch Rank Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
