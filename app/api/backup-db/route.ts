import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireSession } from '@/lib/require-session';
import { rateLimitResponse } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
    const { session, errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;
    if (session?.role !== 'ADMIN' && session?.role !== 'SUPER_ADMIN') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Rate Limit: 10 backups allowed per hour per IP/User
    const limited = rateLimitResponse(request, 10, 3_600_000);
    if (limited) {
        return NextResponse.json({ error: 'Rate limit exceeded. You can only download a backup 10 times per hour.' }, { status: 429 });
    }

    try {
        // Query 100% of rows with ALL columns — NO LIMIT, NO TRUNCATION
        const [
            customersRes,
            ledgerRes,
            dailyBookRes,
            dailyBookItemsRes,
            usersRes,
            settingsRes,
            businessDaysRes,
            pendingApprovalsRes,
            auditLogsRes
        ] = await Promise.all([
            pool.query('SELECT * FROM "Customer" ORDER BY created_at ASC'),
            pool.query('SELECT * FROM "Ledger" ORDER BY created_at ASC'),
            pool.query('SELECT * FROM "DailyBook" ORDER BY date ASC'),
            pool.query('SELECT * FROM "DailyBookItem" ORDER BY id ASC'),
            pool.query('SELECT * FROM "User" ORDER BY created_at ASC'),
            pool.query('SELECT * FROM "Settings" ORDER BY key ASC'),
            pool.query('SELECT * FROM "BusinessDay" ORDER BY date ASC'),
            pool.query('SELECT * FROM "PendingApprovals" ORDER BY created_at ASC'),
            pool.query('SELECT * FROM "AuditLog" ORDER BY created_at ASC'),
        ]);

        const counts = {
            customers: customersRes.rowCount ?? customersRes.rows.length,
            ledger: ledgerRes.rowCount ?? ledgerRes.rows.length,
            dailyBook: dailyBookRes.rowCount ?? dailyBookRes.rows.length,
            dailyBookItems: dailyBookItemsRes.rowCount ?? dailyBookItemsRes.rows.length,
            users: usersRes.rowCount ?? usersRes.rows.length,
            settings: settingsRes.rowCount ?? settingsRes.rows.length,
            businessDay: businessDaysRes.rowCount ?? businessDaysRes.rows.length,
            pendingApprovals: pendingApprovalsRes.rowCount ?? pendingApprovalsRes.rows.length,
            auditLog: auditLogsRes.rowCount ?? auditLogsRes.rows.length,
        };

        const backupPayload = {
            version: '2.0',
            exportedAt: new Date().toISOString(),
            exportedBy: session.username,
            recordCounts: counts,
            // Full table arrays with all columns preserved
            customers: customersRes.rows,
            ledger: ledgerRes.rows,
            dailyBook: dailyBookRes.rows,
            dailyBookItems: dailyBookItemsRes.rows,
            users: usersRes.rows,
            settings: settingsRes.rows,
            businessDay: businessDaysRes.rows,
            pendingApprovals: pendingApprovalsRes.rows,
            auditLog: auditLogsRes.rows,
        };

        const response = NextResponse.json({
            success: true,
            message: 'Full database backup export successful',
            counts,
            timestamp: backupPayload.exportedAt,
            data: backupPayload,
        });

        response.headers.set('Cache-Control', 'private, no-store');
        return response;
    } catch (error: any) {
        console.error('Backup DB Export Failed:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

