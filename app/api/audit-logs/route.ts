import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { validateSession } from '@/lib/sessions-store';
import { ensureAuditLogTable } from '@/lib/audit';
import { trackApiRoute } from '@/lib/egress-tracker';
import { unstable_cache } from 'next/cache';

export const dynamic = 'force-dynamic';

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
                NULL as avatar_url,
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
        const limit = parseInt(searchParams.get('limit') || '50', 10);
        const offset = parseInt(searchParams.get('offset') || '0', 10);

        // ── CHEAP CHECK MODE: only returns {count, latestId} ──
        // Called every 60s by the client. Costs 1 tiny index scan instead of fetching rows.
        // The client only does a full fetch when latestId changes.
        if (searchParams.get('check') === '1') {
            const { rows } = await pool.query(
                `SELECT COUNT(*) as count, MAX(created_at) as latest_id FROM "AuditLog"`
            );
            const res = NextResponse.json({
                count: parseInt(rows[0]?.count || '0', 10),
                latestId: rows[0]?.latest_id || null,
            });
            // Cache this tiny response for 20s on Vercel Edge — further reduces DB hits
            res.headers.set('Cache-Control', 's-maxage=20, stale-while-revalidate=10');
            return res;
        }

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
        // Removed cache headers so audit logs load in real-time immediately
        return res;
    } catch (error: any) {
        console.error('Audit Log GET Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});

export const DELETE = trackApiRoute('/api/audit-logs', async (request: Request) => {
    try {
        const cookieHeader = request.headers.get('cookie') || '';
        const cookieToken = cookieHeader.match(/dadwork_session=([^;]+)/)?.[1];
        const token = cookieToken || request.headers.get('x-session-token');

        if (!token) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const session = await validateSession(token);
        if (!session || session.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        await ensureAuditLogTable();

        // Perform the deletion
        await pool.query(`DELETE FROM "AuditLog"`);
        
        // Log the deletion itself so the table isn't completely empty and there is a trace
        await pool.query(`
            INSERT INTO "AuditLog" (user_id, username, name, role, action, details)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [session.userId, session.username, session.username, session.role, 'CLEAR_AUDIT_LOGS', 'Admin cleared all audit logs manually']);

        return NextResponse.json({ success: true, message: 'Audit logs cleared successfully' });
    } catch (error: any) {
        console.error('Audit Log DELETE Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
