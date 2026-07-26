/**
 * Shared auth helper for Next.js API Route Handlers.
 *
 * Usage in any route.ts:
 *   import { requireSession } from '@/lib/require-session';
 *
 *   export async function GET(request: Request) {
 *       const { session, errorResponse } = await requireSession(request);
 *       if (errorResponse) return errorResponse;
 *       // session.userId, session.username, session.role are available
 *   }
 */

import { NextResponse } from 'next/server';
import { validateSession } from '@/lib/sessions-store';

type SessionResult =
    | { session: { userId: string; username: string; role: string; assigned_customer_ids: string[] }; errorResponse: null }
    | { session: null; errorResponse: NextResponse };

// ── In-memory session cache ──────────────────────────────────────────────────
// Caches validated sessions for 60 seconds per serverless instance.
// This prevents a database roundtrip on EVERY API call, which is the #1
// cause of excessive Supabase connection/query usage.
// The cache is intentionally short-lived (5m) to respect logouts and
// kicked users within a reasonable window, while minimizing DB hits.
const SESSION_CACHE_TTL_MS = 300_000; // 5 minutes

interface CachedSession {
    session: { userId: string; username: string; role: string; assigned_customer_ids: string[] } | null;
    expiresAt: number;
}

const sessionCache = new Map<string, CachedSession>();

// We remove setInterval to avoid serverless memory/hanging issues.
// Instead, we passively evict stale entries when the cache gets too large (e.g., > 1000 entries)
// or during normal lookups.
function evictStaleCache() {
    const now = Date.now();
    for (const [token, cached] of sessionCache.entries()) {
        if (cached.expiresAt < now) sessionCache.delete(token);
    }
}

async function getCachedSession(token: string) {
    if (sessionCache.size > 1000) evictStaleCache();
    
    const cached = sessionCache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.session; // Cache hit (valid or explicitly invalid)
    }
    
    // Passively delete expired hit
    if (cached) sessionCache.delete(token);
    // Cache miss — validate against DB
    const session = await validateSession(token);
    
    // Cache the result (whether valid or null) so we don't spam the DB if token is bad
    sessionCache.set(token, { session, expiresAt: Date.now() + SESSION_CACHE_TTL_MS });
    
    return session;
}

/**
 * Reads the session token from the request (httpOnly cookie first, then x-session-token header)
 * and validates it — using an in-memory cache to avoid a database hit on every single request.
 *
 * Returns either a valid session object or a ready-to-return 401 NextResponse.
 */
export async function requireSession(request: Request): Promise<SessionResult> {
    const cookieHeader = request.headers.get('cookie') || '';
    const cookieToken = cookieHeader.match(/dadwork_session=([^;]+)/)?.[1];
    const token = cookieToken || request.headers.get('x-session-token');

    if (!token) {
        return {
            session: null,
            errorResponse: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
        };
    }

    const session = await getCachedSession(token);
    if (!session) {
        return {
            session: null,
            errorResponse: NextResponse.json({ error: 'Unauthorized – session expired or invalid' }, { status: 401 }),
        };
    }

    return { session, errorResponse: null };
}

/**
 * Like requireSession, but additionally checks that the user has the SUPER_ADMIN role.
 */
export async function requireSuperAdmin(request: Request): Promise<SessionResult> {
    const result = await requireSession(request);
    if (result.errorResponse) return result;

    if (result.session.role !== 'SUPER_ADMIN') {
        return {
            session: null,
            errorResponse: NextResponse.json({ error: 'Forbidden – admin access required' }, { status: 403 }),
        };
    }

    return result;
}

/**
 * Immediately evict a token from the session cache.
 * Call this on logout or when kicking a user so they are denied access instantly.
 */
export function evictSessionCache(token: string) {
    sessionCache.delete(token);
}
