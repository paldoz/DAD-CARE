import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireSession } from '@/lib/require-session';
import { trackApiRoute } from '@/lib/egress-tracker';
import { logAuditDirect } from '@/lib/audit';

export interface CustomerNoteStatusRecord {
    customer_id: string;
    priority_enabled: boolean;
    busy_enabled: boolean;
    note: string;
    updated_at: string;
    updated_by: string | null;
}

/**
 * GET /api/customer-note-status
 * Fetches all active customer notes and statuses.
 * Decoupled from financial ledger: zero impact on ledger, payments, or customer balances.
 */
export const GET = trackApiRoute('/api/customer-note-status', async (request: Request) => {
    const { errorResponse, session } = await requireSession(request);
    if (errorResponse) return errorResponse;

    if (session.role !== 'SUPER_ADMIN' && session.role !== 'ADMIN') {
        return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    try {
        const query = `
            SELECT 
                customer_id, 
                priority_enabled, 
                busy_enabled, 
                COALESCE(note, '') AS note, 
                updated_at, 
                updated_by 
            FROM "CustomerNoteStatus"
            WHERE priority_enabled = TRUE OR busy_enabled = TRUE OR (note IS NOT NULL AND note != '')
        `;

        const { rows } = await pool.query(query);

        // Convert rows to an ID-indexed lookup map for O(1) client access
        const statuses: Record<string, CustomerNoteStatusRecord> = {};
        for (const row of rows) {
            statuses[row.customer_id] = {
                customer_id: row.customer_id,
                priority_enabled: Boolean(row.priority_enabled),
                busy_enabled: Boolean(row.busy_enabled),
                note: row.note || '',
                updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
                updated_by: row.updated_by || null,
            };
        }

        const res = NextResponse.json({ statuses });
        // Prevent stale caches while avoiding polling
        res.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        return res;
    } catch (error: unknown) {
        const err = error as { code?: string; message?: string };
        // Graceful fallback if table does not exist yet before migration is applied
        if (err.code === '42P01') {
            console.warn('[CustomerNoteStatus] Table does not exist yet. Returning empty map.');
            return NextResponse.json({ statuses: {}, tablePendingMigration: true });
        }
        console.error('[CustomerNoteStatus GET Error]', error);
        return NextResponse.json({ error: err.message || 'Database error' }, { status: 500 });
    }
});

/**
 * POST /api/customer-note-status
 * Upserts a customer note and priority/busy status.
 * Body: { customerId: string, priorityEnabled: boolean, busyEnabled: boolean, note: string }
 */
export const POST = trackApiRoute('/api/customer-note-status', async (request: Request) => {
    const { errorResponse, session } = await requireSession(request);
    if (errorResponse) return errorResponse;

    if (session.role !== 'SUPER_ADMIN' && session.role !== 'ADMIN') {
        return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    try {
        const body = await request.json();
        const { customerId, priorityEnabled, busyEnabled, note } = body;

        if (!customerId || typeof customerId !== 'string') {
            return NextResponse.json({ error: 'Valid customerId is required' }, { status: 400 });
        }

        const cleanPriority = Boolean(priorityEnabled);
        const cleanBusy = Boolean(busyEnabled);
        const cleanNote = typeof note === 'string' ? note.trim().slice(0, 500) : '';

        // If everything is cleared/false, remove the row to keep database lean
        if (!cleanPriority && !cleanBusy && cleanNote === '') {
            await pool.query(
                `DELETE FROM "CustomerNoteStatus" WHERE customer_id = $1`,
                [customerId]
            );
            return NextResponse.json({
                success: true,
                customerId,
                cleared: true,
                status: null,
            });
        }

        const updatedBy = session.username || session.userId || 'Admin';

        const upsertQuery = `
            INSERT INTO "CustomerNoteStatus" (
                customer_id, 
                priority_enabled, 
                busy_enabled, 
                note, 
                updated_at, 
                updated_by
            )
            VALUES ($1, $2, $3, $4, NOW(), $5)
            ON CONFLICT (customer_id) 
            DO UPDATE SET 
                priority_enabled = EXCLUDED.priority_enabled,
                busy_enabled = EXCLUDED.busy_enabled,
                note = EXCLUDED.note,
                updated_at = NOW(),
                updated_by = EXCLUDED.updated_by
            RETURNING customer_id, priority_enabled, busy_enabled, note, updated_at, updated_by;
        `;

        const { rows } = await pool.query(upsertQuery, [
            customerId,
            cleanPriority,
            cleanBusy,
            cleanNote,
            updatedBy,
        ]);

        const record: CustomerNoteStatusRecord = {
            customer_id: rows[0].customer_id,
            priority_enabled: Boolean(rows[0].priority_enabled),
            busy_enabled: Boolean(rows[0].busy_enabled),
            note: rows[0].note || '',
            updated_at: new Date(rows[0].updated_at).toISOString(),
            updated_by: rows[0].updated_by || null,
        };

        return NextResponse.json({ success: true, status: record });
    } catch (error: unknown) {
        const err = error as { code?: string; message?: string };
        if (err.code === '42P01') {
            return NextResponse.json(
                { error: 'CustomerNoteStatus table does not exist. Please apply the migration first.' },
                { status: 503 }
            );
        }
        console.error('[CustomerNoteStatus POST Error]', error);
        return NextResponse.json({ error: err.message || 'Database error' }, { status: 500 });
    }
});

/**
 * DELETE /api/customer-note-status
 * Supports:
 *   1. Single customer clear: ?customerId=...
 *   2. Bulk clear all: ?all=true&confirm=CONFIRM_CLEAR_ALL
 * 
 * SAFEGUARDS:
 * - Requires explicit confirmation token for bulk clear.
 * - Operates EXCLUSIVELY on "CustomerNoteStatus" table.
 * - Never touches Customer, Ledger, DailyBook, or accounting data.
 */
export const DELETE = trackApiRoute('/api/customer-note-status', async (request: Request) => {
    const { errorResponse, session } = await requireSession(request);
    if (errorResponse) return errorResponse;

    if (session.role !== 'SUPER_ADMIN' && session.role !== 'ADMIN') {
        return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    try {
        const url = new URL(request.url);
        const customerId = url.searchParams.get('customerId');
        const clearAll = url.searchParams.get('all') === 'true';
        const confirmToken = url.searchParams.get('confirm');

        // SAFEGUARD: Bulk clear all notes STRICTLY requires SUPER_ADMIN role
        if (clearAll) {
            if (session.role !== 'SUPER_ADMIN') {
                return NextResponse.json(
                    { error: 'Forbidden: Only SUPER_ADMIN can execute Clear All' },
                    { status: 403 }
                );
            }

            if (confirmToken !== 'CONFIRM_CLEAR_ALL') {
                return NextResponse.json(
                    { error: 'Explicit confirmation required. Provide confirm=CONFIRM_CLEAR_ALL to proceed.' },
                    { status: 400 }
                );
            }

            // Strictly deletes ONLY from "CustomerNoteStatus"
            const result = await pool.query(`DELETE FROM "CustomerNoteStatus"`);
            const deletedCount = result.rowCount || 0;

            // Audit log the bulk clearing
            await logAuditDirect({
                username: session.username || 'ADMIN',
                role: session.role || 'ADMIN',
                action: 'CLEAR_ALL_CUSTOMER_NOTES',
                details: `Admin ${session.username} cleared all customer notes/statuses (${deletedCount} records removed from CustomerNoteStatus). Financial data unaffected.`
            }).catch(console.error);

            return NextResponse.json({
                success: true,
                clearedAll: true,
                count: deletedCount,
                message: `Successfully cleared ${deletedCount} customer note/status records.`,
            });
        }

        // Single customer clear
        if (!customerId) {
            return NextResponse.json(
                { error: 'Missing customerId or all=true parameter' },
                { status: 400 }
            );
        }

        const result = await pool.query(
            `DELETE FROM "CustomerNoteStatus" WHERE customer_id = $1`,
            [customerId]
        );

        return NextResponse.json({
            success: true,
            customerId,
            cleared: true,
            affectedRows: result.rowCount || 0,
        });
    } catch (error: unknown) {
        const err = error as { code?: string; message?: string };
        if (err.code === '42P01') {
            return NextResponse.json(
                { error: 'CustomerNoteStatus table does not exist. Please apply the migration first.' },
                { status: 503 }
            );
        }
        console.error('[CustomerNoteStatus DELETE Error]', error);
        return NextResponse.json({ error: err.message || 'Database error' }, { status: 500 });
    }
});
