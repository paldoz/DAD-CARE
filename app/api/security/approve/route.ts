import { NextResponse } from 'next/server';
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
            const payload = approval.payload;

            if (approval.action_type === 'EDIT_PAYMENT') {
                // Update Ledger
                await client.query(
                    `UPDATE "Ledger" SET amount = $1, kg = $2, price_per_kg = $3, reference_date = $4, edit_count = edit_count + 1 WHERE id = $5`,
                    [payload.amount, payload.kg, payload.price_per_kg, payload.reference_date, approval.ledger_id]
                );
            } else if (approval.action_type === 'ADD_LATE_PAYMENT') {
                // Insert Ledger Payment
                await client.query(
                    `INSERT INTO "Ledger" (customer_id, type, amount, reference_date) VALUES ($1, $2, $3, $4)`,
                    [payload.customerId, 'PAYMENT', payload.amount, payload.reference_date]
                );
            } else if (approval.action_type === 'UNDO_LEDGER') {
                // Soft delete and recalculate
                await client.query(
                    `UPDATE "Ledger" SET deleted_at = NOW(), deleted_by = $1 WHERE id = $2`,
                    [approval.username, approval.ledger_id]
                );
                
                // Recalculate customer ledger inline to avoid import issues or we can just call the util
                const { recalculateCustomerLedger } = await import('@/lib/ledger-utils');
                await recalculateCustomerLedger(approval.customer_id, client);
            }

            await client.query(`UPDATE "PendingApprovals" SET status = 'APPROVED' WHERE id = $1`, [id]);
            await client.query('COMMIT');

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
