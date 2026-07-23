import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit';
import { requireSession } from '@/lib/require-session';
import { revalidatePath, revalidateTag } from 'next/cache';
import { trackApiRoute } from '@/lib/egress-tracker';
import { z } from 'zod';

const reorderSchema = z.object({
    customerId: z.string().min(1),
    targetCode: z.string().min(1).regex(/^\d+$/, 'Target ID must be a number'),
});

export const POST = trackApiRoute('/api/customers/reorder', async (request: Request) => {
    const { session, errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;

    if (session.role !== 'SUPER_ADMIN') {
        return NextResponse.json({ error: 'Only Super Admin can reorder customers' }, { status: 403 });
    }

    try {
        const body = await request.json();
        const result = reorderSchema.safeParse(body);
        if (!result.success) {
            return NextResponse.json({ error: result.error.issues[0].message }, { status: 400 });
        }

        const { customerId, targetCode } = result.data;
        const targetInt = parseInt(targetCode, 10);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Get current customer
            const { rows: currentRows } = await client.query(
                'SELECT customer_code FROM "Customer" WHERE id = $1 FOR UPDATE',
                [customerId]
            );
            if (currentRows.length === 0) {
                throw new Error('Customer not found');
            }

            const currentCode = currentRows[0].customer_code;
            
            // If it's already the target, do nothing
            if (currentCode === targetCode) {
                await client.query('ROLLBACK');
                return NextResponse.json({ success: true });
            }

            // Ensure the current code is numeric (so we don't accidentally shift text-based codes)
            if (!/^\d+$/.test(currentCode)) {
                throw new Error('Cannot automatically shift a customer with a non-numeric ID');
            }

            const currentInt = parseInt(currentCode, 10);

            // 2. Move current customer to a temporary ID to prevent UNIQUE constraint violations
            const tempCode = `temp_swap_${Date.now()}_${Math.random()}`;
            await client.query(
                'UPDATE "Customer" SET customer_code = $1 WHERE id = $2',
                [tempCode, customerId]
            );

            // 3. Perform the cascading shift
            // Using reverse sorting when pushing up IDs to avoid duplicate key violations during the update loop. 
            // Wait, Postgres handles unique constraints at the end of the statement or row by row? 
            // Postgres updates row by row, so if a unique constraint is deferred, it's fine.
            // But if it's NOT deferred, we could hit unique violations if we shift 19->20 when 20 already exists.
            // Actually, in PostgreSQL, a single UPDATE statement handles unique constraints gracefully if evaluated as a single command, BUT sometimes it can throw.
            // The safest is to update them conditionally or set unique constraint to deferrable. 
            // Wait, the easiest workaround for unique index conflicts in a single UPDATE in postgres is often fine if the index isn't deferred, but sometimes it throws "duplicate key value".
            // Let's use a temporary negative ID shift first!
            
            if (targetInt < currentInt) {
                // Moving UP (e.g. 53 -> 19)
                // Everyone between 19 and 52 needs +1
                // Shift to temporary negative to avoid conflicts:
                await client.query(`
                    UPDATE "Customer"
                    SET customer_code = (-(customer_code::int + 1))::text
                    WHERE customer_code ~ '^\\d+$' 
                    AND customer_code::int >= $1 
                    AND customer_code::int < $2
                `, [targetInt, currentInt]);
            } else {
                // Moving DOWN (e.g. 19 -> 53)
                // Everyone between 20 and 53 needs -1
                await client.query(`
                    UPDATE "Customer"
                    SET customer_code = (-(customer_code::int - 1))::text
                    WHERE customer_code ~ '^\\d+$' 
                    AND customer_code::int <= $1 
                    AND customer_code::int > $2
                `, [targetInt, currentInt]);
            }
            
            // Now flip the negative IDs back to positive
            await client.query(`
                UPDATE "Customer"
                SET customer_code = ABS(customer_code::int)::text
                WHERE customer_code ~ '^-\\d+$'
            `);

            // 4. Assign the target ID to our customer
            await client.query(
                'UPDATE "Customer" SET customer_code = $1 WHERE id = $2',
                [targetInt.toString(), customerId]
            );

            await client.query('COMMIT');
            await logAudit(request, 'REORDER_CUSTOMER', `Reordered customer from ID ${currentCode} to ${targetCode}`);
            
            // Revalidate caches to refresh UI instantly
            revalidatePath('/api/customers');
            revalidatePath('/api/daily-book-init');
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
        console.error('Reorder Customer Error:', error);
        return NextResponse.json({ error: error.message || 'Failed to reorder customer' }, { status: 500 });
    }
});
