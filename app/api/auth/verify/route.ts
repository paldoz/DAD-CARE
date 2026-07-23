export const dynamic = 'force-dynamic';
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
        // Removed Cache-Control: 'max-age=60' here.
        // It was causing the browser's HTTP disk cache to serve the OLD user's session
        // to the NEW user for 60 seconds after logging in, creating the "takes time to get role" bug.
        res.headers.set('Cache-Control', 'no-store, max-age=0');
        return res;
    } catch {
        return NextResponse.json({ valid: false }, { status: 401 });
    }
}
