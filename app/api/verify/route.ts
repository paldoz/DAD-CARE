import pool from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const query = `
            WITH receipt_groups AS (
                SELECT 
                    id as ledger_id,
                    customer_id,
                    type,
                    amount,
                    maqal_id,
                    COALESCE(
                        'maqal_' || maqal_id, 
                        'pair_' || FLOOR((COALESCE(reference_date::date, created_at::date) - '2026-06-28'::date) / 2)::text
                    ) as group_key,
                    created_at,
                    reference_date
                FROM "Ledger"
                WHERE deleted_at IS NULL AND customer_id = '38c73a9b-72ca-4c8a-a8d6-62363cd72c93'
            ),
            group_sorts AS (
                SELECT 
                    group_key,
                    MAX(created_at) as sort_date,
                    SUM(CASE WHEN type IN ('PRODUCT', 'ADJUSTMENT') THEN amount ELSE 0 END) as debt_amount,
                    SUM(CASE WHEN type = 'PAYMENT' THEN amount ELSE 0 END) as group_paid
                FROM receipt_groups
                GROUP BY group_key
            ),
            ranked_groups AS (
                SELECT 
                    *,
                    ROW_NUMBER() OVER (ORDER BY sort_date DESC) as maqal_rank
                FROM group_sorts
            ),
            completed_groups AS (
                SELECT 
                    *,
                    ROW_NUMBER() OVER (ORDER BY sort_date DESC) as completed_rank
                FROM ranked_groups
                WHERE maqal_rank > 1
            )
            SELECT 
                r.ledger_id,
                r.type,
                r.amount,
                r.maqal_id,
                r.group_key,
                r.reference_date,
                cg.completed_rank,
                cg.debt_amount as bucket_debt,
                cg.group_paid as bucket_paid
            FROM receipt_groups r
            JOIN completed_groups cg ON r.group_key = cg.group_key
            WHERE cg.completed_rank <= 3
            ORDER BY cg.completed_rank ASC, r.created_at ASC;
        `;
        const { rows } = await pool.query(query);
        return NextResponse.json(rows);
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
