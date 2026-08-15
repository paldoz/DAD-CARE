import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { validateSession } from '@/lib/sessions-store';
import { trackApiRoute } from '@/lib/egress-tracker';
import { unstable_cache } from 'next/cache';


export const dynamic = 'force-dynamic';

const getDashboardData = async (today: string) => {
    const [
        statsResult, 
        todayStatsResult,
        recentTransactionsResult,
        weeklyDataResult
    ] = await Promise.all([
        pool.query(`
            WITH valid_ledger AS (
                SELECT DISTINCT ON (l.customer_id) 
                    l.customer_id, 
                    l.new_debt,
                    c.name,
                    c.customer_code as code
                FROM "Ledger" l
                JOIN "Customer" c ON c.id = l.customer_id
                WHERE l.deleted_at IS NULL AND c.deleted_at IS NULL AND c.is_kabarka = false
                ORDER BY l.customer_id, l.created_at DESC, l.id DESC
            ),
            top_debtors AS (
                SELECT customer_id as id, name, code, new_debt as debt
                FROM valid_ledger
                WHERE new_debt > 0
                ORDER BY new_debt DESC
                LIMIT 5
            )
            SELECT 
                (SELECT count(*)::int FROM "Customer" WHERE deleted_at IS NULL AND is_kabarka = false) as total_customers,
                (SELECT COALESCE(SUM(CASE WHEN new_debt > 0 THEN new_debt ELSE 0 END), 0)::float FROM valid_ledger) as total_debt,
                (SELECT ABS(COALESCE(SUM(CASE WHEN new_debt < 0 THEN new_debt ELSE 0 END), 0))::float FROM valid_ledger) as total_reesto,
                (SELECT COALESCE(SUM(amount), 0)::float FROM "Ledger" WHERE type = 'PAYMENT' AND deleted_at IS NULL) as total_paid,
                (SELECT COALESCE(SUM(kg), 0)::float FROM "Ledger" WHERE type = 'PRODUCT' AND deleted_at IS NULL) as total_kg,
                (SELECT COALESCE(json_agg(td.*), '[]'::json) FROM top_debtors td) as top_debtors_json
        `),
        pool.query(`
            WITH today_book AS (
                SELECT id 
                FROM "DailyBook" 
                WHERE date = $1 AND deleted_at IS NULL 
                ORDER BY created_at ASC 
                LIMIT 1
            )
            SELECT 
                COALESCE(SUM(dbi.kg), 0)::float as today_kg, 
                COUNT(dbi.id)::int as today_customer_count
            FROM "DailyBookItem" dbi
            JOIN today_book db ON dbi.daily_book_id = db.id
            WHERE dbi.deleted_at IS NULL AND dbi.present IS NOT FALSE
        `, [today]),
        pool.query(`
            SELECT
                l.type,
                l.amount,
                l.kg,
                l.created_at,
                c.name as customer_name
            FROM "Ledger" l
            JOIN "Customer" c ON c.id = l.customer_id
            WHERE l.deleted_at IS NULL
            ORDER BY l.created_at DESC
            LIMIT 5
        `),
        pool.query(`
            SELECT 
                TO_CHAR(created_at, 'Dy') as day_name,
                EXTRACT(DOW FROM created_at) as dow,
                DATE(created_at) as date,
                SUM(CASE WHEN type = 'PAYMENT' THEN amount ELSE 0 END) as collected,
                SUM(CASE WHEN type IN ('PRODUCT', 'ADJUSTMENT') THEN amount ELSE 0 END) as debt_added
            FROM "Ledger"
            WHERE created_at >= date_trunc('week', CURRENT_DATE) 
              AND created_at < date_trunc('week', CURRENT_DATE) + INTERVAL '7 days'
              AND deleted_at IS NULL
            GROUP BY DATE(created_at), EXTRACT(DOW FROM created_at), TO_CHAR(created_at, 'Dy')
            ORDER BY DATE(created_at)
        `)
    ]);

    const stats = statsResult.rows[0];
    const totalCustomers = stats?.total_customers || 0;
    const totalDebt = stats?.total_debt || 0;
    const totalReesto = stats?.total_reesto || 0;
    const totalPaid = stats?.total_paid || 0;
    const totalKg = stats?.total_kg || 0;

    const todayKg = todayStatsResult.rows[0]?.today_kg || 0;
    const todayCustomerCount = todayStatsResult.rows[0]?.today_customer_count || 0;
    
    const topDebtors = stats?.top_debtors_json || [];
    const recentTransactions = recentTransactionsResult.rows;
    const weeklyData = weeklyDataResult.rows;

    return {
        totalCustomers,
        totalDebt,
        totalReesto,
        totalPaid,
        totalKg,
        todayKg,
        todayCustomerCount,
        topDebtors,
        recentTransactions,
        weeklyData
    };
};

export const GET = trackApiRoute('/api/dashboard', async (request: Request) => {
    // Double-check auth even though middleware already guards this route
    const cookieHeader = request.headers.get('cookie') || '';
    const cookieToken = cookieHeader.match(/dadwork_session=([^;]+)/)?.[1];
    const token = cookieToken || request.headers.get('x-session-token');
    if (!token) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const session = await validateSession(token);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {

        const today = new Date().toISOString().split('T')[0];
        
        const getCachedDashboardData = unstable_cache(
            async (date: string) => getDashboardData(date),
            ['dashboard-data-v2', today],
            { tags: ['dashboard'], revalidate: 3600 }
        );

        const data = await getCachedDashboardData(today);

        const response = NextResponse.json(data);
        response.headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
        return response;

    } catch (error: any) {
        console.error('Dashboard Fetch Error:', error);
        return NextResponse.json({ error: error.message || 'Failed to fetch dashboard' }, { status: 500 });
    }
});
