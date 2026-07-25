import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import pool from '@/lib/db';
import { requireSession } from '@/lib/require-session';

export async function POST(request: Request) {
    const { session, errorResponse } = await requireSession(request);
    if (errorResponse || session?.role !== 'SUPER_ADMIN') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id } = await request.json();
        if (!id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { rows } = await client.query(`SELECT * FROM "PendingApprovals" WHERE id = $1 FOR UPDATE`, [id]);
            if (rows.length === 0 || rows[0].status !== 'PENDING') {
                await client.query('ROLLBACK');
                return NextResponse.json({ error: 'Approval not found or already processed' }, { status: 404 });
            }

            const approval = rows[0];
            const payload = typeof approval.payload === 'string' ? JSON.parse(approval.payload) : approval.payload;

            if (approval.action_type === 'EDIT_PAYMENT') {
                const refDate = payload.reference_date || new Date().toISOString().split('T')[0];
                // Update Ledger
                await client.query(
                    `UPDATE "Ledger" SET amount = $1, kg = $2, price_per_kg = $3, reference_date = $4, edit_count = edit_count + 1 WHERE id = $5`,
                    [payload.amount, payload.kg, payload.price_per_kg, refDate, approval.ledger_id]
                );
            } else if (approval.action_type === 'ADD_LATE_PAYMENT') {
                const refDate = payload.reference_date || new Date().toISOString().split('T')[0];
                // Insert Ledger Payment
                await client.query(
                    `INSERT INTO "Ledger" (id, customer_id, type, amount, reference_date, previous_debt, new_debt) VALUES (gen_random_uuid(), $1, $2, $3, $4, 0, 0)`,
                    [payload.customerId || approval.customer_id, 'PAYMENT', payload.amount, refDate]
                );
            } else if (approval.action_type === 'UNDO_LEDGER') {
                // Soft delete and recalculate
                await client.query(
                    `UPDATE "Ledger" SET deleted_at = NOW(), deleted_by = $1 WHERE id = $2`,
                    [approval.username, approval.ledger_id]
                );
            }

            // ALWAYS recalculate customer ledger for Edit, Add, and Undo!
            const { recalculateCustomerLedger } = await import('@/lib/ledger-utils');
            await recalculateCustomerLedger(approval.customer_id, client);

            await client.query(`UPDATE "PendingApprovals" SET status = 'APPROVED' WHERE id = $1`, [id]);
            await client.query('COMMIT');

            // Instantly destroy Vercel Cache so the Normal Admin sees the change immediately
            // @ts-ignore
            revalidateTag('ledger');
            // @ts-ignore
            revalidateTag('customers');
            // @ts-ignore
            revalidateTag('dashboard');
            // @ts-ignore
            revalidateTag('customer-daily-entries');
            // @ts-ignore
            revalidateTag(`ledger-${approval.customer_id}`);
            // @ts-ignore
            revalidateTag(`daily-entries-${approval.customer_id}`);

            return NextResponse.json({ success: true });
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Approval error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
