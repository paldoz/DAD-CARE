import { NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit';
import { requireSession } from '@/lib/require-session';
import pool from '@/lib/db';
import { recalculateCustomerLedger, recalculateMultipleCustomerLedgers, calculateMaqalCharge } from '@/lib/ledger-utils';
import { revalidatePath, revalidateTag } from 'next/cache';
import { trackApiRoute } from '@/lib/egress-tracker';
import { rateLimitResponse } from '@/lib/rate-limit';
import { z } from 'zod';

// ── Zod Schemas ────────────────────────────────────────────────────────────
const DailyBookItemSchema = z.object({
    customer_id: z.string().uuid('Invalid customer ID'),
    kg: z.union([z.string(), z.number()]).optional(),
    present: z.boolean().optional(),
    note: z.string().max(500).nullable().optional(),
});

const DailyBookSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
    items: z.array(DailyBookItemSchema).max(300, 'Too many items'),
});

import { unstable_cache } from 'next/cache';

const getDailyBookByDate = unstable_cache(
    async (dateStr: string, pageSize: number, offset: number) => {
        // Get Book (only if not soft-deleted)
        const { rows: books } = await pool.query(
            `SELECT id, date, created_at FROM "DailyBook" WHERE date = $1::date AND deleted_at IS NULL`,
            [dateStr]
        );

        if (books.length === 0) {
            return null;
        }

        const book = books[0];

        // Get total count for pagination UI
        const { rows: countResult } = await pool.query(
            `SELECT COUNT(*) FROM "DailyBookItem" WHERE daily_book_id = $1 AND deleted_at IS NULL`,
            [book.id]
        );
        const totalCount = parseInt(countResult[0].count, 10);

        // Fetch paginated items without bulky customer joins
        const { rows: items } = await pool.query(
            `SELECT id, daily_book_id, customer_id, kg, present, note
             FROM "DailyBookItem"
             WHERE daily_book_id = $1 AND deleted_at IS NULL
             LIMIT $2 OFFSET $3`,
            [book.id, pageSize, offset]
        );

        return { ...book, items, totalCount };
    },
    ['daily-book-cache'],
    { revalidate: 3600, tags: ['daily-book-global'] } // Will dynamically add tag in GET
);

