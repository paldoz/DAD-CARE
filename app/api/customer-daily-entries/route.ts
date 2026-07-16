import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/require-session';
import { trackApiRoute } from '@/lib/egress-tracker';

// Get unprocessed daily book entries for a specific customer.
//
// ── PAIR RULE ──────────────────────────────────────────────────────────────
// Dates are paired mathematically using a HARDCODED epoch of 2026-06-28.
// Pairs: Jun28+Jun29, Jun30+Jul01, Jul02+Jul03, Jul04+Jul05, ...
//
// GLOBAL ACTIVE PAIR = the pair whose even-offset start ≤ today's offset.
//   offset = floor((today - epoch) / 86400000)
//   activePairStart = floor(offset / 2) * 2
//
// WAITING PAIR = the pair AFTER the active pair (not yet unlocked).
//   waitingPairStart = activePairStart + 2
//
// A pair is READY (unlocked) only when the DailyBook has an entry
// dated >= waitingPairStart. Until then, the waiting pair shows ⏳.
//
// The customer form always shows:
//   1. The OLDEST unprocessed pair (auto-oldest logic)
//   2. If all done → shows the WAITING pair (isReady: false) so they can see it's coming
// ──────────────────────────────────────────────────────────────────────────

export const GET = trackApiRoute('/api/customer-daily-entries', async (request: Request) => {
    const { errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customerId');

    if (!customerId) {
        return NextResponse.json({ error: 'Customer ID required' }, { status: 400 });
    }

    try {
        const epochMs = new Date('2026-06-28T00:00:00Z').getTime();

        const pad = (n: number) => String(n).padStart(2, '0');
        const toDateStr = (ms: number) => {
            const d = new Date(ms);
            return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
        };

        // ── PARALLEL QUERIES: Fetch today, max db date, min customer date, and processed dates all at once ──
        const [todayRes, maxDbRes, startRes, processedRes] = await Promise.all([
            pool.query(`SELECT TO_CHAR(NOW() AT TIME ZONE 'Africa/Mogadishu', 'YYYY-MM-DD') as today`),
            pool.query(`SELECT TO_CHAR(MAX((date AT TIME ZONE 'Africa/Mogadishu')::date), 'YYYY-MM-DD') as max_date FROM "DailyBook" WHERE deleted_at IS NULL`),
            pool.query(`
                SELECT TO_CHAR(MIN(date_val), 'YYYY-MM-DD') as min_date
                FROM (
                    SELECT (db.date AT TIME ZONE 'Africa/Mogadishu')::date as date_val
                    FROM "DailyBookItem" dbi
                    JOIN "DailyBook" db ON dbi.daily_book_id = db.id
                    WHERE dbi.customer_id = $1 AND dbi.deleted_at IS NULL AND db.deleted_at IS NULL
                    UNION ALL
                    SELECT (reference_date AT TIME ZONE 'Africa/Mogadishu')::date as date_val
                    FROM "Ledger"
                    WHERE customer_id = $1 AND type = 'PRODUCT' AND deleted_at IS NULL AND reference_date IS NOT NULL
                ) as combined
            `, [customerId]),
            pool.query(`
                SELECT DISTINCT TO_CHAR((reference_date AT TIME ZONE 'Africa/Mogadishu')::date, 'YYYY-MM-DD') as date_str
                FROM "Ledger"
                WHERE customer_id = $1
                  AND type = 'PRODUCT'
                  AND deleted_at IS NULL
                  AND reference_date IS NOT NULL
            `, [customerId])
        ]);

        const todayStr = todayRes.rows[0]?.today as string;
        const todayMs = new Date(`${todayStr}T00:00:00Z`).getTime();
        const todayOffset = Math.floor((todayMs - epochMs) / 86400000);
        const activePairStart = Math.floor(todayOffset / 2) * 2;

        const maxDbDateStr = maxDbRes.rows[0]?.max_date as string | null;
        let maxDbPairStart = -2; // fallback to before epoch if no books
        if (maxDbDateStr) {
            const maxDbMs = new Date(`${maxDbDateStr}T00:00:00Z`).getTime();
            const maxDbOffset = Math.floor((maxDbMs - epochMs) / 86400000);
            maxDbPairStart = Math.floor(maxDbOffset / 2) * 2;
        }

        const readyPairStartOffset = Math.max(0, activePairStart);
        const waitingPairStart = readyPairStartOffset + 2;

        const minDateStr = startRes.rows[0]?.min_date as string | null;
        let startOffset = readyPairStartOffset; // Default: only show current pair
        if (minDateStr) {
            const minDateMs = new Date(`${minDateStr}T00:00:00Z`).getTime();
            const minOffset = Math.floor((minDateMs - epochMs) / 86400000);
            startOffset = Math.floor(minOffset / 2) * 2;
        }
        startOffset = Math.max(0, Math.min(startOffset, readyPairStartOffset));

        const processedRows = processedRes.rows;
        const processedOffsets = new Set(processedRows.map(r => {
            const ms = new Date(`${(r.date_str as string)}T00:00:00Z`).getTime();
            return Math.floor((ms - epochMs) / 86400000);
        }));

        // ── STEP 5: Find all unprocessed ready pairs (oldest first) ──
        const unprocessedPairs: number[] = [];
        for (let offset = startOffset; offset <= readyPairStartOffset; offset += 2) {
            // A pair is unprocessed if EITHER day is missing from the ledger
            if (!processedOffsets.has(offset) || !processedOffsets.has(offset + 1)) {
                unprocessedPairs.push(offset);
            }
        }

        const allUnprocessedDates: string[] = [];
        for (const pairOffset of unprocessedPairs) {
            allUnprocessedDates.push(
                toDateStr(epochMs + pairOffset * 86400000),
                toDateStr(epochMs + (pairOffset + 1) * 86400000)
            );
        }

        // ── STEP 6: Always append the WAITING pair ──
        // The waiting pair is always shown regardless of processed status — as ⏳ locked
        const waitingDay1 = toDateStr(epochMs + waitingPairStart * 86400000);
        const waitingDay2 = toDateStr(epochMs + (waitingPairStart + 1) * 86400000);
        allUnprocessedDates.push(waitingDay1, waitingDay2);

        // Oldest unprocessed ready pair to show in the form
        const oldestUnprocessedPairStart = unprocessedPairs.length > 0 ? unprocessedPairs[0] : null;

        // ── STEP 7: Build the response entries ──
        if (oldestUnprocessedPairStart === null) {
            // The waiting pair maqal_id
            const waitingMaqalId = Math.floor(waitingPairStart / 2) + 1;
            const waitingResult = [
                { date: waitingDay1, kg: 0, note: 'Notebook', processed: false, isReady: false },
                { date: waitingDay2, kg: 0, note: 'Notebook', processed: false, isReady: false },
            ];
            const res = NextResponse.json(waitingResult, {
                headers: { 
                    'x-all-unprocessed-dates': JSON.stringify(allUnprocessedDates),
                    'x-maqal-id': String(waitingMaqalId),
                }
            });
            res.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
            return res;
        }

        // ── STEP 8: Fetch DB entries for the OLDEST unprocessed pair ──
        const day1Str = toDateStr(epochMs + oldestUnprocessedPairStart * 86400000);
        const day2Str = toDateStr(epochMs + (oldestUnprocessedPairStart + 1) * 86400000);

        const itemsQuery = `
            SELECT TO_CHAR((db.date AT TIME ZONE 'Africa/Mogadishu')::date, 'YYYY-MM-DD') as date,
                   dbi.kg, dbi.note
            FROM "DailyBookItem" dbi
            JOIN "DailyBook" db ON dbi.daily_book_id = db.id
            WHERE dbi.customer_id = $1
              AND (db.date AT TIME ZONE 'Africa/Mogadishu')::date IN ($2::date, $3::date)
              AND dbi.deleted_at IS NULL
              AND db.deleted_at IS NULL
            ORDER BY db.date ASC
        `;
        const { rows: items } = await pool.query(itemsQuery, [customerId, day1Str, day2Str]);

        const uniqueDatesMap = new Map<string, { date: string; kg: number; note: string | null; processed: boolean; isReady: boolean }>();
        for (const item of items) {
            const dateKey = item.date as string;
            if (!uniqueDatesMap.has(dateKey)) {
                uniqueDatesMap.set(dateKey, {
                    date: dateKey,
                    kg: Number(item.kg),
                    note: (item.note as string | null) ?? null,
                    processed: false,
                    isReady: true, // It's in the ready range
                });
            }
        }

        const result = [];
        // day1 (e.g. Jul 02)
        if (uniqueDatesMap.has(day1Str)) result.push(uniqueDatesMap.get(day1Str)!);
        else result.push({ date: day1Str, kg: 0, note: 'Notebook', processed: false, isReady: true });
        // day2 (e.g. Jul 03)
        if (uniqueDatesMap.has(day2Str)) result.push(uniqueDatesMap.get(day2Str)!);
        else result.push({ date: day2Str, kg: 0, note: 'Notebook', processed: false, isReady: true });

        // maqal_id: sequential 1-based ID for this pair (pair offset 0 = maqal 1, offset 2 = maqal 2, etc.)
        const currentMaqalId = Math.floor(oldestUnprocessedPairStart / 2) + 1;

        const res = NextResponse.json(result, {
            headers: {
                'x-all-unprocessed-dates': JSON.stringify(allUnprocessedDates),
                'x-maqal-id': String(currentMaqalId),
            }
        });
        res.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
        return res;
    } catch (error: any) {
        console.error('Fetch Customer Daily Entries Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});

