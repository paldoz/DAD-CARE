import pool from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET() {
    const results: any = {};
    
    // Test 1: Simple count
    try {
        const r = await pool.query('SELECT COUNT(*) FROM "Customer" WHERE deleted_at IS NULL');
        results.simple_count = r.rows[0].count;
    } catch (e: any) { results.simple_count_error = e.message; }

    // Test 2: Session table exists
    try {
        const r = await pool.query('SELECT COUNT(*) FROM "Session"');
        results.session_count = r.rows[0].count;
    } catch (e: any) { results.session_error = e.message; }

    // Test 3: Run actual customers query (minimal version)
    try {
        const r = await pool.query(`
            WITH target_pair AS (
                SELECT
                    ('2026-06-28'::date + (
                        GREATEST(0, ((NOW() AT TIME ZONE 'Africa/Mogadishu')::date - '2026-06-28'::date) - 2) / 2 * 2
                    )::int * '1 day'::interval)::date AS date1,
                    ('2026-06-28'::date + (
                        GREATEST(0, ((NOW() AT TIME ZONE 'Africa/Mogadishu')::date - '2026-06-28'::date) - 2) / 2 * 2 + 1
                    )::int * '1 day'::interval)::date AS date2
            ),
            prev_pair AS (
                SELECT
                    ('2026-06-28'::date + (
                        GREATEST(0, ((NOW() AT TIME ZONE 'Africa/Mogadishu')::date - '2026-06-28'::date) - 2) / 2 * 2 - 2
                    )::int * '1 day'::interval)::date AS date1,
                    ('2026-06-28'::date + (
                        GREATEST(0, ((NOW() AT TIME ZONE 'Africa/Mogadishu')::date - '2026-06-28'::date) - 2) / 2 * 2 - 1
                    )::int * '1 day'::interval)::date AS date2
            ),
            base_customers AS (
                SELECT c.id, c.name, c.customer_code, c.created_at, c.deleted_at
                FROM "Customer" c
                WHERE 1=1
            )
            SELECT COUNT(*) FROM base_customers
        `);
        results.customers_cte_count = r.rows[0].count;
    } catch (e: any) { results.customers_cte_error = e.message; }

    // Test 4: Actual full query with limit
    try {
        const r = await pool.query(`
            WITH target_pair AS (
                SELECT
                    ('2026-06-28'::date + (GREATEST(0, ((NOW() AT TIME ZONE 'Africa/Mogadishu')::date - '2026-06-28'::date) - 2) / 2 * 2)::int * '1 day'::interval)::date AS date1,
                    ('2026-06-28'::date + (GREATEST(0, ((NOW() AT TIME ZONE 'Africa/Mogadishu')::date - '2026-06-28'::date) - 2) / 2 * 2 + 1)::int * '1 day'::interval)::date AS date2
            ),
            prev_pair AS (
                SELECT
                    ('2026-06-28'::date + (GREATEST(0, ((NOW() AT TIME ZONE 'Africa/Mogadishu')::date - '2026-06-28'::date) - 2) / 2 * 2 - 2)::int * '1 day'::interval)::date AS date1,
                    ('2026-06-28'::date + (GREATEST(0, ((NOW() AT TIME ZONE 'Africa/Mogadishu')::date - '2026-06-28'::date) - 2) / 2 * 2 - 1)::int * '1 day'::interval)::date AS date2
            )
            SELECT c.id, c.name
            FROM "Customer" c
            LEFT JOIN prev_pair tp ON true
            WHERE 1=1
            LIMIT 5
        `);
        results.full_query_rows = r.rows.length;
        results.sample = r.rows[0];
    } catch (e: any) { results.full_query_error = e.message; }

    const dbUrl = process.env.DATABASE_URL || 'NOT SET';
    results.db_url_start = dbUrl.substring(0, 50) + '...';
    results.timestamp = new Date().toISOString();
    
    return NextResponse.json(results);
}
