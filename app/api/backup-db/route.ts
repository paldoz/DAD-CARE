import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireSession } from '@/lib/require-session';
import { rateLimitResponse } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    // Only superadmin can run backup — prevents accidental egress spikes
    const { session, errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;
    if (session?.role !== 'ADMIN') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Rate Limit: 1 backup allowed per hour per IP/User to protect bandwidth
    const limited = rateLimitResponse(request, 1, 3_600_000);
    if (limited) return NextResponse.json({ error: 'Rate limit exceeded. You can only backup the database once per hour.' }, { status: 429 });

    try {
        // Fetch only the columns needed — avoids downloading avatar_url blobs etc.
        const [usersRes, customersRes, ledgerRes, dailyBookRes, dailyBookItemsRes] = await Promise.all([
            pool.query('SELECT id, username, name, role, is_active, phone, created_at FROM "User"'),
            pool.query('SELECT id, customer_code, name, created_at FROM "Customer"'),
            pool.query('SELECT id, customer_id, type, reference_date, kg, price_per_kg, amount, previous_debt, new_debt, note, created_at FROM "Ledger" WHERE deleted_at IS NULL'),
            pool.query('SELECT id, date, created_at FROM "DailyBook" WHERE deleted_at IS NULL'),
            pool.query('SELECT id, daily_book_id, customer_id, kg, present, note FROM "DailyBookItem"'),
        ]);

        const backupData = {
            users: usersRes.rows,
            customers: customersRes.rows,
            ledger: ledgerRes.rows,
            dailyBook: dailyBookRes.rows,
            dailyBookItems: dailyBookItemsRes.rows,
            timestamp: new Date().toISOString()
        };

        return NextResponse.json({
            success: true,
            message: 'Backup successful!',
            counts: {
                users: backupData.users.length,
                customers: backupData.customers.length,
                ledger: backupData.ledger.length,
                dailyBook: backupData.dailyBook.length,
                dailyBookItems: backupData.dailyBookItems.length,
            },
            data: backupData,
        });

    } catch (error: any) {
        console.error('Backup Failed:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
