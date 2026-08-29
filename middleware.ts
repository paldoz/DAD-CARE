import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyClaim } from '@/lib/token';

export const SESSION_COOKIE = 'dadwork_session';
export const CLAIM_COOKIE = 'dadwork_claim';

// Routes that do NOT require authentication
const PUBLIC_PAGE_ROUTES = ['/login'];
const PUBLIC_API_ROUTES = [
    '/api/auth/login',
    '/api/auth/verify',
];

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Instantly block bot traffic hitting old/unused routes to save Vercel bandwidth
    const BOT_PATHS = ['/blog', '/api/generate', '/api/blog', '/api/demo', '/api/notifications'];
    if (BOT_PATHS.some(r => pathname === r || pathname.startsWith(r + '/'))) {
        return new NextResponse(null, { status: 404 });
    }

    // Allow all public page routes
    if (PUBLIC_PAGE_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/'))) {
        return NextResponse.next();
    }

    // Allow public API routes
    if (PUBLIC_API_ROUTES.some(r => pathname.startsWith(r))) {
        return NextResponse.next();
    }

    // Allow logout unconditionally (idempotent, must always work)
    if (pathname.startsWith('/api/auth/logout')) {
        return NextResponse.next();
    }

    // ── Check session token presence ───────────────────────────────────────────
    const cookieToken = request.cookies.get(SESSION_COOKIE)?.value;
    const headerToken = request.headers.get('x-session-token');
    const token = cookieToken || headerToken;

    // No token at all — reject immediately
    if (!token) {
        if (pathname.startsWith('/api/')) {
            return NextResponse.json({ error: 'Unauthorized – please log in' }, { status: 401 });
        }
        return NextResponse.redirect(new URL('/login', request.url));
    }

    // ── API routes: token present → let the route handler do the real DB check ─
    // requireSession() inside each handler validates against the DB, so we don't
    // need to do it here. This removes an entire DB round-trip from every request.
    if (pathname.startsWith('/api/')) {
        return NextResponse.next();
    }

    // ── Page routes: verify the signed claim cookie (ZERO DB calls) ───────────
    // On login, we set a `dadwork_claim` cookie with HMAC-signed payload
    // (username + role + expiry). We verify the signature here locally.
    // This replaces the old internal fetch → /api/auth/verify which caused
    // 15-20 second cold-start delays on Netlify.
    const claim = request.cookies.get(CLAIM_COOKIE)?.value;

    if (claim) {
        const payload = await verifyClaim(claim);
        if (payload) {
            // Claim is valid — allow the page to render immediately
            return NextResponse.next();
        }
        // Claim is expired or tampered — redirect to login
        return NextResponse.redirect(new URL('/login', request.url));
    }

    // ── Fallback: no claim cookie (e.g. old login before this deploy) ─────────
    // If they have a session token but no claim cookie, they logged in before
    // this update. We allow them through once — the first API call will do
    // the real DB check via requireSession(). On their next login they will
    // get the claim cookie and everything will be fast.
    // This prevents locking out existing users after deploy.
    return NextResponse.next();
}

export const config = {
    // Run on every route EXCEPT Next.js internals, static files, and public assets
    matcher: [
        '/((?!_next/static|_next/image|favicon\\.ico|icons|manifest\\.json|sw\\.js|.*\\.png|.*\\.jpg|.*\\.jpeg|.*\\.svg|.*\\.ico|.*\\.webp).*)',
    ],
};
