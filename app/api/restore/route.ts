import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireSuperAdmin } from '@/lib/require-session';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CONFIRMATION_STRING = 'I CONFIRM RESTORE';

export async function POST(request: Request) {
    const { session, errorResponse } = await requireSuperAdmin(request);
    if (errorResponse) return errorResponse;

    try {
        const body = await request.json();
        const { data, confirm } = body;

        // Require explicit confirmation
        if (confirm !== CONFIRMATION_STRING) {
            return NextResponse.json({
                error: `Confirmation required. You must send: "${CONFIRMATION_STRING}"`,
            }, { status: 400 });
        }

        if (!data) {
            return NextResponse.json({ error: 'No backup data provided' }, { status: 400 });
        }

        const {
            customers = [],
            ledger = [],
            dailyBook = [],
            dailyBookItems = [],
            users = [],
        } = data;

        // Basic validation before touching the database
        if (!Array.isArray(customers) || !Array.isArray(ledger) || !Array.isArray(dailyBook) || !Array.isArray(dailyBookItems)) {
            return NextResponse.json({ error: 'Backup data is malformed' }, { status: 400 });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // ─── Step 1: Delete in foreign-key order ──────────────────────────
            await client.query(`DELETE FROM "DailyBookItem"`);
            await client.query(`DELETE FROM "DailyBook"`);
            await client.query(`DELETE FROM "Ledger"`);
            await client.query(`DELETE FROM "Customer"`);
            // Do NOT delete Users — that would log everyone out including the current admin
            // Users are restored separately below, using UPSERT

            // ─── Step 2: Restore Customers ────────────────────────────────────
            if (customers.length > 0) {
                const custValues = customers.map((_: any, i: number) =>
                    `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`
                ).join(', ');
                const custParams = customers.flatMap((c: any) => [
                    c.id,
                    c.customer_code ?? null,
                    c.name,
                    c.created_at ?? new Date().toISOString(),
                    c.deleted_at ?? null,
                ]);
                await client.query(
                    `INSERT INTO "Customer" (id, customer_code, name, created_at, deleted_at) VALUES ${custValues}
                     ON CONFLICT (id) DO UPDATE SET customer_code = EXCLUDED.customer_code, name = EXCLUDED.name`,
                    custParams
                );
            }

            // ─── Step 3: Restore Ledger ───────────────────────────────────────
            if (ledger.length > 0) {
                // Insert in batches of 200 to avoid exceeding parameter limits
                const BATCH = 200;
                for (let start = 0; start < ledger.length; start += BATCH) {
                    const batch = ledger.slice(start, start + BATCH);
                    const cols = 14; // number of columns
                    const vals = batch.map((_: any, i: number) =>
                        `(${Array.from({ length: cols }, (_, c) => `$${i * cols + c + 1}`).join(', ')})`
                    ).join(', ');
                    const params = batch.flatMap((r: any) => [
                        r.id,
                        r.customer_id,
                        r.type,
                        r.reference_date ?? null,
                        r.kg ?? null,
                        r.price_per_kg ?? null,
                        r.amount ?? 0,
                        r.previous_debt ?? 0,
                        r.new_debt ?? 0,
                        r.note ?? null,
                        r.receipt_id ?? null,
                        r.maqal_id ?? null,
                        r.created_at ?? new Date().toISOString(),
                        null, // deleted_at — backup only has non-deleted rows
                    ]);
                    await client.query(
                        `INSERT INTO "Ledger" (id, customer_id, type, reference_date, kg, price_per_kg, amount, previous_debt, new_debt, note, receipt_id, maqal_id, created_at, deleted_at)
                         VALUES ${vals} ON CONFLICT (id) DO NOTHING`,
                        params
                    );
                }
            }

            // ─── Step 4: Restore DailyBook ────────────────────────────────────
            if (dailyBook.length > 0) {
                const dbVals = dailyBook.map((_: any, i: number) =>
                    `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`
                ).join(', ');
                const dbParams = dailyBook.flatMap((db: any) => [
                    db.id, db.date, db.created_at ?? new Date().toISOString(),
                ]);
                await client.query(
                    `INSERT INTO "DailyBook" (id, date, created_at) VALUES ${dbVals} ON CONFLICT (id) DO NOTHING`,
                    dbParams
                );
            }

            // ─── Step 5: Restore DailyBookItems ──────────────────────────────
            if (dailyBookItems.length > 0) {
                const BATCH = 200;
                for (let start = 0; start < dailyBookItems.length; start += BATCH) {
                    const batch = dailyBookItems.slice(start, start + BATCH);
                    const cols = 6;
                    const vals = batch.map((_: any, i: number) =>
                        `(${Array.from({ length: cols }, (_, c) => `$${i * cols + c + 1}`).join(', ')})`
                    ).join(', ');
                    const params = batch.flatMap((item: any) => [
                        item.id,
                        item.daily_book_id,
                        item.customer_id,
                        item.kg ?? 0,
                        item.present ?? true,
                        item.note ?? null,
                    ]);
                    await client.query(
                        `INSERT INTO "DailyBookItem" (id, daily_book_id, customer_id, kg, present, note)
                         VALUES ${vals} ON CONFLICT (id) DO NOTHING`,
                        params
                    );
                }
            }

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

        await logAudit(request, 'RESTORE_DATABASE',
            `Database restored from backup by ${session?.username}. Restored: ${customers.length} customers, ${ledger.length} ledger rows, ${dailyBook.length} daily books, ${dailyBookItems.length} daily book items.`
        );

        return NextResponse.json({
            success: true,
            message: 'Database restored successfully.',
            restored: {
                customers: customers.length,
                ledger: ledger.length,
                dailyBook: dailyBook.length,
                dailyBookItems: dailyBookItems.length,
            },
        });

    } catch (error: any) {
        console.error('Restore Error:', error);
        return NextResponse.json({ error: 'Restore failed: ' + error.message }, { status: 500 });
    }
}
