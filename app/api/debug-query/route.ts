import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { getAllCustomerStats } from '@/app/utils/rankHelpers';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const stats = await getAllCustomerStats(pool);
        const url = new URL(request.url);
        const search = url.searchParams.get('search') || null;
        
        let filterCondition = "1=1";
        filterCondition += " AND c.deleted_at IS NULL";
        
        let searchCondition = "1=1";
        const values: any[] = [];
        
        if (search) {
            searchCondition = `(
                c.name ILIKE $1 
                OR c.customer_code ILIKE $1
            )`;
            values.push(`%${search}%`);
        }
        
        values.push(20, 0); // limit, offset
        
        const jsScoresCte = `
            js_scores (customer_id, reliability_score, perfect_maqals, last_completed_reesto) AS (
                VALUES 
                ${stats.length > 0 ? stats.map((s: any) => `('${s.id}'::text, ${s.pct}::int, ${s.perfect_maqals}::int, ${s.last_completed_reesto}::numeric)`).join(',\\n') : `(NULL::text, 0::int, 0::int, 0::numeric)`}
            ),
            reliability_scores AS (
                SELECT customer_id, reliability_score, last_completed_reesto FROM js_scores WHERE customer_id IS NOT NULL
            ),
            gs_scores AS (
                SELECT customer_id, perfect_maqals FROM js_scores WHERE customer_id IS NOT NULL
            ),
        `;

        const query = `
            WITH target_pair AS (
                SELECT '2026-06-28'::date AS date1, '2026-06-29'::date AS date2
            ),
            base_customers AS (
                SELECT c.* FROM "Customer" c WHERE ${filterCondition} AND ${searchCondition}
            ),
            ${jsScoresCte}
            selected_product_receipt AS (
                SELECT customer_id FROM js_scores
            )
            SELECT c.id, c.name, rs.reliability_score 
            FROM base_customers c
            LEFT JOIN reliability_scores rs ON c.id::text = rs.customer_id::text
            LIMIT $${search ? '2' : '1'} OFFSET $${search ? '3' : '2'}
        `;

        const { rows } = await pool.query(query, values);
        return NextResponse.json({ success: true, count: rows.length, query, values });
    } catch (e: any) {
        return NextResponse.json({ success: false, error: e.message, stack: e.stack });
    }
}