export const GET = trackApiRoute('/api/daily-book', async (request: Request) => {
    const { errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;
    const { searchParams } = new URL(request.url);
    const dateStr = searchParams.get('date');
    if (!dateStr) return NextResponse.json({ error: 'Date required' }, { status: 400 });

    try {
        const page = parseInt(searchParams.get('page') || '1', 10);
        const pageSize = parseInt(searchParams.get('pageSize') || '5000', 10);
        const offset = (page - 1) * pageSize;

        // Wrap the unstable_cache call with dynamic tags for this specific date
        const cachedFn = unstable_cache(
            async () => getDailyBookByDate(dateStr, pageSize, offset),
            [`daily-book-${dateStr}-${pageSize}-${offset}`],
            { tags: [`daily-book-${dateStr}`] }
        );

        const data = await cachedFn();

        if (!data) return NextResponse.json(null);

        const res = NextResponse.json({ ...data, page, pageSize });
        return res;
    } catch (error: any) {
        console.error('Fetch Book Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});

export const POST = trackApiRoute('/api/daily-book', async (request: Request) => {
    const { errorResponse, session } = await requireSession(request);
    if (errorResponse) return errorResponse;

    if (session.role !== 'SUPER_ADMIN') {
        return NextResponse.json({ error: 'Only Super Admin can save Daily Book entries' }, { status: 403 });
    }

    // Rate limit: max 5 saves per 30 seconds to prevent duplicate submissions
    const limited = rateLimitResponse(request, 5, 30_000);
    if (limited) return limited;

    const body = await request.json();

    // ── Zod validation ──────────────────────────────────────────────────
    const parsed = DailyBookSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { date: dateStr, items } = parsed.data;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        let bookId;
        const { rows: existing } = await client.query(
            `SELECT id, deleted_at FROM "DailyBook" WHERE date = $1::date ORDER BY created_at ASC LIMIT 1`,
            [dateStr]
        );

        if (existing.length > 0) {
            bookId = existing[0].id;
            if (existing[0].deleted_at !== null) {
                // Restore the soft-deleted book if they are saving over it
                await client.query(
                    `UPDATE "DailyBook" SET deleted_at = NULL, deleted_by = NULL WHERE id = $1`,
                    [bookId]
                );
            }
        } else {
            const { rows: newBook } = await client.query(
                `INSERT INTO "DailyBook" (id, date, created_at) VALUES (gen_random_uuid(), $1::date, NOW())
                 RETURNING id`,
                [dateStr]
            );
            bookId = newBook[0].id;
        }

        // 2. Delete existing items for this book (Draft mode overwrite - HARD delete is fine here to clean up old draft items)
        await client.query(`DELETE FROM "DailyBookItem" WHERE daily_book_id = $1`, [bookId]);

        // 3. Insert new items
        if (items && items.length > 0) {
            const itemsToInsert = items
                .filter((i: any) => i.kg > 0 || i.present === false || (i.note && i.note.trim() !== ''))
                .map((i: any) => [
                    bookId,
                    i.customer_id,
                    parseFloat(i.kg) || 0,
                    i.present !== false, // true by default
                    i.note || null
                ]);

            if (itemsToInsert.length > 0) {
                // Bulk insert using unnest
                await client.query(
                    `INSERT INTO "DailyBookItem" (id, daily_book_id, customer_id, kg, present, note)
                     SELECT gen_random_uuid(), * FROM UNNEST($1::text[], $2::text[], $3::float8[], $4::boolean[], $5::text[])`,
                    [
                        itemsToInsert.map((i: any[]) => i[0]),
                        itemsToInsert.map((i: any[]) => i[1]),
                        itemsToInsert.map((i: any[]) => i[2]),
                        itemsToInsert.map((i: any[]) => i[3]),
                        itemsToInsert.map((i: any[]) => i[4])
                    ]
                );
            }
        }

        // 4. Sync updates to existing Ledger entries for this date
        const { rows: ledgerEntries } = await client.query(
            `SELECT id, customer_id, kg, amount, price_per_kg 
             FROM "Ledger" 
             WHERE reference_date = $1::date AND type = 'PRODUCT' AND deleted_at IS NULL`,
            [dateStr]
        );

        const customersToRecalculate = new Set<string>();

        if (ledgerEntries.length > 0) {
            // Count entries per customer to avoid corrupting split VIPs
            const customerEntryCounts = new Map<string, number>();
            for (const ledger of ledgerEntries) {
                customerEntryCounts.set(ledger.customer_id, (customerEntryCounts.get(ledger.customer_id) || 0) + 1);
            }

            for (const ledger of ledgerEntries) {
                // SKIP if the customer has multiple ledger entries (e.g. Notebook vs Normal Box split)
                // We cannot safely auto-sync a single KG total to multiple split boxes.
                if (customerEntryCounts.get(ledger.customer_id)! > 1) {
                    continue;
                }

                // Find the new KG from the daily book items payload
                const dailyItem = items?.find((i: any) => i.customer_id === ledger.customer_id);

                // CRITICAL: If the customer is NOT in the daily book payload at all,
                // DO NOT touch their ledger. Their ledger entry must stay exactly as it was.
                // Only sync if the customer IS present in the daily book with a different KG.
                if (!dailyItem) {
                    continue; // Customer not in this save — leave their ledger alone
                }

                const newKg = Number(dailyItem.kg) || 0;

                let effectivePrice = parseFloat(ledger.price_per_kg);
                // If price_per_kg is null or invalid, deduce it from amount / kg
                if (isNaN(effectivePrice)) {
                    const oldKg = parseFloat(ledger.kg) || 0;
                    const oldAmt = parseFloat(ledger.amount) || 0;
                    effectivePrice = oldKg > 0 ? (oldAmt / oldKg) : 0;
                }

                let newAmount = calculateMaqalCharge(newKg, effectivePrice);

                // --- NOTE PARSER SYNCHRONIZATION ---
                if (dailyItem.note) {
                    const noteText = dailyItem.note.trim();
                    const results: { kg: number; price: number | null }[] = [];

                    const fullPattern = /(\d+(?:\.\d+)?)\s+([a-zA-Z][a-zA-Z\s]{0,20}?)\s+(\d+(?:\.\d+)?)/g;
                    let match;
                    while ((match = fullPattern.exec(noteText)) !== null) {
                        const pkg = parseFloat(match[1]);
                        const pprice = parseFloat(match[3]);
                        if (pkg > 0 && pprice > 0) results.push({ kg: pkg, price: pprice });
                    }

                    if (results.length === 0) {
                        const simplePattern = /(\d+(?:\.\d+)?)\s+([a-zA-Z][a-zA-Z]{1,20})/g;
                        while ((match = simplePattern.exec(noteText)) !== null) {
                            const pkg = parseFloat(match[1]);
                            if (pkg > 0) results.push({ kg: pkg, price: null });
                        }
                    }

                    if (results.length > 0) {
                        const firstEntry = results[0];
                        if (results.length > 1) {
                            const secondEntry = results[1];
                            const p1 = firstEntry.price !== null ? firstEntry.price : effectivePrice;
                            const p2 = secondEntry.price !== null ? secondEntry.price : effectivePrice;
                            newAmount = calculateMaqalCharge(firstEntry.kg, p1) + calculateMaqalCharge(secondEntry.kg, p2);
                        } else {
                            const p1 = firstEntry.price !== null ? firstEntry.price : effectivePrice;
                            const mainKgNum = Math.max(0, newKg - firstEntry.kg);
                            newAmount = calculateMaqalCharge(firstEntry.kg, p1) + calculateMaqalCharge(mainKgNum, effectivePrice);
                        }
                    } else {
                        // Notebook Pricing Override fallback
                        const priceMatch = noteText.match(/(?:^|\s)\$?(\d+(?:\.\d+)?)(?:\s|$)/);
                        if (priceMatch) {
                            newAmount = calculateMaqalCharge(newKg, parseFloat(priceMatch[1]));
                        }
                    }
                }
                // --- END NOTE PARSER SYNCHRONIZATION ---

                const oldKg = parseFloat(ledger.kg) || 0;
                const oldAmt = parseFloat(ledger.amount) || 0;

                // UPDATE IF EITHER KG OR AMOUNT CHANGED!
                if (Math.abs(oldKg - newKg) > 0.001 || Math.abs(oldAmt - newAmount) > 0.001) {
                    await client.query(
                        `UPDATE "Ledger" SET kg = $1, amount = $2 WHERE id = $3`,
                        [newKg, newAmount, ledger.id]
                    );

                    customersToRecalculate.add(ledger.customer_id);
                }
            }
        }

        await client.query('COMMIT');

        // 5. Trigger the cascade recalculation for any affected customers IN ONE BATCH QUERY (AFTER commit)
        // Running them sequentially would block, and running them in parallel exhausts connection pools.
        // A single batch query is incredibly fast and completely avoids the blocking delay.
        await recalculateMultipleCustomerLedgers(Array.from(customersToRecalculate));

        await logAudit(request, 'SAVE_DAILY_BOOK', `Saved daily book entry for ${dateStr} with ${items?.length || 0} items. Synced ${customersToRecalculate.size} ledger records.`);

        // Force Next.js CDN to purge cache instantly so the UI doesn't require multiple refreshes!
        try {
            // Revalidate only the specific date and history, DO NOT purge global customers
            // @ts-ignore
            revalidateTag(`daily-book-${dateStr}`);
            // @ts-ignore
            revalidateTag('daily-book-history');
            // @ts-ignore
            revalidateTag('customers');
            
            // @ts-ignore
            revalidateTag('dashboard');

            // Purge server cache for EVERY customer affected by this Daily Book save!
            if (items && Array.isArray(items)) {
                for (const item of items) {
                    if (item.customer_id) {
                        // @ts-ignore
                        revalidateTag(`daily-entries-${item.customer_id}`);
                    }
                }
            }
        } catch (e) {
            console.error('Failed to revalidate paths:', e);
        }

        return NextResponse.json({ success: true, bookId, syncedLedgers: customersToRecalculate.size });
    } catch (error: any) {
        await client.query('ROLLBACK');
        console.error('Save DailyBook Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    } finally {
        client.release();
    }
});

export const DELETE = trackApiRoute('/api/daily-book', async (request: Request) => {
    const { errorResponse, session } = await requireSession(request);
    if (errorResponse) return errorResponse;

    if (session.role !== 'SUPER_ADMIN') {
        return NextResponse.json({ error: 'Only Super Admin can delete Daily Book entries' }, { status: 403 });
    }
    const { searchParams } = new URL(request.url);
    const dateStr = searchParams.get('date');
    if (!dateStr) return NextResponse.json({ error: 'Date required' }, { status: 400 });

    try {
        // Get ALL active books for this date (handles duplicate entries gracefully)
        const { rows: books } = await pool.query(
            `SELECT id FROM "DailyBook" WHERE date::date = $1::date AND deleted_at IS NULL`,
            [dateStr]
        );

        if (books.length === 0) {
            // Also check if there are soft-deleted books — if so, return success (already deleted)
            const { rows: anyBooks } = await pool.query(
                `SELECT id FROM "DailyBook" WHERE date::date = $1::date`,
                [dateStr]
            );
            if (anyBooks.length > 0) {
                return NextResponse.json({ success: true, alreadyDeleted: true });
            }
            return NextResponse.json({ error: 'Book not found' }, { status: 404 });
        }

        const username = session?.username || 'unknown';

        // 1. Soft-delete ALL matching books and items
        await Promise.all(books.map(async (book) => {
            await pool.query(
                `UPDATE "DailyBookItem" SET deleted_at = NOW() WHERE daily_book_id = $1 AND deleted_at IS NULL`,
                [book.id]
            );
            await pool.query(
                `UPDATE "DailyBook" SET deleted_at = NOW(), deleted_by = $1 WHERE id = $2`,
                [username, book.id]
            );
        }));

        // The user specifically requested that deleting a Daily Book MUST NOT delete the Ledger entries.
        await logAudit(
            request,
            'DELETE_DAILY_BOOK',
            `Moved daily book entry for ${dateStr} to Trash (deleted ${books.length} record(s)). Historical Customer Ledger, Maqal History, and Payments PRESERVED.`
        );

        try {
            // Revalidate the specific date, history, AND customers so warning signs are instantly synced
            // @ts-ignore
            revalidateTag(`daily-book-${dateStr}`);
            // @ts-ignore
            revalidateTag('daily-book-history');
            // @ts-ignore
            revalidateTag('customers');
            
            // @ts-ignore
            revalidateTag('dashboard');
        } catch (e) {
            console.error('Failed to revalidate paths:', e);
        }

        return NextResponse.json({ success: true, deletedCount: books.length });
    } catch (error: any) {
        console.error('Delete DailyBook Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
