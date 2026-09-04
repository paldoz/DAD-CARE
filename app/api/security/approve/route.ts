import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import pool from '@/lib/db';
import { requireSession } from '@/lib/require-session';
import { resolveMaqalFromDate } from '@/lib/maqal-utils';

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
                const customerId = payload.customerId || approval.customer_id;
                if (!customerId || typeof customerId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customerId.trim())) {
                    await client.query('ROLLBACK');
                    return NextResponse.json({ error: 'Security: Invalid customer ID format' }, { status: 400 });
                }

                // Verify customer exists
                const { rows: custCheck } = await client.query(`SELECT id FROM "Customer" WHERE id = $1 AND deleted_at IS NULL`, [customerId]);
                if (custCheck.length === 0) {
                    await client.query('ROLLBACK');
                    return NextResponse.json({ error: 'Security: Customer not found' }, { status: 404 });
                }

                const refDate = payload.reference_date ? String(payload.reference_date).split('T')[0] : new Date().toISOString().split('T')[0];
                let authoritative_maqal_id: number;

                if (payload.receipt_id) {
                    const { rows: existingLedger } = await client.query(
                        `SELECT type, maqal_id, customer_id FROM "Ledger"
                         WHERE receipt_id = $1 AND deleted_at IS NULL`,
                        [payload.receipt_id]
                    );
                    if (existingLedger.length === 0) {
                        await client.query('ROLLBACK');
                        return NextResponse.json({ error: `Security: Receipt ${payload.receipt_id} does not exist.` }, { status: 400 });
                    }
                    const products = existingLedger.filter((r: any) => r.type === 'PRODUCT');
                    if (products.length === 0) {
                        await client.query('ROLLBACK');
                        return NextResponse.json({ error: `Security: Receipt ${payload.receipt_id} contains no active products.` }, { status: 400 });
                    }
                    if (products[0].customer_id !== customerId) {
                        await client.query('ROLLBACK');
                        return NextResponse.json({ error: 'Customer Isolation Error: Receipt belongs to a different customer.' }, { status: 400 });
                    }
                    if (products[0].maqal_id == null) {
                        await client.query('ROLLBACK');
                        return NextResponse.json({ error: `Security: Receipt ${payload.receipt_id} has no valid maqal_id.` }, { status: 400 });
                    }
                    authoritative_maqal_id = Number(products[0].maqal_id);
                } else {
                    const resolved = await resolveMaqalFromDate(refDate, client);
                    if (!resolved) {
                        await client.query('ROLLBACK');
                        return NextResponse.json({ error: `Security: Could not resolve authoritative Maqal for reference date ${refDate}.` }, { status: 400 });
                    }
                    authoritative_maqal_id = resolved.maqal_id;
                }

                // Insert Ledger Payment with verified authoritative values
                await client.query(
                    `INSERT INTO "Ledger" (id, customer_id, type, amount, reference_date, previous_debt, new_debt, maqal_id, receipt_id) VALUES (gen_random_uuid(), $1, $2, $3, $4, 0, 0, $5, $6)`,
                    [customerId, 'PAYMENT', payload.amount, refDate, authoritative_maqal_id, payload.receipt_id || null]
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
