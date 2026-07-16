import { NextResponse } from 'next/server';
import { validateSession } from '@/lib/sessions-store';

/**
 * Lightweight session-check endpoint.
 * Called by middleware (via internal fetch) to confirm a cookie token
 * is genuinely valid in the DB — not just syntactically long.
 *
 * Returns 200 if valid, 401 if expired/fake/not found.
 */
export async function GET(request: Request) {
    try {
        const cookieHeader = request.headers.get('cookie') || '';
        const cookieToken = cookieHeader.match(/dadwork_session=([^;]+)/)?.[1];
        const token = cookieToken || request.headers.get('x-session-token');

        if (!token) {
            return NextResponse.json({ valid: false }, { status: 401 });
        }

        const session = await validateSession(token);

        if (!session) {
            return NextResponse.json({ valid: false }, { status: 401 });
        }

        const res = NextResponse.json({ valid: true, username: session.username, role: session.role });
        // Cache at the edge for 60s — eliminates a DB hit on every page navigation.
        // The token itself is in the cookie, so per-user responses are naturally scoped.
        res.headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
        return res;
    } catch {
        return NextResponse.json({ valid: false }, { status: 401 });
    }
}
