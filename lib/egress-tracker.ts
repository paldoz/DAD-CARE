import { logAuditDirect } from '@/lib/audit';

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * EGRESS TRACKER — Measures REAL bytes leaving every API route.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * How it works:
 *   1. Each API route calls `trackResponse(route, response)` before returning.
 *   2. We clone the response, read the body to measure exact byte length.
 *   3. Stats are stored in a global in-memory Map (survives hot-reloads).
 *   4. GET /api/egress-stats returns a full ranked breakdown.
 *
 * What it measures:
 *   - Total requests per route
 *   - Response body size in bytes (the REAL JSON payload)
 *   - Execution time (when used with trackApiRoute wrapper)
 *   - Peak (largest) response per route
 *   - Running total bytes transferred per route
 *
 * This is PRODUCTION-SAFE: no file I/O, no external deps, ~0.5ms overhead.
 * Stats reset when the serverless instance cold-starts.
 */

export interface RouteStats {
    route: string;
    totalRequests: number;
    totalBytes: number;
    largestResponseBytes: number;
    smallestResponseBytes: number;
    avgResponseBytes: number;
    totalTimeMs: number;
    avgTimeMs: number;
    fastestMs: number;
    slowestMs: number;
    lastCalledAt: string;
    statusCodes: Record<number, number>;
    // Per-request log (last 20 for debugging)
    recentRequests: {
        timestamp: string;
        bytes: number;
        timeMs: number;
        status: number;
        queryParams?: string;
    }[];
}

interface InternalStats {
    totalRequests: number;
    totalBytes: number;
    largestResponseBytes: number;
    smallestResponseBytes: number;
    totalTimeMs: number;
    fastestMs: number;
    slowestMs: number;
    lastCalledAt: string;
    lastSizeAlertTimeMs: number;
    lastRateAlertTimeMs: number;
    statusCodes: Record<number, number>;
    recentRequests: {
        timestamp: string;
        bytes: number;
        timeMs: number;
        status: number;
        queryParams?: string;
    }[];
}

// ── Global singleton (survives hot-reloads in dev) ───────────────────────────
declare global {
    var __egressTracker: Map<string, InternalStats> | undefined;
    var __egressTrackerStartedAt: string | undefined;
}

if (!globalThis.__egressTracker) {
    globalThis.__egressTracker = new Map();
    globalThis.__egressTrackerStartedAt = new Date().toISOString();
}

const tracker = globalThis.__egressTracker;

const MAX_RECENT = 30; // Keep last 30 requests per route for debugging

/**
 * Record a single request's stats for a route.
 */
function record(
    route: string,
    bytes: number,
    timeMs: number,
    status: number,
    queryParams?: string
) {
    const now = new Date().toISOString();
    let stats = tracker.get(route);

    if (!stats) {
        stats = {
            totalRequests: 0,
            totalBytes: 0,
            largestResponseBytes: 0,
            smallestResponseBytes: Infinity,
            totalTimeMs: 0,
            fastestMs: Infinity,
            slowestMs: 0,
            lastCalledAt: now,
            lastSizeAlertTimeMs: 0,
            lastRateAlertTimeMs: 0,
            statusCodes: {},
            recentRequests: [],
        };
        tracker.set(route, stats);
    }

    stats.totalRequests++;
    stats.totalBytes += bytes;
    stats.totalTimeMs += timeMs;
    stats.lastCalledAt = now;

    if (bytes > stats.largestResponseBytes) stats.largestResponseBytes = bytes;
    if (bytes < stats.smallestResponseBytes) stats.smallestResponseBytes = bytes;
    if (timeMs > stats.slowestMs) stats.slowestMs = timeMs;
    if (timeMs < stats.fastestMs) stats.fastestMs = timeMs;

    stats.statusCodes[status] = (stats.statusCodes[status] || 0) + 1;

    stats.recentRequests.push({ timestamp: now, bytes, timeMs, status, queryParams });
    if (stats.recentRequests.length > MAX_RECENT) {
        stats.recentRequests.shift();
    }
}

function formatBytes(b: number): string {
    if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(2)} MB`;
    if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${b} B`;
}

/**
 * Measure a NextResponse body and record stats.
 * Returns the ORIGINAL response (does not consume it).
 */
