import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/require-session';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/resequence-customers
 * Re-assigns customer_code values sequentially (1, 2, 3, ...) sorted by the
 * current numeric value of customer_code (ignoring any non-numeric prefix/space).
 * Only accessible by SUPER_ADMIN.
 */
export async function POST(request: Request) {
    const { session, errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;
    if (session?.role !== 'SUPER_ADMIN' && session?.role !== 'ADMIN') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 0. Free up codes from soft-deleted customers to avoid UNIQUE constraint conflicts
        await client.query(`
            UPDATE "Customer"
            SET customer_code = 'del_' || id
            WHERE deleted_at IS NOT NULL AND customer_code NOT LIKE 'del_%'
        `);

        // 1. Get all ACTIVE customers sorted by their ORIGINAL creation date
        // This ensures resequence always restores the original order customers were added
        const { rows } = await client.query(`
            SELECT id, name, customer_code, created_at
            FROM "Customer"
            WHERE deleted_at IS NULL
            ORDER BY created_at ASC, id ASC
        `);

        if (rows.length === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ message: 'No customers found', updated: 0 });
        }

        // 2. Temporarily set all customer_codes to a negative temp value to avoid unique constraint conflicts
        await client.query(`
            UPDATE "Customer"
            SET customer_code = '-' || id
            WHERE deleted_at IS NULL
        `);

        // 3. Assign sequential codes 1, 2, 3, ... to EVERYONE
        let updated = 0;
        const changes: { id: string; oldCode: string; newCode: string }[] = [];
        
        const idsToUpdate: string[] = [];
        const newCodesToUpdate: string[] = [];

        for (let i = 0; i < rows.length; i++) {
            const newCode = String(i + 1);
            changes.push({ id: rows[i].id, oldCode: rows[i].customer_code, newCode });
            idsToUpdate.push(rows[i].id);
            newCodesToUpdate.push(newCode);
            updated++;
        }

        if (idsToUpdate.length > 0) {
            await client.query(`
                UPDATE "Customer" AS c
                SET customer_code = data.new_code
                FROM (
                    SELECT unnest($1::text[]) AS id, unnest($2::text[]) AS new_code
                ) AS data
                WHERE c.id = data.id
            `, [idsToUpdate, newCodesToUpdate]);
        }

        await client.query('COMMIT');

        // 4. Log the operation
        await logAudit(
            request,
            'RESEQUENCE_CUSTOMERS',
            `Re-sequenced ${updated} customer codes. ${changes.length} codes changed.`
        );

        return NextResponse.json({
            message: `Successfully re-sequenced ${updated} customers.`,
            updated,
            changes,
        });
    } catch (error: any) {
        await client.query('ROLLBACK');
        console.error('Resequence error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    } finally {
        client.release();
    }
}
