import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit';
import { requireSession } from '@/lib/require-session';
import { revalidatePath, revalidateTag } from 'next/cache';
import { trackApiRoute } from '@/lib/egress-tracker';
import { z } from 'zod';

const toggleSchema = z.object({
    customerId: z.string().min(1),
    field: z.enum(['is_unassignable', 'is_kabarka']),
    value: z.boolean(),
});

export const POST = trackApiRoute('/api/customers/toggle-status', async (request: Request) => {
    const { session, errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;

    if (session.role !== 'SUPER_ADMIN') {
        return NextResponse.json({ error: 'Only Super Admin can toggle customer statuses' }, { status: 403 });
    }

    try {
        const body = await request.json();
        const result = toggleSchema.safeParse(body);
        if (!result.success) {
            return NextResponse.json({ error: result.error.issues[0].message }, { status: 400 });
        }

        const { customerId, field, value } = result.data;

        const client = await pool.connect();
        try {
            // Auto-migrate columns if they don't exist
            try {
                await client.query('ALTER TABLE "Customer" ADD COLUMN is_unassignable BOOLEAN DEFAULT false');
                await client.query('ALTER TABLE "Customer" ADD COLUMN is_kabarka BOOLEAN DEFAULT false');
            } catch (e) {
                // Ignore if they already exist
            }

            await client.query('BEGIN');

            const { rowCount } = await client.query(
                `UPDATE "Customer" SET ${field} = $1 WHERE id = $2 RETURNING id`,
                [value, customerId]
            );

            if (rowCount === 0) {
                throw new Error('Customer not found');
            }

            await client.query('COMMIT');
            await logAudit(request, 'UPDATE_CUSTOMER', `Toggled ${field} to ${value} for customer ${customerId}`);
            
            // Revalidate caches
            revalidatePath('/api/customers');
            revalidatePath('/api/dashboard');
            // @ts-ignore
            revalidateTag('customers');
            // @ts-ignore
            revalidateTag('dashboard');
            
            return NextResponse.json({ success: true });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error: any) {
        console.error('Toggle Customer Status Error:', error);
        return NextResponse.json({ error: error.message || 'Failed to toggle status' }, { status: 500 });
    }
});
