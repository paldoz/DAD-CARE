import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/require-session';
import { logAudit } from '@/lib/audit';
import { revalidateTag, revalidatePath } from 'next/cache';
import { recalculateCustomerLedger, calculateMaqalCharge } from '@/lib/ledger-utils';

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { errorResponse, session } = await requireSession(request);
    if (errorResponse) return errorResponse;

    const { id: ledgerId } = await params;
    if (!ledgerId) {
        return NextResponse.json({ error: 'Ledger ID required' }, { status: 400 });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Fetch the ledger entry to verify it exists and get customer_id
        const { rows } = await client.query(
            `SELECT id, customer_id, amount, type, created_at, reference_date FROM "Ledger" WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
            [ledgerId]
        );

        if (rows.length === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Ledger entry not found or already deleted' }, { status: 404 });
        }

        const ledger = rows[0];

        // Rule 1: 24h time limit (Normal admins are strictly blocked. Super Admins bypass this)
        const txTime = new Date(ledger.created_at || ledger.reference_date).getTime();
        const isRecent = (Date.now() - txTime) < 24 * 60 * 60 * 1000;
        if (!isRecent && session.role !== 'SUPER_ADMIN') {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Security: Entries older than 24 hours cannot be undone by normal admins.' }, { status: 403 });
        }

        if (session.role !== 'SUPER_ADMIN') {
            // Rule 2: Priority Customer (Only applies to Regular Admins)
            const { rows: userRows } = await client.query(
                `SELECT assigned_customer_ids FROM "User" WHERE username = $1`,
                [session.username]
            );
            const priorityIds = userRows.length ? (userRows[0].assigned_customer_ids || []) : [];
            if (!priorityIds.includes(ledger.customer_id)) {
                await client.query('ROLLBACK');
                return NextResponse.json({ error: 'Security: You can only undo entries for your assigned priority customers.' }, { status: 403 });
            }
        }



        // Soft delete the ledger entry (Super Admin only)
        await client.query(
            `UPDATE "Ledger" 
             SET deleted_at = NOW(), deleted_by = $1
             WHERE id = $2`,
            [session?.username || 'unknown', ledgerId]
        );

        // The user specifically requested that deleting a Ledger entry MUST NOT delete the Daily Book entry.
        // Recalculate debt for the customer
        await recalculateCustomerLedger(ledger.customer_id, client);

        await client.query('COMMIT');

        await logAudit(request, 'UNDO_LEDGER', `Undid ledger entry ${ledgerId} (Amount: ${ledger.amount}) for customer: ${ledger.customer_id}`);

        // Bust the Vercel edge cache so the frontend instantly gets accurate data
        // @ts-ignore
        revalidateTag('ledger');
        // @ts-ignore
        revalidateTag('customer-daily-entries');
        // @ts-ignore
        revalidateTag('dashboard');
        // @ts-ignore
        revalidateTag('customers');
        try {
            revalidatePath('/api/daily-book');
            revalidatePath('/api/daily-book-history');
            revalidatePath('/api/daily-book-history-full');
            revalidatePath('/api/daily-book-init');
        } catch (e) {}

        return NextResponse.json({ success: true, message: 'Entry successfully undone' });
    } catch (error: any) {
        await client.query('ROLLBACK');
        console.error('Error undoing ledger:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    } finally {
        client.release();
    }
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { session, errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;

    const { id: ledgerId } = await params;
    const body = await request.json();
    const { amount, kg, price_per_kg, note } = body;

    if (!ledgerId) {
        return NextResponse.json({ error: 'Ledger ID required' }, { status: 400 });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            `SELECT id, customer_id, amount, kg, price_per_kg, type, reference_date, edit_count FROM "Ledger" WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
            [ledgerId]
        );

        if (rows.length === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Ledger entry not found or already deleted' }, { status: 404 });
        }

        const ledger = rows[0];
        
        // Rule 1: 24h time limit (Normal admins are strictly blocked. Super Admins bypass this)
        const txTime = new Date(ledger.created_at || ledger.reference_date).getTime();
        const isRecent = (Date.now() - txTime) < 24 * 60 * 60 * 1000;
        if (!isRecent && session.role !== 'SUPER_ADMIN') {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Security: Entries older than 24 hours cannot be edited by normal admins.' }, { status: 403 });
        }
        
        // Security Rule: Priority Customer (Only applies to Regular Admins)
        if (session.role !== 'SUPER_ADMIN') {
            const { rows: userRows } = await client.query(
                `SELECT assigned_customer_ids FROM "User" WHERE username = $1`,
                [session.username]
            );
            const priorityIds = userRows.length ? (userRows[0].assigned_customer_ids || []) : [];
            if (!priorityIds.includes(ledger.customer_id)) {
                await client.query('ROLLBACK');
                return NextResponse.json({ error: 'Security: You can only edit entries for your assigned priority customers.' }, { status: 403 });
            }
        }
        
        // Check edit count limit (3 times max)
        const currentEditCount = ledger.edit_count || 0;
        // Super Admins bypass the edit limit
        if (session.role !== 'SUPER_ADMIN' && currentEditCount >= 3) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Edit limit reached. You can only edit an entry 3 times.' }, { status: 403 });
        }

        const newKg = kg !== undefined ? parseFloat(kg) : ledger.kg;
        const newPrice = price_per_kg !== undefined ? parseFloat(price_per_kg) : ledger.price_per_kg;
        const newRefDate = body.reference_date || ledger.reference_date;
        const newNote = note !== undefined ? note : ledger.note;

        // FLOOR rule: PRODUCT Maqal charge = Math.floor(kg × price), fractional dollar is forgiven.
        // PAYMENT/ADJUSTMENT amounts are kept exact (toFixed(2)).
        let newAmount: number;
        if (ledger.type === 'PRODUCT') {
            newAmount = calculateMaqalCharge(newKg, newPrice);
        } else {
            newAmount = amount !== undefined ? Number(parseFloat(amount).toFixed(2)) : Number(ledger.amount);
        }

        // Update the ledger entry (Super Admin only)
        await client.query(
            `UPDATE "Ledger"
             SET amount = $1, kg = $2, price_per_kg = $3, reference_date = $4, note = $5, edit_count = edit_count + 1
             WHERE id = $6`,
            [newAmount, newKg, newPrice, newRefDate, newNote, ledgerId]
        );

        // If it's a PRODUCT entry, attempt to update the DailyBookItem as well
        if (ledger.type === 'PRODUCT' && newKg !== ledger.kg && ledger.reference_date) {
            // Find corresponding DailyBookItem for this customer on this date
            await client.query(
                `UPDATE "DailyBookItem" dbi
                 SET kg = $1
                 FROM "DailyBook" db
                 WHERE dbi.daily_book_id = db.id 
                 AND dbi.customer_id = $2 
                 AND db.date = $3
                 AND dbi.deleted_at IS NULL`,
                [newKg, ledger.customer_id, ledger.reference_date]
            );
        }

        // Recalculate debt for the customer
        await recalculateCustomerLedger(ledger.customer_id, client);

        await client.query('COMMIT');

        await logAudit(request, 'EDIT_LEDGER', `Edited ledger entry ${ledgerId} (New Amount: ${newAmount}) for customer: ${ledger.customer_id}`);

        // Bust the Vercel edge cache so the frontend instantly gets accurate data
        // @ts-ignore
        revalidateTag('ledger');
        // @ts-ignore
        revalidateTag('dashboard');
        // @ts-ignore
        revalidateTag('customers');

        return NextResponse.json({ 
            success: true, 
            message: 'Entry successfully updated', 
            remaining_edits: 1 - currentEditCount 
        });
    } catch (error: any) {
        await client.query('ROLLBACK');
        console.error('Error editing ledger:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    } finally {
        client.release();
    }
}
