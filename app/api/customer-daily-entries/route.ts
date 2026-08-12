import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/require-session';
import { trackApiRoute } from '@/lib/egress-tracker';

import { unstable_cache } from 'next/cache';

const fetchCustomerDailyEntriesData = async (customerId: string) => {
    const epochMs = new Date('2026-06-28T00:00:00Z').getTime();

        const pad = (n: number) => String(n).padStart(2, '0');
        const toDateStr = (ms: number) => {
            const d = new Date(ms);
            return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
        };

        const [boundariesRes, processedRes] = await Promise.all([
            pool.query(`
                WITH today_q AS (
                    SELECT TO_CHAR(NOW() AT TIME ZONE 'Africa/Mogadishu', 'YYYY-MM-DD') as today
                ),
                max_db_q AS (
                    SELECT TO_CHAR(MAX(date), 'YYYY-MM-DD') as max_date FROM "DailyBook" WHERE deleted_at IS NULL
                ),
                min_db_q AS (
                    SELECT TO_CHAR(MIN(date_val), 'YYYY-MM-DD') as min_date
                    FROM (
                        SELECT db.date as date_val
                        FROM "DailyBookItem" dbi
                        JOIN "DailyBook" db ON dbi.daily_book_id = db.id
                        WHERE dbi.customer_id = $1 AND dbi.deleted_at IS NULL AND db.deleted_at IS NULL
                        UNION ALL
                        SELECT (reference_date AT TIME ZONE 'Africa/Mogadishu')::date as date_val
                        FROM "Ledger"
                        WHERE customer_id = $1 AND type = 'PRODUCT' AND deleted_at IS NULL AND reference_date IS NOT NULL
                    ) as combined
                )
                SELECT 
                    (SELECT today FROM today_q) as today,
                    (SELECT max_date FROM max_db_q) as max_date,
                    (SELECT min_date FROM min_db_q) as min_date
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

        const todayStr = boundariesRes.rows[0]?.today as string;
        const todayMs = new Date(`${todayStr}T00:00:00Z`).getTime();
        const todayOffset = Math.floor((todayMs - epochMs) / 86400000);
        const activePairStart = Math.max(0, Math.floor((todayOffset - 2) / 2) * 2);

        const maxDbDateStr = boundariesRes.rows[0]?.max_date as string | null;
        let maxDbPairStart = -2;
        if (maxDbDateStr) {
            const maxDbMs = new Date(`${maxDbDateStr}T00:00:00Z`).getTime();
            const maxDbOffset = Math.floor((maxDbMs - epochMs) / 86400000);
            maxDbPairStart = Math.floor(maxDbOffset / 2) * 2;
        }

        const readyPairStartOffset = Math.max(0, activePairStart);
        const waitingPairStart = readyPairStartOffset + 2;

        const minDateStr = boundariesRes.rows[0]?.min_date as string | null;
        let startOffset = readyPairStartOffset; 
        if (minDateStr) {
            const minDateMs = new Date(`${minDateStr}T00:00:00Z`).getTime();
            const minOffset = Math.floor((minDateMs - epochMs) / 86400000);
            startOffset = Math.floor(minOffset / 2) * 2;
        } else {
            // FIX: If a customer has no history (like on a fresh database), 
            // force them to start ONE PAIR in the past so the admin can enter a manual Reesto.
            startOffset = Math.max(0, readyPairStartOffset - 2);
        }
        startOffset = Math.max(0, Math.min(startOffset, readyPairStartOffset));

        const processedRows = processedRes.rows;
        const processedOffsets = new Set(processedRows.map(r => {
            const ms = new Date(`${(r.date_str as string)}T00:00:00Z`).getTime();
            return Math.floor((ms - epochMs) / 86400000);
        }));

        const unprocessedPairs: number[] = [];
        for (let offset = startOffset; offset <= readyPairStartOffset; offset += 2) {
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

        const waitingDay1 = toDateStr(epochMs + waitingPairStart * 86400000);
        const waitingDay2 = toDateStr(epochMs + (waitingPairStart + 1) * 86400000);
        allUnprocessedDates.push(waitingDay1, waitingDay2);

        // If there are older unprocessed pairs, show the OLDEST one first so they can resolve it.
        // Otherwise, show the current active pair.
        const pairToShow = unprocessedPairs.length > 0 ? unprocessedPairs[0] : readyPairStartOffset;
        
        const day1Str = toDateStr(epochMs + pairToShow * 86400000);
        const day2Str = toDateStr(epochMs + (pairToShow + 1) * 86400000);
        const currentMaqalId = Math.floor(pairToShow / 2) + 1;

        const itemsQuery = `
            SELECT TO_CHAR(db.date, 'YYYY-MM-DD') as date,
                   dbi.kg, dbi.note
            FROM "DailyBookItem" dbi
            JOIN "DailyBook" db ON dbi.daily_book_id = db.id
            WHERE dbi.customer_id = $1
              AND db.date IN ($2::date, $3::date)
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
                    isReady: true,
                });
            }
        }

        const result = [];
        if (uniqueDatesMap.has(day1Str)) result.push(uniqueDatesMap.get(day1Str)!);
        else result.push({ date: day1Str, kg: 0, note: 'Notebook', processed: false, isReady: true });
        
        if (uniqueDatesMap.has(day2Str)) result.push(uniqueDatesMap.get(day2Str)!);
        else result.push({ date: day2Str, kg: 0, note: 'Notebook', processed: false, isReady: true });




        return {
            result,
            allUnprocessedDates,
            maqalId: currentMaqalId
        };
};



export const GET = trackApiRoute('/api/customer-daily-entries', async (request: Request) => {
    const { errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customerId');

    if (!customerId) {
        return NextResponse.json({ error: 'Customer ID required' }, { status: 400 });
    }

    try {
        const getCachedData = unstable_cache(
            async () => fetchCustomerDailyEntriesData(customerId),
            [`daily-entries-${customerId}`],
            { tags: [`daily-entries-${customerId}`], revalidate: 3600 }
        );
        const data = await getCachedData();

        const res = NextResponse.json(data.result, {
            headers: {
                'x-all-unprocessed-dates': JSON.stringify(data.allUnprocessedDates),
                'x-maqal-id': String(data.maqalId),
            }
        });
        
        res.headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
        return res;
    } catch (error: any) {
        console.error('Fetch Customer Daily Entries Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
