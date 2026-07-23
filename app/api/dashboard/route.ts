import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { validateSession } from '@/lib/sessions-store';
import { trackApiRoute } from '@/lib/egress-tracker';
import { unstable_cache } from 'next/cache';

export const dynamic = 'force-dynamic';

const getDashboardData = unstable_cache(
    async (today: string) => {
        // Combined query for customer count and ledger stats to dramatically reduce Supabase compute
        const [statsResult, todayStatsResult] = await Promise.all([
            pool.query(`
                WITH latest_ledger AS (
                    SELECT DISTINCT ON (customer_id) new_debt
                    FROM "Ledger"
                    WHERE deleted_at IS NULL
                    ORDER BY customer_id, created_at DESC, id DESC
                )
                SELECT 
                    (SELECT count(*)::int FROM "Customer" WHERE deleted_at IS NULL AND is_kabarka = false) as total_customers,
                    (SELECT COALESCE(SUM(CASE WHEN new_debt > 0 THEN new_debt ELSE 0 END), 0)::float FROM latest_ledger) as total_debt,
                    (SELECT ABS(COALESCE(SUM(CASE WHEN new_debt < 0 THEN new_debt ELSE 0 END), 0))::float FROM latest_ledger) as total_reesto,
                    (SELECT COALESCE(SUM(amount), 0)::float FROM "Ledger" WHERE type = 'PAYMENT' AND deleted_at IS NULL) as total_paid,
                    (SELECT COALESCE(SUM(kg), 0)::float FROM "Ledger" WHERE type = 'PRODUCT' AND deleted_at IS NULL) as total_kg
            `),
            pool.query(`
                SELECT 
                    COALESCE(SUM(dbi.kg), 0)::float as today_kg, 
                    COUNT(dbi.id)::int as today_customer_count
                FROM "DailyBookItem" dbi
                JOIN "DailyBook" db ON dbi.daily_book_id = db.id
                WHERE db.date = $1 AND dbi.deleted_at IS NULL AND db.deleted_at IS NULL
            `, [today])
        ]);

        const stats = statsResult.rows[0];
        const totalCustomers = stats?.total_customers || 0;
        const totalDebt = stats?.total_debt || 0;
        const totalReesto = stats?.total_reesto || 0;
        const totalPaid = stats?.total_paid || 0;
        const totalKg = stats?.total_kg || 0;

        const todayKg = todayStatsResult.rows[0]?.today_kg || 0;
        const todayCustomerCount = todayStatsResult.rows[0]?.today_customer_count || 0;
        const topDebtors: any[] = [];
        const recentTransactions: any[] = [];

        return {
            totalCustomers,
            totalDebt,
            totalReesto,
            totalPaid,
            totalKg,
            todayKg,
            todayCustomerCount,
            topDebtors,
            recentTransactions
        };
    },
    ['dashboard-data-cache'],
    { revalidate: 600, tags: ['dashboard'] }  // 10-min cache — dashboard is read-only stats
);

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
        
        const data = await getDashboardData(today);

        const response = NextResponse.json(data);
        // Cache on Vercel edge for 2min — Supabase is only queried once per 10min max
        response.headers.set('Cache-Control', 's-maxage=120, stale-while-revalidate=480');
        return response;

    } catch (error: any) {
        console.error('Dashboard Fetch Error:', error);
        return NextResponse.json({ error: error.message || 'Failed to fetch dashboard' }, { status: 500 });
    }
});
