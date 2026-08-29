import { NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit';
import { requireSession } from '@/lib/require-session';
import { revalidateTag, revalidatePath, unstable_cache } from 'next/cache';
import pool from '@/lib/db';
import { calculateMaqalCharge } from '@/lib/ledger-utils';
import { trackApiRoute } from '@/lib/egress-tracker';
import { rateLimitResponse } from '@/lib/rate-limit';
import { groupTransactionsInfoReceipts } from '@/app/utils/ledgerHelpers';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

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
    const { session, errorResponse } = await requireSession(request);
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
        // Client-sent maqal_id is a hint — we will override it with the authoritative DB value below.
        const client_maqal_id = body.maqal_id || null;

        if (!customerId) throw new Error('Customer ID is required');

        const client = await pool.connect();
        let runningDebt = 0;
        let customerName = '';
        let entriesToInsert: any[] = [];
        // authoritative_maqal_id: final value used for ALL rows in this batch.
        // Resolved below after reading the DB.
        let authoritative_maqal_id: number | null = client_maqal_id;

        try {
            await client.query('BEGIN');

            // 1. Verify customer and acquire row lock
            const { rows: customers } = await client.query(
                `SELECT name FROM "Customer" WHERE id = $1 FOR UPDATE`,
                [customerId]
            );
            if (customers.length === 0) throw new Error('Customer not found');
            customerName = customers[0].name;

            // 1b. AUTHORITATIVE MAQAL_ID & CUSTOMER ISOLATION RESOLUTION:
            // If this batch uses an existing receipt_id, verify it belongs strictly to this customer
            // and look up the authoritative maqal_id from the existing PRODUCT rows.
            if (receipt_id) {
                const { rows: existingProducts } = await client.query(
                    `SELECT maqal_id, customer_id FROM "Ledger" WHERE receipt_id = $1 AND type = 'PRODUCT' AND deleted_at IS NULL LIMIT 1`,
                    [receipt_id]
                );
                if (existingProducts.length > 0) {
                    if (existingProducts[0].customer_id && existingProducts[0].customer_id !== customerId) {
                        throw new Error('Customer Isolation Error: Receipt belongs to a different customer');
                    }
                    if (existingProducts[0].maqal_id != null) {
                        authoritative_maqal_id = existingProducts[0].maqal_id;
                    }
                }
                // else: new receipt, use client-sent maqal_id (which should be the current unprocessed maqal).
            }

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

            // (Removed hasReset logic that forced runningDebt to 0. This caused math mismatches because the background recalculation historically ignored it and summed absolute values. Now memory math matches the absolute sum perfectly).

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
                    // FLOOR rule: fractional dollar is forgiven. e.g. 4.5 KG × $35 = $157.50 → $157
                    entryAmount = calculateMaqalCharge(kg, price);
                    runningDebt = Number((runningDebt + entryAmount).toFixed(2));
                } else if (type === 'PAYMENT') {
                    entryAmount = Number(parseFloat(amount).toFixed(2));
                    runningDebt = Number((runningDebt - entryAmount).toFixed(2));
                } else if (type === 'ADJUSTMENT') {
                    entryAmount = Number(parseFloat(amount).toFixed(2));
                    const lowerNote = (note || '').toLowerCase();
                    runningDebt = Number((runningDebt + entryAmount).toFixed(2));
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
                    maqal_id: authoritative_maqal_id,
                    created_at: new Date(now.getTime() + i).toISOString()
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

            // After inserting ANY new ledger entries, we don't need to mathematically recalculate the entire ledger
            // because inserts are append-only (created_at is always NOW()) and the runningDebt math done above is 100% accurate.
            // Recalculating here causes severe O(N) performance degradation as customer history grows.
            // const { recalculateCustomerLedger } = await import('@/lib/ledger-utils');
            // const uniqueCustomerIds = [...new Set(entriesToInsert.map(e => e.customer_id))];
            // for (const cId of uniqueCustomerIds) {
            //     await recalculateCustomerLedger(cId, client);
            // }

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
            // @ts-ignore
            revalidateTag('customers'); // ⚡ EXTREMELY IMPORTANT: Bust customers list so blue checkmark shows instantly
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

// ── Authoritative Maqal-level pagination for Customer Profile ──
const fetchMaqalData = async (
    customerId: string,
    limit: number,
    offset: number,
    startDate?: string | null,
    endDate?: string | null
) => {
    let whereClause = `customer_id = $1 AND deleted_at IS NULL`;
    const params: any[] = [customerId];

    if (startDate) {
        params.push(startDate);
        whereClause += ` AND reference_date >= $${params.length}`;
    }
    if (endDate) {
        params.push(endDate);
        whereClause += ` AND reference_date <= $${params.length}`;
    }

    const [txnResult, summaryResult] = await Promise.all([
        pool.query(
            `SELECT id, customer_id, type, reference_date, kg, price_per_kg, amount, previous_debt, new_debt, note, receipt_id, maqal_id, created_at FROM "Ledger"
             WHERE ${whereClause}
             ORDER BY created_at ASC, id ASC`,
            params
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
    const allTxns = txnResult.rows;
    const allReceipts = groupTransactionsInfoReceipts(allTxns);
    const totalMaqals = allReceipts.length;

    const pagedMaqals = allReceipts.slice(offset, offset + limit).map(m => ({
        titleString: m.titleString,
        displayMaqalId: m.displayMaqalId,
        totalKilos: m.totalKilos,
        totalMaqalka: m.totalMaqalka,
        totalPaid: m.totalPaid,
        totalAdjustment: m.totalAdjustment,
        openingBalance: m.openingBalance,
        closingBalance: m.closingBalance,
        percentage: m.percentage,
        note: m.note,
        entries: (m.entries || []).map(e => ({
            id: e.id,
            type: e.type,
            amount: Number(e.amount || 0),
            kg: e.kg != null ? Number(e.kg) : undefined,
            price_per_kg: e.price_per_kg != null ? Number(e.price_per_kg) : undefined,
            reference_date: e.reference_date,
            created_at: e.created_at,
            note: e.note,
            maqal_id: e.maqal_id,
            receipt_id: e.receipt_id
        }))
    }));

    const hasMore = (offset + pagedMaqals.length) < totalMaqals;
    const nextOffset = hasMore ? (offset + pagedMaqals.length) : null;

    return {
        customerId,
        maqals: pagedMaqals,
        totalMaqals,
        totalCount: allTxns.length,
        hasMore,
        nextOffset,
        summary: {
            totalKg:             s.total_kg || 0,
            totalPaid:           s.total_paid || 0,
            currentBalance:      s.current_balance || 0,
            lastTransactionType: s.last_transaction_type || null,
        }
    };
};

// ── Cached ledger fetch per customer with deterministic cursor pagination ──
const fetchLedgerData = async (
    customerId: string,
    limit: number,
    offset: number,
    cursor?: string | null,
    startDate?: string | null,
    endDate?: string | null
) => {
    let whereClause = `customer_id = $1 AND deleted_at IS NULL`;
    const params: any[] = [customerId];

    if (startDate) {
        params.push(startDate);
        whereClause += ` AND reference_date >= $${params.length}`;
    }
    if (endDate) {
        params.push(endDate);
        whereClause += ` AND reference_date <= $${params.length}`;
    }

    let paginationClause = '';
    if (cursor) {
        const [cursorTime, cursorId] = cursor.split('|');
        if (cursorTime && cursorId) {
            params.push(cursorTime, cursorId);
            const timeParam = `$${params.length - 1}`;
            const idParam = `$${params.length}`;
            whereClause += ` AND (created_at < ${timeParam}::timestamptz OR (created_at = ${timeParam}::timestamptz AND id < ${idParam}))`;
        }
        params.push(limit);
        paginationClause = `ORDER BY created_at DESC, id DESC LIMIT $${params.length}`;
    } else {
        params.push(limit, offset);
        paginationClause = `ORDER BY created_at DESC, id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
    }

    const [txnResult, summaryResult, countResult] = await Promise.all([
        pool.query(
            `SELECT id, customer_id, type, reference_date, kg, price_per_kg, amount, previous_debt, new_debt, note, receipt_id, maqal_id, edit_count, created_at FROM "Ledger"
             WHERE ${whereClause}
             ${paginationClause}`,
            params
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
        ),
        pool.query(
            `SELECT COUNT(*)::int as total_count FROM "Ledger"
             WHERE customer_id = $1 AND deleted_at IS NULL`,
            [customerId]
        )
    ]);

    const s = summaryResult.rows[0] || {};
    const totalCount = countResult.rows[0]?.total_count || 0;
    const txns = txnResult.rows;

    let hasMore = false;
    let nextCursor: string | null = null;
    if (txns.length > 0) {
        const lastTx = txns[txns.length - 1];
        nextCursor = `${new Date(lastTx.created_at).toISOString()}|${lastTx.id}`;
        if (cursor) {
            const { rows: moreRows } = await pool.query(
                `SELECT 1 FROM "Ledger" WHERE customer_id = $1 AND deleted_at IS NULL
                 AND (created_at < $2::timestamptz OR (created_at = $2::timestamptz AND id < $3)) LIMIT 1`,
                [customerId, lastTx.created_at, lastTx.id]
            );
            hasMore = moreRows.length > 0;
        } else {
            hasMore = (offset + txns.length) < totalCount;
        }
    }

    return {
        customerId,
        transactions: txns,
        totalCount,
        hasMore,
        nextCursor: hasMore ? nextCursor : null,
        summary: {
            totalKg:             s.total_kg || 0,
            totalPaid:           s.total_paid || 0,
            currentBalance:      s.current_balance || 0,
            lastTransactionType: s.last_transaction_type || null,
        }
    };
};

const getCachedLedger = (
    customerId: string,
    limit: number,
    offset: number,
    cursor?: string | null,
    startDate?: string | null,
    endDate?: string | null
) => fetchLedgerData(customerId, limit, offset, cursor, startDate, endDate);

export const GET = trackApiRoute('/api/ledger', async (request: Request) => {
    const { errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customerId');
    const mode = searchParams.get('mode');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || (mode === 'maqals' ? '7' : '100')), 1), 1000);
    const offset = parseInt(searchParams.get('offset') || '0');
    const cursor = searchParams.get('cursor');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if (!customerId) {
        return NextResponse.json({ error: 'Customer ID required' }, { status: 400 });
    }

    try {
        if (mode === 'maqals') {
            const data = await fetchMaqalData(customerId, limit, offset, startDate, endDate);
            const response = NextResponse.json(data);
            response.headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
            return response;
        }

        const data = await getCachedLedger(customerId, limit, offset, cursor, startDate, endDate);
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

    // Customer-wide history clear MUST strictly require SUPER_ADMIN role
    if (customerId && session?.role !== 'SUPER_ADMIN') {
        return NextResponse.json({ error: 'Security: Only Super Admins can clear customer history.' }, { status: 403 });
    }

    try {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            let affectedCustomerId: string | null = customerId;

            if (id) {
                const { rows } = await client.query(
                    `SELECT customer_id FROM "Ledger" WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
                    [id]
                );
                if (rows.length > 0) {
                    affectedCustomerId = rows[0].customer_id;
                    await client.query(
                        `UPDATE "Ledger" SET deleted_at = NOW(), deleted_by = $1 WHERE id = $2`,
                        [session?.username || 'unknown', id]
                    );
                }
            } else if (customerId) {
                await client.query(
                    `UPDATE "Ledger" SET deleted_at = NOW(), deleted_by = $1 WHERE customer_id = $2 AND deleted_at IS NULL`,
                    [session?.username || 'unknown', customerId]
                );
            }

            if (affectedCustomerId) {
                const { recalculateCustomerLedger } = await import('@/lib/ledger-utils');
                await recalculateCustomerLedger(affectedCustomerId, client);
            }

            await client.query('COMMIT');

            // Fire-and-forget audit log — don't block the response
            logAudit(request, 'DELETE_LEDGER_ENTRIES', `Soft deleted ledger entries (ID: ${id || 'ALL'}, Customer: ${affectedCustomerId || 'UNKNOWN'})`).catch(() => {});

            try {
                // @ts-ignore
                revalidateTag('customers');
                // @ts-ignore
                revalidateTag('ledger');
                // @ts-ignore
                revalidateTag('maqal-latest');
                // @ts-ignore
                revalidateTag('customer-daily-entries');
                // @ts-ignore
                revalidateTag('dashboard');
                if (affectedCustomerId) {
                    // @ts-ignore
                    revalidateTag(`ledger-${affectedCustomerId}`);
                    // @ts-ignore
                    revalidateTag(`daily-entries-${affectedCustomerId}`);
                }
                revalidatePath('/api/ledger-by-date');
            } catch (cacheErr) {
                console.error('Failed to revalidate tags:', cacheErr);
            }

            return NextResponse.json({ success: true, message: 'Ledger entries successfully deleted and balance recalculated.' });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
