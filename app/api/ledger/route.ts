import { NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit';
import { requireSession } from '@/lib/require-session';
import { revalidateTag, revalidatePath, unstable_cache } from 'next/cache';
import pool from '@/lib/db';
import { trackApiRoute } from '@/lib/egress-tracker';
import { rateLimitResponse } from '@/lib/rate-limit';
import { z } from 'zod';

// ── Zod Schemas ────────────────────────────────────────────────────────────
const LedgerItemSchema = z.object({
    type: z.enum(['PRODUCT', 'PAYMENT', 'ADJUSTMENT']),
    date: z.string().optional(),
    kg: z.union([z.string(), z.number()]).optional(),
    price: z.union([z.string(), z.number()]).optional(),
    amount: z.union([z.string(), z.number()]).optional(),
    note: z.string().max(500).nullable().optional(),
    receipt_id: z.string().uuid().nullable().optional(),
});

const LedgerBatchSchema = z.object({
    customerId: z.string().uuid('Invalid customer ID'),
    items: z.array(LedgerItemSchema).min(1, 'At least one item is required').max(50),
    receipt_id: z.string().uuid().nullable().optional(),
});

const LedgerSingleSchema = LedgerItemSchema.extend({
    customerId: z.string().uuid('Invalid customer ID'),
    receipt_id: z.string().uuid().nullable().optional(),
});

export const POST = trackApiRoute('/api/ledger', async (request: Request) => {
    const { errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;

    // Rate limit: max 10 write requests per 10 seconds per IP
    const limited = rateLimitResponse(request, 10, 10_000);
    if (limited) return limited;

    try {
        const body = await request.json();
        const { items, customerId: customerIdBatch } = body;

        // Support both single entry and batch (items array)
        const isBatch = Array.isArray(items);

        // ── Zod validation ──────────────────────────────────────────────────
        if (isBatch) {
            const parsed = LedgerBatchSchema.safeParse(body);
            if (!parsed.success) {
                return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
            }
        } else {
            const parsed = LedgerSingleSchema.safeParse(body);
            if (!parsed.success) {
                return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
            }
        }

        const customerId = isBatch ? customerIdBatch : body.customerId;
        const receipt_id = body.receipt_id || (isBatch ? crypto.randomUUID() : null);
        const maqal_id = body.maqal_id || null;

        if (!customerId) throw new Error('Customer ID is required');

        const client = await pool.connect();
        let runningDebt = 0;
        let customerName = '';
        let entriesToInsert: any[] = [];

        try {
            await client.query('BEGIN');

            // 1. Verify customer and acquire row lock
            const { rows: customers } = await client.query(
                `SELECT name FROM "Customer" WHERE id = $1 FOR UPDATE`,
                [customerId]
            );
            if (customers.length === 0) throw new Error('Customer not found');
            customerName = customers[0].name;

            // 2. GET CURRENT LATEST DEBT (Atomic start point)
            const { rows: lastEntries } = await client.query(
                `SELECT new_debt FROM "Ledger" 
                 WHERE customer_id = $1 AND deleted_at IS NULL 
                 ORDER BY created_at DESC, id DESC LIMIT 1`,
                [customerId]
            );
            
            runningDebt = lastEntries[0]?.new_debt ? parseFloat(lastEntries[0].new_debt) : 0;

            // 3. PROCESS ENTRIES
            entriesToInsert = [];
            let entriesToProcess = isBatch ? items : [body];

            // Re-order so Payments are processed FIRST
            // This ensures they apply to the old debt before new product debt is added,
            // and allows the frontend to group them backward into the previous receipt.
            entriesToProcess = [...entriesToProcess].sort((a, b) => {
                if (a.type === 'PAYMENT' && b.type !== 'PAYMENT') return -1;
                if (a.type !== 'PAYMENT' && b.type === 'PAYMENT') return 1;
                return 0;
            });

            const hasReset = entriesToProcess.some((item: any) => {
                const lowerNote = (item.note || '').toLowerCase();
                return item.type === 'ADJUSTMENT' && (lowerNote.includes('setup') || lowerNote.includes('initial') || lowerNote.includes('reesto'));
            });

            if (hasReset) {
                runningDebt = 0;
            }

            const productDates = entriesToProcess
                .filter((e: any) => e.type === 'PRODUCT' && e.date)
                .map((e: any) => e.date);

            const existingProductDates = new Set<string>();
            if (productDates.length > 0) {
                const { rows: existing } = await client.query(
                    `SELECT reference_date::text FROM "Ledger" WHERE customer_id = $1 AND type = 'PRODUCT' AND reference_date = ANY($2::date[]) AND deleted_at IS NULL`,
                    [customerId, productDates]
                );
                existing.forEach(r => existingProductDates.add(r.reference_date.split('T')[0])); // normalize date string
            }

            const now = new Date();
            for (let i = 0; i < entriesToProcess.length; i++) {
                const item = entriesToProcess[i];
                const { type, date, kg, price, amount, note } = item;

                if (type === 'PRODUCT' && date) {
                    if (existingProductDates.has(date)) {
                        throw new Error(`Product entry already exists for ${date}`);
                    }
                }

                let entryAmount = 0;
                const prevDebt = runningDebt;

                if (type === 'PRODUCT') {
                    entryAmount = Math.round(parseFloat(kg) * parseFloat(price));
                    runningDebt = Math.round(runningDebt + entryAmount);
                } else if (type === 'PAYMENT') {
                    entryAmount = Math.round(parseFloat(amount));
                    runningDebt = Math.round(runningDebt - entryAmount);
                } else if (type === 'ADJUSTMENT') {
                    entryAmount = Math.round(parseFloat(amount));
                    const lowerNote = (note || '').toLowerCase();
                    runningDebt = Math.round(runningDebt + entryAmount);
                }

                entriesToInsert.push({
                    customer_id: customerId,
                    type: type,
                    reference_date: date || new Date().toISOString().split('T')[0],
                    kg: type === 'PRODUCT' ? parseFloat(kg) : null,
                    price_per_kg: type === 'PRODUCT' ? parseFloat(price) : null,
                    amount: entryAmount,
                    previous_debt: prevDebt,
                    new_debt: runningDebt,
                    note: note || body.note || null,
                    receipt_id: receipt_id,
                    maqal_id: maqal_id,
                    created_at: new Date(now.getTime() + (i * 1000)).toISOString()
                });
            }

            // 4. BULK INSERT
            if (entriesToInsert.length > 0) {
                await client.query(
                    `INSERT INTO "Ledger" (id, customer_id, type, reference_date, kg, price_per_kg, amount, previous_debt, new_debt, note, receipt_id, maqal_id, created_at)
                     SELECT gen_random_uuid(), * FROM UNNEST($1::text[], $2::"LedgerType"[], $3::date[], $4::float8[], $5::float8[], $6::float8[], $7::float8[], $8::float8[], $9::text[], $10::text[], $11::integer[], $12::timestamp[])`,
                    [
                        entriesToInsert.map(e => e.customer_id),
                        entriesToInsert.map(e => e.type),
                        entriesToInsert.map(e => e.reference_date),
                        entriesToInsert.map(e => e.kg),
                        entriesToInsert.map(e => e.price_per_kg),
                        entriesToInsert.map(e => e.amount),
                        entriesToInsert.map(e => e.previous_debt),
                        entriesToInsert.map(e => e.new_debt),
                        entriesToInsert.map(e => e.note),
                        entriesToInsert.map(e => e.receipt_id),
                        entriesToInsert.map(e => e.maqal_id),
                        entriesToInsert.map(e => e.created_at),
                    ]
                );
            }


            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

        // Fire-and-forget audit log — don't block the response
        logAudit(request, 'ADD_LEDGER_ENTRIES', `Added receipt with new debt ${runningDebt} for customer ${customerName}`).catch(() => {});

        try {
            // @ts-ignore
            revalidateTag(`ledger-${customerId}`); // Only bust this specific customer's ledger
            // @ts-ignore
            revalidateTag(`daily-entries-${customerId}`); // Bust specific customer's daily entries
            // @ts-ignore
            revalidateTag('dashboard'); // Dashboard is aggregated, so we must bust it
            revalidatePath('/api/ledger-by-date');
        } catch (cacheErr) {
            console.error('Failed to revalidate cache:', cacheErr);
        }

        let customerStatus = { unprocessed_books_count: 0, is_target_days_done: true };
        try {
            const { rows: statusRows } = await pool.query(`
                WITH prev_pair AS (
                    SELECT
                        ('2026-06-28'::date + (
                            ((NOW() AT TIME ZONE 'Africa/Mogadishu')::date - '2026-06-28'::date) / 2 * 2 - 2
                        )::int * '1 day'::interval)::date AS date1,
                        ('2026-06-28'::date + (
                            ((NOW() AT TIME ZONE 'Africa/Mogadishu')::date - '2026-06-28'::date) / 2 * 2 - 1
                        )::int * '1 day'::interval)::date AS date2
                )
                SELECT
                    CASE WHEN ROUND(COALESCE(dbk.total_daily_kg, 0)::numeric, 2) > ROUND(COALESCE(lk.total_ledger_kg, 0)::numeric, 2) THEN 1 ELSE 0 END as unprocessed_books_count,
                    CASE
                        WHEN COALESCE(td.prev_pair_ledger_count, 0) >= 2 THEN true
                        WHEN (c.created_at AT TIME ZONE 'Africa/Mogadishu')::date > (SELECT date2 FROM prev_pair) THEN true
                        ELSE false
                    END as is_target_days_done
                FROM "Customer" c
                LEFT JOIN (
                    SELECT customer_id, SUM(kg) as total_daily_kg
                    FROM "DailyBookItem" WHERE customer_id = $1 AND kg > 0 AND deleted_at IS NULL GROUP BY customer_id
                ) dbk ON c.id = dbk.customer_id
                LEFT JOIN (
                    SELECT customer_id, SUM(kg) as total_ledger_kg
                    FROM "Ledger" WHERE customer_id = $1 AND type = 'PRODUCT' AND deleted_at IS NULL GROUP BY customer_id
                ) lk ON c.id = lk.customer_id
                LEFT JOIN (
                    SELECT customer_id,
                        COUNT(DISTINCT COALESCE((reference_date AT TIME ZONE 'Africa/Mogadishu')::date, (created_at AT TIME ZONE 'Africa/Mogadishu')::date)) as prev_pair_ledger_count
                    FROM "Ledger"
                    WHERE customer_id = $1 AND type = 'PRODUCT' AND deleted_at IS NULL
                      AND COALESCE((reference_date AT TIME ZONE 'Africa/Mogadishu')::date, (created_at AT TIME ZONE 'Africa/Mogadishu')::date)
                            IN (SELECT date1 FROM prev_pair UNION SELECT date2 FROM prev_pair)
                    GROUP BY customer_id
                ) td ON c.id = td.customer_id
                WHERE c.id = $1
            `, [customerId]);
            if (statusRows.length > 0) {
                customerStatus = statusRows[0];
            }
        } catch (statusErr) {
            console.error('Failed to fetch updated customer status:', statusErr);
        }

        return NextResponse.json({ success: true, finalDebt: runningDebt, count: entriesToInsert.length, customerStatus });
    } catch (error: any) {
        console.error('Ledger Error:', error);
        return NextResponse.json({ error: error.message || 'Failed to add entry' }, { status: 500 });
    }
});

// ── Cached ledger fetch per customer ──────────────────────────────────────
const fetchLedgerData = async (customerId: string, limit: number, offset: number) => {
    const [txnResult, summaryResult] = await Promise.all([
        pool.query(
            `SELECT id, customer_id, type, reference_date, kg, price_per_kg, amount, previous_debt, new_debt, note, receipt_id, edit_count, created_at FROM "Ledger"
             WHERE customer_id = $1 AND deleted_at IS NULL
             ORDER BY created_at DESC, id DESC
             LIMIT ${limit} OFFSET ${offset}`,
            [customerId]
        ),
        pool.query(
            `SELECT
                COALESCE(SUM(CASE WHEN type = 'PRODUCT' THEN kg    ELSE 0 END), 0)::float as total_kg,
                COALESCE(SUM(CASE WHEN type = 'PAYMENT' THEN amount ELSE 0 END), 0)::float as total_paid,
                (SELECT new_debt FROM "Ledger"
                 WHERE customer_id = $1 AND deleted_at IS NULL
                 ORDER BY created_at DESC, id DESC LIMIT 1)::float as current_balance,
                (SELECT type FROM "Ledger"
                 WHERE customer_id = $1 AND deleted_at IS NULL
                 ORDER BY created_at DESC, id DESC LIMIT 1) as last_transaction_type
             FROM "Ledger"
             WHERE customer_id = $1 AND deleted_at IS NULL`,
            [customerId]
        )
    ]);
    const s = summaryResult.rows[0] || {};
    return {
        transactions: txnResult.rows,
        summary: {
            totalKg:             s.total_kg || 0,
            totalPaid:           s.total_paid || 0,
            currentBalance:      s.current_balance || 0,
            lastTransactionType: s.last_transaction_type || null,
        }
    };
};

const getCachedLedger = (customerId: string, limit: number, offset: number) =>
    unstable_cache(
        async () => fetchLedgerData(customerId, limit, offset),
        ['ledger', customerId, String(limit), String(offset)],
        { revalidate: 1800, tags: ['ledger', `ledger-${customerId}`, 'customers'] } // 30-min cache, busted on writes
    )();

export const GET = trackApiRoute('/api/ledger', async (request: Request) => {
    const { errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customerId');
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);
    const offset = parseInt(searchParams.get('offset') || '0');

    if (!customerId) {
        return NextResponse.json({ error: 'Customer ID required' }, { status: 400 });
    }

    try {
        const data = await getCachedLedger(customerId, limit, offset);
        const response = NextResponse.json(data);
        response.headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
        return response;
    } catch (error: any) {
        console.error('Fetch Ledger Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});

export const DELETE = trackApiRoute('/api/ledger', async (request: Request) => {
    const { errorResponse, session } = await requireSession(request);
    if (errorResponse) return errorResponse;
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const customerId = searchParams.get('customerId');

    if (!id && !customerId) return NextResponse.json({ error: 'ID or Customer ID required' }, { status: 400 });

    try {
        let query = `UPDATE "Ledger" SET deleted_at = NOW(), deleted_by = $1`;
        const params: any[] = [session?.username || 'unknown'];

        if (id) {
            query += ` WHERE id = $2`;
            params.push(id);
        } else if (customerId) {
            query += ` WHERE customer_id = $2`;
            params.push(customerId);
        }

        const result = await pool.query(query, params);

        // Fire-and-forget audit log — don't block the response
        logAudit(request, 'DELETE_LEDGER_ENTRIES', `Soft deleted ledger entry (ID: ${id || 'ALL'}, Customer: ${customerId || 'UNKNOWN'})`).catch(() => {});
        try {
            // @ts-ignore
            revalidateTag('customers');
            // @ts-ignore
            revalidateTag('maqal-latest');   // bust maqal cache on undo too
            // @ts-ignore
            revalidateTag('customer-daily-entries'); // bust pair progression cache so new pairs reload after undo
            // @ts-ignore
            revalidateTag('ledger');
            revalidatePath('/api/ledger-by-date');
        } catch (cacheErr) {
            console.error('Failed to revalidate customers tag:', cacheErr);
        }

        return NextResponse.json({ success: true, count: result.rowCount });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
