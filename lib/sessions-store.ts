/**
 * Database-backed session store.
 * Sessions are stored in the AdminSession table (Postgres via pg pool).
 * This means:
 *   - Sessions survive server restarts
 *   - Every device/browser that logs in is visible across all servers
 *   - SUPER_ADMIN can see exactly who is online from any device in real-time
 *
 * Online threshold: 5 minutes without a heartbeat = OFFLINE
 */

import pool from './db';

export interface SessionData {
    userId: string;
    username: string;
    role: string;
    name?: string;
    avatarUrl?: string;
    createdAt: number;
    lastSeenAt: number;
    loginAt: string;
    ipAddress?: string;
    userAgent?: string;
}

const SESSION_TTL_HOURS = 30 * 24; // 30 days
const ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// ─── Table bootstrap ────────────────────────────────────────────────────────

let tableReady = false;

async function ensureTable() {
    if (tableReady) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS "AdminSession" (
            token        TEXT PRIMARY KEY,
            user_id      TEXT,
            username     TEXT NOT NULL,
            name         TEXT,
            role         TEXT NOT NULL,
            avatar_url   TEXT,
            ip_address   TEXT,
            user_agent   TEXT,
            login_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at   TIMESTAMPTZ NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_adminsession_username ON "AdminSession"(username);
        CREATE INDEX IF NOT EXISTS idx_adminsession_last_seen ON "AdminSession"(last_seen_at);
    `);

    // Auto-repair: if the table was restored from backup without a PRIMARY KEY on token,
    // the ON CONFLICT clause will fail. Add the constraint if it's missing.
    try {
        await pool.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conrelid = '"AdminSession"'::regclass
                      AND contype = 'p'
                ) THEN
                    ALTER TABLE "AdminSession" ADD PRIMARY KEY (token);
                END IF;
            END$$;
        `);
    } catch {
        // If constraint already exists or table is locked, silently continue
    }

    tableReady = true;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function createSession(
    token: string,
    userId: string,
    username: string,
    role: string,
    options?: { name?: string; avatarUrl?: string; ipAddress?: string; userAgent?: string }
): Promise<void> {
    await ensureTable();
    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_TTL_HOURS * 3600 * 1000);
    await pool.query(
        `INSERT INTO "AdminSession" (token, user_id, username, name, role, avatar_url, ip_address, user_agent, login_at, last_seen_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10)`,
        [
            token,
            userId,
            username,
            options?.name || null,
            role,
            options?.avatarUrl || null,
            options?.ipAddress || null,
            options?.userAgent || null,
            now,
            expires,
        ]
    );
}

export async function validateSession(token: string): Promise<{ userId: string; username: string; role: string } | null> {
    try {
        await ensureTable();
        // Combine SELECT + touch last_seen_at into a single round-trip, AND join with User table to check is_active
        const { rows } = await pool.query(
            `WITH updated AS (
                UPDATE "AdminSession"
                SET last_seen_at = NOW()
                WHERE token = $1 AND expires_at > NOW()
                RETURNING user_id, username, role
             )
             SELECT updated.user_id, updated.username, updated.role, u.is_active 
             FROM updated 
             JOIN "User" u ON u.username = updated.username 
             LIMIT 1`,
            [token]
        );
        if (!rows.length) return null;
        const r = rows[0];
        
        // Kick out inactive/deleted users immediately
        if (r.is_active === false) {
            await pool.query(`DELETE FROM "AdminSession" WHERE token = $1`, [token]);
            return null;
        }
        
        return { userId: r.user_id, username: r.username, role: r.role };
    } catch {
        return null;
    }
}

export async function touchSession(token: string): Promise<void> {
    try {
        await ensureTable();
        await pool.query(`UPDATE "AdminSession" SET last_seen_at = NOW() WHERE token = $1 AND expires_at > NOW()`, [token]);
    } catch { /* non-fatal */ }
}

export async function deleteSession(token: string): Promise<void> {
    try {
        await ensureTable();
        await pool.query(`DELETE FROM "AdminSession" WHERE token = $1`, [token]);
    } catch { /* non-fatal */ }
}

export async function getSessionCount(): Promise<number> {
    try {
        await ensureTable();
        const { rows } = await pool.query(`SELECT COUNT(*) as c FROM "AdminSession" WHERE expires_at > NOW()`);
        return parseInt(rows[0]?.c || '0', 10);
    } catch { return 0; }
}

/** All sessions whose last_seen_at is within the last 5 minutes (ONLINE). */
export async function getOnlineSessions(): Promise<SessionData[]> {
    try {
        await ensureTable();
        const cutoff = new Date(Date.now() - ONLINE_THRESHOLD_MS);
        const { rows } = await pool.query(
            `SELECT s.user_id, s.username, s.name, s.role, s.login_at, s.last_seen_at, s.ip_address,
                    CASE WHEN u.avatar_url IS NOT NULL AND u.avatar_url LIKE 'http%' AND length(u.avatar_url) < 500
                         THEN u.avatar_url ELSE NULL END as avatar_url
             FROM "AdminSession" s
             LEFT JOIN "User" u ON u.username = s.username
             WHERE s.expires_at > NOW() AND s.last_seen_at >= $1
             ORDER BY s.last_seen_at DESC`,
            [cutoff]
        );
        return rows.map(rowToSession);
    } catch { return []; }
}

/** All sessions that haven't expired (regardless of last_seen_at). */
export async function getAllSessions(): Promise<SessionData[]> {
    try {
        await ensureTable();
        const { rows } = await pool.query(
            `SELECT s.user_id, s.username, s.name, s.role, s.login_at, s.last_seen_at, s.ip_address,
                    CASE WHEN u.avatar_url IS NOT NULL AND u.avatar_url LIKE 'http%' AND length(u.avatar_url) < 500
                         THEN u.avatar_url ELSE NULL END as avatar_url
             FROM "AdminSession" s
             LEFT JOIN "User" u ON u.username = s.username
             WHERE s.expires_at > NOW()
             ORDER BY s.last_seen_at DESC`
        );
        return rows.map(rowToSession);
    } catch { return []; }
}

// ─── Private helper ──────────────────────────────────────────────────────────

function rowToSession(r: any): SessionData {
    return {
        userId: r.user_id,
        username: r.username,
        name: r.name,
        role: r.role,
        avatarUrl: r.avatar_url || undefined,  // only real http URLs, never base64
        createdAt: new Date(r.login_at).getTime(),
        lastSeenAt: new Date(r.last_seen_at).getTime(),
        loginAt: new Date(r.login_at).toISOString(),
        ipAddress: r.ip_address,
        userAgent: undefined,   // stripped — not needed by UI
    };
}
