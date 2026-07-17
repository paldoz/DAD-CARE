import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/require-session';

// This mimics EXACTLY what /api/customers does
export async function GET(request: Request) {
    const { errorResponse, session } = await requireSession(request);
    if (errorResponse) return NextResponse.json({ error: 'SESSION_FAILED', session: null });
    
    try {
        const { rows } = await pool.query(`
            WITH target_pair AS (
                SELECT
                    ('2026-06-28'::date + (GREATEST(0, ((NOW() AT TIME ZONE 'Africa/Mogadishu')::date - '2026-06-28'::date) - 2) / 2 * 2)::int * '1 day'::interval)::date AS date1,
                    ('2026-06-28'::date + (GREATEST(0, ((NOW() AT TIME ZONE 'Africa/Mogadishu')::date - '2026-06-28'::date) - 2) / 2 * 2 + 1)::int * '1 day'::interval)::date AS date2
            ),
            prev_pair AS (
                SELECT
                    ('2026-06-28'::date + (GREATEST(0, ((NOW() AT TIME ZONE 'Africa/Mogadishu')::date - '2026-06-28'::date) - 2) / 2 * 2 - 2)::int * '1 day'::interval)::date AS date1,
                    ('2026-06-28'::date + (GREATEST(0, ((NOW() AT TIME ZONE 'Africa/Mogadishu')::date - '2026-06-28'::date) - 2) / 2 * 2 - 1)::int * '1 day'::interval)::date AS date2
            ),
            base_customers AS (
                SELECT c.id, c.name, c.customer_code, c.gender, c.phone, c.created_at, c.deleted_at
                FROM "Customer" c
                WHERE 1=1 AND 1=1
            )
            SELECT c.id, c.name, c.customer_code,
                   COALESCE(l.new_debt, 0)::float as current_balance,
                   CASE WHEN c.deleted_at IS NOT NULL THEN true ELSE false END as is_inactive
            FROM base_customers c
            LEFT JOIN LATERAL (
                SELECT new_debt, type
                FROM "Ledger" l1
                WHERE l1.customer_id = c.id AND l1.deleted_at IS NULL
                ORDER BY created_at DESC, id DESC
                LIMIT 1
            ) l ON true
            LEFT JOIN prev_pair tp ON true
            ORDER BY CASE WHEN c.customer_code ~ '^[0-9]+$' THEN c.customer_code::int ELSE 9999 END ASC, c.name ASC
            LIMIT 20 OFFSET 0
        `);
        
        return NextResponse.json({
            authenticated_as: session?.username,
            row_count: rows.length,
            first_customer: rows[0] || null,
            sql_worked: true
        });
    } catch (e: any) {
        return NextResponse.json({ sql_error: e.message, authenticated_as: session?.username });
    }
}
