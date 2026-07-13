import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { validateSession } from '@/lib/sessions-store';
import { ensureAuditLogTable } from '@/lib/audit';
import { trackApiRoute } from '@/lib/egress-tracker';
import { unstable_cache } from 'next/cache';

// Cache the per-user stats for 5 minutes — counts LAST 24 HOURS only, resets naturally.
const getCachedAuditStats = unstable_cache(
    async () => {
        // Removed the 24-hour auto-deletion of audit logs based on user request.
        // Audit logs will now be kept permanently.
    const { rows: userStatsRows } = await pool.query(`
            SELECT
                a.username,
                COALESCE(MAX(u.name), MAX(a.name)) as name,
                COALESCE(MAX(u.role)::text, MAX(a.role)) as role,
                COALESCE(MAX(u.avatar_url), NULL) as avatar_url,
                COUNT(a.id) as total_actions,
                MAX(a.created_at) as last_activity,
                MAX(CASE WHEN a.action = 'LOGIN' THEN a.created_at END) as last_login,
                COUNT(CASE WHEN a.action = 'LOGIN' THEN 1 END) as login_count,
                COUNT(CASE WHEN a.action = 'LOGIN_FAILED' THEN 1 END) as failed_logins
            FROM "AuditLog" a
            LEFT JOIN "User" u ON a.username = u.username
            WHERE a.created_at >= NOW() - INTERVAL '24 hours'
            GROUP BY a.username
            ORDER BY last_activity DESC NULLS LAST
        `);
        const { rows: actionRows } = await pool.query(
            `SELECT DISTINCT action FROM "AuditLog" WHERE created_at >= NOW() - INTERVAL '24 hours' ORDER BY action`
        );
        return { userStats: userStatsRows, actions: actionRows.map((r: any) => r.action) };
    },
    ['audit-stats-24h-cache'],
    { revalidate: 300, tags: ['audit-stats'] }  // 5-min cache
);

export const GET = trackApiRoute('/api/audit-logs', async (request: Request) => {
    try {
        // Accept token from httpOnly cookie OR x-session-token header
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

        if (session.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        // Pure read — no DB write. Keeping this route read-only enables CDN caching.

        const { searchParams } = new URL(request.url);
        const filterUser = searchParams.get('user') || '';
        const filterAction = searchParams.get('action') || '';
        const filterDays = parseInt(searchParams.get('days') || '0', 10); // 0 = no limit
        const limit = parseInt(searchParams.get('limit') || '200', 10);
        const offset = parseInt(searchParams.get('offset') || '0', 10);

        await ensureAuditLogTable();

        const conditions: string[] = [];
        const params: any[] = [];
        let idx = 1;

        if (filterUser) {
            conditions.push(`"AuditLog".username ILIKE $${idx++}`);
            params.push(`%${filterUser}%`);
        }
        if (filterAction) {
            conditions.push(`"AuditLog".action = $${idx++}`);
            params.push(filterAction);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Build a date-limited WHERE for the feed query (not the total count)
        const feedConditions = [...conditions];
        let feedIdx = idx;
        const feedParams = [...params];
        if (filterDays > 0) {
            feedConditions.push(`"AuditLog".created_at >= NOW() - INTERVAL '${filterDays} days'`);
        }
        const feedWhere = feedConditions.length > 0 ? `WHERE ${feedConditions.join(' AND ')}` : '';
        // Main logs query — includes device info for each event
        const logsQuery = `
            SELECT 
                "AuditLog".id, 
                "AuditLog".user_id, 
                "AuditLog".username, 
                COALESCE("User".name, "AuditLog".name) as name, 
                "AuditLog".role, 
                "AuditLog".action, 
                "AuditLog".details, 
                "AuditLog".ip_address, 
                "AuditLog".user_agent, 
                COALESCE("AuditLog".created_at, NOW()) as created_at
            FROM "AuditLog"
            LEFT JOIN "User" ON "AuditLog".username = "User".username
            ${feedWhere}
            ORDER BY "AuditLog".created_at DESC
            LIMIT $${feedIdx++} OFFSET $${feedIdx++}
        `;
        feedParams.push(limit, offset);

        const { rows: logs } = await pool.query(logsQuery, feedParams);

        // Count total
        const countParams = conditions.length > 0 ? params.slice(0, conditions.length) : [];
        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*) as total FROM "AuditLog" ${where}`,
            countParams
        );
        const total = parseInt(countRows[0]?.total || '0', 10);

        const includeStats = searchParams.get('stats') === 'true';

        let userStats = [];
        let actions: string[] = [];

        if (includeStats) {
            const cached = await getCachedAuditStats();
            userStats = cached.userStats;
            actions = cached.actions;
        }

        const res = NextResponse.json({
            logs,
            total,
            limit,
            offset,
            userStats,
            actions,
        });
        res.headers.set('Cache-Control', 'private, max-age=120, stale-while-revalidate=300');
        return res;
    } catch (error: any) {
        console.error('Audit Log GET Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
