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
            WITH customer_stats AS (
                SELECT 
                    c.id,
                    CASE 
                        WHEN COALESCE(lk.total_ledger_maqal, 0) = 0 THEN 0
                        ELSE LEAST(100, ROUND((COALESCE(p.total_paid, 0) / lk.total_ledger_maqal) * 100))::int
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
                    SELECT customer_id, SUM(amount) as total_ledger_maqal
                    FROM "Ledger"
                    WHERE type = 'PRODUCT' AND deleted_at IS NULL
                    GROUP BY customer_id
                ) lk ON c.id = lk.customer_id
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
