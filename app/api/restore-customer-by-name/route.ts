import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/require-session';
import { logAudit } from '@/lib/audit';
import { revalidatePath, revalidateTag } from 'next/cache';
import { trackApiRoute } from '@/lib/egress-tracker';

export const dynamic = 'force-dynamic';

/**
 * POST /api/restore-customer-by-name
 * Restores a soft-deleted customer by name.
 * Only accessible by SUPER_ADMIN.
 * Does NOT renumber/resequence any IDs - just clears deleted_at.
 */
export const POST = trackApiRoute('/api/restore-customer-by-name', async (request: Request) => {
    const { session, errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;
    if (session?.role !== 'SUPER_ADMIN') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let name: string;
    try {
        const body = await request.json();
        name = (body.name || '').trim();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!name) {
        return NextResponse.json({ error: 'Customer name is required' }, { status: 400 });
    }

    try {
        // Find the deleted customer by name (case-insensitive)
        const { rows: found } = await pool.query(
            `SELECT id, name, customer_code, deleted_at FROM "Customer"
             WHERE name ILIKE $1 AND deleted_at IS NOT NULL
             ORDER BY deleted_at DESC LIMIT 1`,
            [`%${name}%`]
        );

        if (found.length === 0) {
            return NextResponse.json({
                error: `No inactive/deleted customer found matching "${name}". They may already be active or the name is incorrect.`
            }, { status: 404 });
        }

        const customer = found[0];

        // Fix the customer_code if it was corrupted with del_ prefix or UUID
        let newCode = customer.customer_code;
        if (newCode.startsWith('del_') || newCode.length > 10) {
            // Assign them a new code at the end
            const { rows: codeRow } = await pool.query(`
                SELECT COALESCE(MAX(customer_code::int), 0) + 1 as next_code
                FROM "Customer"
                WHERE deleted_at IS NULL 
                  AND customer_code ~ '^[0-9]+$'
                  AND LENGTH(customer_code) < 8
            `);
            newCode = String(codeRow[0].next_code);
        }

        // Restore the customer
        await pool.query(
            `UPDATE "Customer"
             SET deleted_at = NULL, customer_code = $1
             WHERE id = $2`,
            [newCode, customer.id]
        );

        await logAudit(request, 'RESTORE_CUSTOMER_BY_NAME',
            `Restored customer "${customer.name}" (ID: ${customer.id}, Code: ${newCode})`
        );

        // Bust caches
        revalidatePath('/api/customers');
        revalidatePath('/api/daily-book-init');
        // @ts-ignore
        revalidateTag('customers');
        // @ts-ignore
        revalidateTag('dashboard');

        return NextResponse.json({
            success: true,
            message: `Customer "${customer.name}" restored successfully! Their ID number is #${newCode}.`,
            customer: {
                id: customer.id,
                name: customer.name,
                customer_code: newCode,
            }
        });
    } catch (error: any) {
        console.error('Restore Customer Error:', error);
        return NextResponse.json({ error: error.message || 'Failed to restore' }, { status: 500 });
    }
});