export async function trackResponse(
    route: string,
    response: Response,
    startTime: number,
    queryParams?: string
): Promise<Response> {
    const timeMs = Math.round(Date.now() - startTime);
    const status = response.status;

    // Clone the response so we can read the body without consuming it
    let bytes = 0;
    try {
        const cloned = response.clone();
        const body = await cloned.arrayBuffer();
        bytes = body.byteLength;
    } catch {
        // If body can't be read (e.g. streaming), estimate from content-length
        const cl = response.headers.get('content-length');
        bytes = cl ? parseInt(cl, 10) : 0;
    }

    record(route, bytes, timeMs, status, queryParams);

    // --- BANDWIDTH EMERGENCY BRAKE ---
    const stats = tracker.get(route);
    if (stats) {
        const nowMs = Date.now();
        
        // Rule 1: Large Payload (> 1 MB) - Alert at most once per 5 mins
        if (bytes > 1048576 && (nowMs - stats.lastSizeAlertTimeMs) > 300000) {
            stats.lastSizeAlertTimeMs = nowMs;
            logAuditDirect({
                username: 'SYSTEM',
                role: 'SYSTEM',
                action: 'BANDWIDTH_ALERT',
                details: `LARGE PAYLOAD: ${route} returned ${formatBytes(bytes)} (Limit: 1 MB)`
            }).catch(console.error);
        }

        // Rule 2: High Request Rate (> 50 reqs / min)
        const uptimeMinutes = (nowMs - new Date(globalThis.__egressTrackerStartedAt || nowMs).getTime()) / 60000;
        if (uptimeMinutes >= 1) { // Only evaluate rate after 1 min of uptime
            const reqsPerMinute = stats.totalRequests / uptimeMinutes;
            if (reqsPerMinute > 50 && (nowMs - stats.lastRateAlertTimeMs) > 300000) {
                stats.lastRateAlertTimeMs = nowMs;
                logAuditDirect({
                    username: 'SYSTEM',
                    role: 'SYSTEM',
                    action: 'BANDWIDTH_ALERT',
                    details: `HIGH FREQUENCY: ${route} called ${Math.round(reqsPerMinute)} times per min (Limit: 50/min)`
                }).catch(console.error);
            }
        }
    }
    // ---------------------------------

    // Log to server console for immediate visibility
    const sizeStr = bytes > 1024 * 1024
        ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
        : bytes > 1024
            ? `${(bytes / 1024).toFixed(1)} KB`
            : `${bytes} B`;

    console.log(
        `[EGRESS] ${route} | ${status} | ${sizeStr} | ${timeMs}ms${queryParams ? ` | ?${queryParams}` : ''}`
    );

    return response;
}

/**
 * High-level wrapper: wraps an entire route handler with tracking.
 *
 * Usage:
 *   export const GET = trackApiRoute('/api/customers', async (request) => {
 *       // ... your logic ...
 *       return NextResponse.json(data);
 *   });
 */
export function trackApiRoute<T extends Request, C = any>(
    route: string,
    handler: (request: T, context: C) => Promise<Response>
) {
    return async (request: T, context: C): Promise<Response> => {
        const startTime = Date.now();
        let queryParams: string | undefined;

        try {
            const url = new URL(request.url);
            queryParams = url.search ? url.search.substring(1) : undefined;
        } catch { /* ignore */ }

        try {
            const response = await handler(request, context);
            return await trackResponse(route, response, startTime, queryParams);
        } catch (error: any) {
            // Even errors get tracked
            const errorResponse = new Response(
                JSON.stringify({ error: error.message || 'Internal Server Error' }),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
            return await trackResponse(route, errorResponse, startTime, queryParams);
        }
    };
}

// ── Stats retrieval ──────────────────────────────────────────────────────────



export function getEgressStats(): {
    startedAt: string;
    uptimeSeconds: number;
    totalRequests: number;
    totalEgressBytes: number;
    totalEgressFormatted: string;
    routes: (RouteStats & { rank: number; percentOfTotal: string; totalBytesFormatted: string; avgBytesFormatted: string; largestFormatted: string })[];
} {
    const startedAt = globalThis.__egressTrackerStartedAt || new Date().toISOString();
    const uptimeSeconds = Math.round((Date.now() - new Date(startedAt).getTime()) / 1000);

    let grandTotalBytes = 0;
    let grandTotalRequests = 0;

    const routeList: RouteStats[] = [];

    for (const [route, stats] of tracker.entries()) {
        const avgBytes = stats.totalRequests > 0
            ? Math.round(stats.totalBytes / stats.totalRequests)
            : 0;
        const avgTimeMs = stats.totalRequests > 0
            ? Math.round(stats.totalTimeMs / stats.totalRequests)
            : 0;

        grandTotalBytes += stats.totalBytes;
        grandTotalRequests += stats.totalRequests;

        routeList.push({
            route,
            totalRequests: stats.totalRequests,
            totalBytes: stats.totalBytes,
            largestResponseBytes: stats.largestResponseBytes,
            smallestResponseBytes: stats.smallestResponseBytes === Infinity ? 0 : stats.smallestResponseBytes,
            avgResponseBytes: avgBytes,
            totalTimeMs: stats.totalTimeMs,
            avgTimeMs,
            fastestMs: stats.fastestMs === Infinity ? 0 : stats.fastestMs,
            slowestMs: stats.slowestMs,
            lastCalledAt: stats.lastCalledAt,
            statusCodes: stats.statusCodes,
            recentRequests: stats.recentRequests,
        });
    }

    // Sort by totalBytes descending (biggest bandwidth hog first)
    routeList.sort((a, b) => b.totalBytes - a.totalBytes);

    return {
        startedAt,
        uptimeSeconds,
        totalRequests: grandTotalRequests,
        totalEgressBytes: grandTotalBytes,
        totalEgressFormatted: formatBytes(grandTotalBytes),
        routes: routeList.map((r, i) => ({
            ...r,
            rank: i + 1,
            percentOfTotal: grandTotalBytes > 0
                ? `${((r.totalBytes / grandTotalBytes) * 100).toFixed(1)}%`
                : '0%',
            totalBytesFormatted: formatBytes(r.totalBytes),
            avgBytesFormatted: formatBytes(r.avgResponseBytes),
            largestFormatted: formatBytes(r.largestResponseBytes),
        })),
    };
}

/**
 * Reset all stats (useful after a test run).
 */
export function resetEgressStats() {
    tracker.clear();
    globalThis.__egressTrackerStartedAt = new Date().toISOString();
}
