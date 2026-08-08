import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireSuperAdmin } from '@/lib/require-session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    // Only SUPER_ADMIN can run this
    const { errorResponse } = await requireSuperAdmin(request);
    if (errorResponse) return errorResponse;

    try {
        const client = await pool.connect();

        try {
            // Note: Cannot use CONCURRENTLY inside a transaction block, 
            // but we want these to apply immediately. 
            // We use IF NOT EXISTS so it's safe to run multiple times.

            const indexQueries = [
                // ── CUSTOMER TABLE ──
                `CREATE INDEX IF NOT EXISTS idx_customer_deleted_at ON "Customer"(deleted_at) WHERE deleted_at IS NULL;`,
                `CREATE INDEX IF NOT EXISTS idx_customer_code ON "Customer"(customer_code);`,
                
                // ── LEDGER TABLE ──
                `CREATE INDEX IF NOT EXISTS idx_ledger_type ON "Ledger"(type);`,
                `CREATE INDEX IF NOT EXISTS idx_ledger_deleted_at ON "Ledger"(deleted_at) WHERE deleted_at IS NULL;`,
                `CREATE INDEX IF NOT EXISTS idx_ledger_created_at ON "Ledger"(created_at DESC);`,
                `CREATE INDEX IF NOT EXISTS idx_ledger_reference_date ON "Ledger"(reference_date DESC);`,
                `CREATE INDEX IF NOT EXISTS idx_ledger_receipt_id ON "Ledger"(receipt_id);`,
                // Composite index heavily used in customers/route.ts
                `CREATE INDEX IF NOT EXISTS idx_ledger_perf_compound ON "Ledger"(customer_id, type, deleted_at);`,
                `CREATE INDEX IF NOT EXISTS idx_ledger_perf_dates ON "Ledger"(customer_id, type) INCLUDE (amount, kg);`,

                // ── DAILY BOOK TABLE ──
                `CREATE INDEX IF NOT EXISTS idx_dailybook_date ON "DailyBook"(date DESC);`,
                `CREATE INDEX IF NOT EXISTS idx_dailybook_deleted_at ON "DailyBook"(deleted_at) WHERE deleted_at IS NULL;`,

                // ── DAILY BOOK ITEM TABLE ──
                `CREATE INDEX IF NOT EXISTS idx_dbitem_book_id ON "DailyBookItem"(daily_book_id);`,
                `CREATE INDEX IF NOT EXISTS idx_dbitem_deleted_at ON "DailyBookItem"(deleted_at) WHERE deleted_at IS NULL;`,
                // Composite for the massive JOINs
                `CREATE INDEX IF NOT EXISTS idx_dbitem_perf_compound ON "DailyBookItem"(customer_id, deleted_at) INCLUDE (kg);`,

                // ── AUDIT LOG TABLE ──
                `CREATE INDEX IF NOT EXISTS idx_audit_username ON "AuditLog"(username);`,
                `CREATE INDEX IF NOT EXISTS idx_audit_action ON "AuditLog"(action);`,
                `CREATE INDEX IF NOT EXISTS idx_audit_created_at ON "AuditLog"(created_at DESC);`,

                // ── ADMIN SESSIONS ──
                `CREATE INDEX IF NOT EXISTS idx_session_token ON "AdminSession"(token);`,
                `CREATE INDEX IF NOT EXISTS idx_session_username ON "AdminSession"(username);`
            ];

            const results = [];
            // ── DATABASE SIZE OPTIMIZATION (INDEX BLOAT) ──
            const indexDrops = [
                `DROP INDEX IF EXISTS idx_ledger_customer_id;`,
                `DROP INDEX IF EXISTS idx_dbitem_customer_id;`
            ];
            
            for (const dropQuery of indexDrops) {
                const start = Date.now();
                await client.query(dropQuery);
                results.push({ query: dropQuery, timeMs: Date.now() - start });
            }

            for (const query of indexQueries) {
                const start = Date.now();
                await client.query(query);
                results.push({ query: query.split(' ON ')[0], timeMs: Date.now() - start });
            }

            // ── DATABASE SIZE OPTIMIZATION (GHOST SPACE & EXPIRED SESSIONS) ──
            
            // 1. Delete Expired Admin Sessions to free up space
            const sessionStart = Date.now();
            const { rowCount: deletedSessions } = await client.query(`DELETE FROM "AdminSession" WHERE expires_at < NOW()`);
            results.push({ query: `DELETED ${deletedSessions} expired sessions`, timeMs: Date.now() - sessionStart });

            // 2. Vacuum tables to reclaim "Ghost Space" (Dead Tuples)
            // Vacuum cannot be run inside a transaction block, which is fine since we aren't using one.
            const tablesToVacuum = ['Customer', 'Ledger', 'DailyBook', 'DailyBookItem'];
            for (const table of tablesToVacuum) {
                const vacStart = Date.now();
                await client.query(`VACUUM ANALYZE "${table}"`);
                results.push({ query: `VACUUM ANALYZE ${table}`, timeMs: Date.now() - vacStart });
            }

            return NextResponse.json({ 
                success: true, 
                message: 'Supabase Compute fully optimized. All critical indexes created.',
                results 
            });

        } finally {
            client.release();
        }

    } catch (error: any) {
        console.error('Database Optimization Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
