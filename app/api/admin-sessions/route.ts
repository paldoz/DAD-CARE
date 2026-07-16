import { NextResponse } from 'next/server';
import { validateSession, touchSession, getOnlineSessions, getAllSessions } from '@/lib/sessions-store';
import { trackApiRoute } from '@/lib/egress-tracker';

/**
 * GET /api/admin-sessions
 * Returns online and recent session data for the super admin dashboard.
 * Also updates the caller's lastSeenAt (heartbeat).
 */
export const GET = trackApiRoute('/api/admin-sessions', async (request: Request) => {
    try {
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

        if (session.role !== 'SUPER_ADMIN' && session.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        // Touch the session on GET too — so loading this page marks you as online immediately
        if (token) {
            await touchSession(token);
        }

        const [onlineSessions, allSessions] = await Promise.all([
            getOnlineSessions(),
            getAllSessions(),
        ]);

        // Deduplicate by username — keep the most recently seen session per user
        const uniqueOnlineMap = new Map<string, any>();
        for (const s of onlineSessions) {
            const existing = uniqueOnlineMap.get(s.username);
            if (!existing || s.lastSeenAt > existing.lastSeenAt) {
                uniqueOnlineMap.set(s.username, s);
            }
        }

        const uniqueAllMap = new Map<string, any>();
        for (const s of allSessions) {
            const existing = uniqueAllMap.get(s.username);
            if (!existing || s.lastSeenAt > existing.lastSeenAt) {
                uniqueAllMap.set(s.username, s);
            }
        }

        const now = Date.now();
        const sanitize = (s: any) => ({
            username: s.username,
            name: s.name,
            role: s.role,
            avatarUrl: null, // Stripped to save egress (frontend uses localStorage cache)
            loginAt: s.loginAt,
            lastSeenAt: new Date(s.lastSeenAt).toISOString(),
            isOnline: (now - s.lastSeenAt) < 5 * 60 * 1000,
        });

        const onlineList = Array.from(uniqueOnlineMap.values()).map(sanitize);
        const allList = Array.from(uniqueAllMap.values()).map(sanitize);

        const res = NextResponse.json({
            online: onlineList,
            all: allList,
            totalOnline: onlineList.length,
        });
        // No CDN cache — must be fresh every time so "Who's Online" is accurate
        res.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        return res;
    } catch (error: any) {
        console.error('Admin Sessions Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});

/**
 * POST /api/admin-sessions
 * Heartbeat endpoint — keeps the current user's session marked as "online".
 */
export const POST = trackApiRoute('/api/admin-sessions', async (request: Request) => {
    try {
        const cookieHeader = request.headers.get('cookie') || '';
        const cookieToken = cookieHeader.match(/dadwork_session=([^;]+)/)?.[1];
        const token = cookieToken || request.headers.get('x-session-token');
        if (token) {
            await touchSession(token);
        }
        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ ok: true });
    }
});
