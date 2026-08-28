import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit';
import { requireSession } from '@/lib/require-session';
import { revalidateTag } from 'next/cache';


export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;

    try {
        const [dailyBooks, ledgerEntries] = await Promise.all([
            pool.query(`
                SELECT id, date, deleted_at, deleted_by, 'daily-book' as type
                FROM "DailyBook"
                WHERE deleted_at IS NOT NULL
                ORDER BY deleted_at DESC
                LIMIT 100
            `),
            pool.query(`
                SELECT l.id, l.customer_id, l.reference_date as date, l.deleted_at, l.deleted_by, 'ledger' as type, l.type as ledger_type, l.amount, l.kg, l.note, c.name as customer_name
                FROM "Ledger" l
                LEFT JOIN "Customer" c ON c.id = l.customer_id
                WHERE l.deleted_at IS NOT NULL
                ORDER BY l.deleted_at DESC
                LIMIT 100
            `)
        ]);

        return NextResponse.json({
            dailyBooks: dailyBooks.rows,
            ledgerEntries: ledgerEntries.rows
        });
    } catch (error: any) {
        console.error('Fetch Trash Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const { errorResponse, session } = await requireSession(request);
    if (errorResponse) return errorResponse;
    const body = await request.json();
    const { id, type } = body;

    try {
        if (type === 'daily-book') {
            await pool.query('UPDATE "DailyBook" SET deleted_at = NULL, deleted_by = NULL WHERE id = $1', [id]);
            await pool.query('UPDATE "DailyBookItem" SET deleted_at = NULL WHERE daily_book_id = $1', [id]);
            await logAudit(request, 'RESTORE_TRASH', `Restored daily book (ID: ${id}) by ${session?.username}`);
        } else if (type === 'ledger') {
            await pool.query('UPDATE "Ledger" SET deleted_at = NULL, deleted_by = NULL WHERE id = $1', [id]);
            await logAudit(request, 'RESTORE_TRASH', `Restored ledger entry (ID: ${id}) by ${session?.username}`);
        } else {
            return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
        }

        try {
            // @ts-ignore
            revalidateTag('daily-book-history');
            // @ts-ignore
            revalidateTag('daily-book-init');
            // @ts-ignore
            revalidateTag('customers');
            // @ts-ignore
            revalidateTag('dashboard');
        } catch (e) {
            console.error('Failed to revalidate paths:', e);
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Restore Trash Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    const { errorResponse, session } = await requireSession(request);
    if (errorResponse) return errorResponse;

    if (session?.role !== 'SUPER_ADMIN') {
        return NextResponse.json({ error: 'Unauthorized: Only Super Admins can permanently purge or empty trash.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const forceAll = searchParams.get('all') === 'true';

    try {
        if (forceAll) {
            // Delete all trash (manual empty)
            await pool.query(`DELETE FROM "DailyBookItem" WHERE deleted_at IS NOT NULL`);
            await pool.query(`DELETE FROM "DailyBook" WHERE deleted_at IS NOT NULL`);
            await pool.query(`DELETE FROM "Ledger" WHERE deleted_at IS NOT NULL`);
            await logAudit(request, 'EMPTY_TRASH', `Emptied all trash manually by ${session?.username}`);
        } else {
            // Permanently delete items older than 30 days
            await pool.query(`DELETE FROM "DailyBookItem" WHERE deleted_at < NOW() - INTERVAL '30 days'`);
            await pool.query(`DELETE FROM "DailyBook" WHERE deleted_at < NOW() - INTERVAL '30 days'`);
            await pool.query(`DELETE FROM "Ledger" WHERE deleted_at < NOW() - INTERVAL '30 days'`);
            await logAudit(request, 'PURGE_TRASH', `Purged trash older than 30 days automatically`);
        }
        
        try {
            // @ts-ignore
            revalidateTag('daily-book-history');
            // @ts-ignore
            revalidateTag('daily-book-init');
            // @ts-ignore
            revalidateTag('customers');
            // @ts-ignore
            revalidateTag('dashboard');
        } catch (e) {
            console.error('Failed to revalidate paths:', e);
        }
        
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Purge Trash Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
