import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/require-session';
import { logAudit } from '@/lib/audit';
import { revalidateTag, revalidatePath } from 'next/cache';
import { recalculateCustomerLedger } from '@/lib/ledger-utils';

export async function DELETE(request: Request) {
    const { errorResponse, session } = await requireSession(request);
    if (errorResponse) return errorResponse;

    if (session.role !== 'SUPER_ADMIN') {
        return NextResponse.json({ error: 'Security: Only Super Admins can permanently delete receipt blocks.' }, { status: 403 });
    }

    try {
        const body = await request.json();
        const { transactionIds, customerId } = body;

        if (!transactionIds || !Array.isArray(transactionIds) || transactionIds.length === 0) {
            return NextResponse.json({ error: 'Valid transactionIds array required' }, { status: 400 });
        }

        if (!customerId) {
            return NextResponse.json({ error: 'Customer ID required' }, { status: 400 });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Soft delete all specified transactions for this customer
            // We ensure we only delete transactions belonging to the customer just to be safe.
            const query = `
                UPDATE "Ledger"
                SET deleted_at = NOW(), deleted_by = $1
                WHERE id = ANY($2::text[])
                AND customer_id = $3::text
                AND deleted_at IS NULL
                RETURNING id, type, reference_date
            `;
            
            const result = await client.query(query, [session?.username || 'unknown', transactionIds, customerId]);

            if (result.rows.length === 0) {
                await client.query('ROLLBACK');
                return NextResponse.json({ error: 'No matching transactions found or they were already deleted.' }, { status: 404 });
            }

            // NOTE: Deleting a ledger transaction must NOT affect the Daily Book.
            // The two are fully independent — Daily Book records stay intact.

            // After deleting, recalculate the customer's ledger once
            await recalculateCustomerLedger(customerId, client);

            await client.query('COMMIT');

            await logAudit(request, 'DELETE_RECEIPT_BATCH', `Deleted ${result.rows.length} ledger entries for customer: ${customerId}`);

            // Bust the Vercel edge cache so the frontend instantly gets accurate data
            // @ts-ignore
            revalidateTag('ledger');
            // @ts-ignore
            revalidateTag('customer-daily-entries');
            // @ts-ignore
            revalidateTag('dashboard');
            try {
                revalidatePath('/api/daily-book');
                revalidatePath('/api/daily-book-history');
                revalidatePath('/api/daily-book-history-full');
                revalidatePath('/api/daily-book-init');
            } catch (e) {}

            return NextResponse.json({ success: true, message: 'Transactions successfully deleted and balance recalculated.' });
        } catch (dbError: any) {
            await client.query('ROLLBACK');
            console.error('Database error in batch delete:', dbError);
            throw dbError;
        } finally {
            client.release();
        }
    } catch (error: any) {
        console.error('Error in batch delete route:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
