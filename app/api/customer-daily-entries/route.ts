import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/require-session';
import { trackApiRoute } from '@/lib/egress-tracker';

import { MAQAL_PAIRS_CTE, validateMaqalPairs } from '@/lib/maqal-utils';

const fetchCustomerDailyEntriesData = async (customerId: string) => {
    // 1. Fetch ALL authoritative DailyBook 2-day pairs (strictly chronological ASC)
    const pairsRes = await pool.query(`
        ${MAQAL_PAIRS_CTE}
        SELECT mq_num, date1::text as date1, date2::text as date2
        FROM pairs
        ORDER BY mq_num ASC;
    `);

    interface PairRecord {
        mq_num: number;
        date1: string;
        date2: string;
    }

    const allPairs: PairRecord[] = pairsRes.rows.map(r => ({
        mq_num: Number(r.mq_num),
        date1: String(r.date1).split('T')[0],
        date2: String(r.date2).split('T')[0]
    }));

    validateMaqalPairs(allPairs);

    if (allPairs.length === 0) {
        return {
            result: [],
            allUnprocessedDates: [],
            maqalId: 1
        };
    }

    // Build a lookup: date string -> mq_num (for cross-referencing processed dates)
    const dateToMqNum = new Map<string, number>();
    for (const pair of allPairs) {
        dateToMqNum.set(pair.date1, pair.mq_num);
        dateToMqNum.set(pair.date2, pair.mq_num);
    }

    // 2. Fetch customer's processed product DATES from Ledger
    //    We use reference_date to find which pair dates have already been entered.
    //    IMPORTANT: Do NOT rely solely on maqal_id — older rows may have maqal_id = NULL.
    const processedRes = await pool.query(`
        SELECT DISTINCT
            (reference_date AT TIME ZONE 'Africa/Mogadishu')::date::text AS date_str,
            maqal_id
        FROM "Ledger"
        WHERE customer_id = $1
          AND type = 'PRODUCT'
          AND deleted_at IS NULL
          AND reference_date IS NOT NULL
        ORDER BY date_str ASC
    `, [customerId]);

    // Collect all mq_nums that this customer has already been charged for
    const processedMqNums = new Set<number>();

    for (const row of processedRes.rows) {
        const dateStr = row.date_str as string;
        const maqalId = row.maqal_id;

        // Method A: explicit maqal_id on the ledger row (new rows)
        if (maqalId != null && !isNaN(Number(maqalId))) {
            processedMqNums.add(Number(maqalId));
        }

        // Method B: cross-reference the processed date against authoritative pairs (handles NULL maqal_id on old rows)
        const mqFromDate = dateToMqNum.get(dateStr);
        if (mqFromDate != null) {
            processedMqNums.add(mqFromDate);
        }
    }

    const maxProcessedMq = processedMqNums.size > 0 ? Math.max(...Array.from(processedMqNums)) : 0;

    let unprocessedPairs: PairRecord[];

    if (maxProcessedMq > 0) {
        // Customer has processed up to MQ#maxProcessedMq.
        // NEVER go back — next pairs are strictly mq_num > maxProcessedMq.
        unprocessedPairs = allPairs.filter(p => p.mq_num > maxProcessedMq);
    } else {
        // No ledger history at all — this is a brand new customer.
        // Start from their first DailyBook date, or customer creation date.
        const [earliestDbRes, customerRes] = await Promise.all([
            pool.query(`
                SELECT MIN(db.date)::date::text AS earliest_date
                FROM "DailyBookItem" dbi
                JOIN "DailyBook" db ON dbi.daily_book_id = db.id
                WHERE dbi.customer_id = $1
                  AND dbi.deleted_at IS NULL
                  AND db.deleted_at IS NULL
            `, [customerId]),
            pool.query(`
                SELECT (created_at AT TIME ZONE 'Africa/Mogadishu')::date::text AS created_date
                FROM "Customer"
                WHERE id = $1
            `, [customerId])
        ]);

        const earliestDate: string | null =
            earliestDbRes.rows[0]?.earliest_date ||
            customerRes.rows[0]?.created_date ||
            null;

        if (earliestDate) {
            // Find the first pair whose date2 >= earliestDate (so the whole pair overlaps)
            const startPair = allPairs.find(p => p.date2 >= earliestDate) || allPairs[allPairs.length - 1];
            unprocessedPairs = allPairs.filter(p => p.mq_num >= startPair.mq_num);
        } else {
            // Absolute fallback — start at latest pair
            unprocessedPairs = [allPairs[allPairs.length - 1]];
        }
    }

    const allUnprocessedDates: string[] = [];
    for (const p of unprocessedPairs) {
        allUnprocessedDates.push(p.date1, p.date2);
    }

    // Target pair to show: oldest unprocessed pair
    const pairToShow = unprocessedPairs.length > 0
        ? unprocessedPairs[0]
        : (allPairs.length > 0 ? allPairs[allPairs.length - 1] : null);

    const day1Str = pairToShow ? pairToShow.date1 : new Date().toISOString().split('T')[0];
    const day2Str = pairToShow ? pairToShow.date2 : new Date().toISOString().split('T')[0];
    const currentMaqalId = pairToShow ? pairToShow.mq_num : 1;

    const { rows: items } = await pool.query(`
        SELECT TO_CHAR(db.date, 'YYYY-MM-DD') AS date,
               dbi.kg, dbi.note
        FROM "DailyBookItem" dbi
        JOIN "DailyBook" db ON dbi.daily_book_id = db.id
        WHERE dbi.customer_id = $1
          AND db.date IN ($2::date, $3::date)
          AND dbi.deleted_at IS NULL
          AND db.deleted_at IS NULL
        ORDER BY db.date ASC
    `, [customerId, day1Str, day2Str]);

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
    result.push(uniqueDatesMap.get(day1Str) ?? { date: day1Str, kg: 0, note: 'Notebook', processed: false, isReady: true });
    result.push(uniqueDatesMap.get(day2Str) ?? { date: day2Str, kg: 0, note: 'Notebook', processed: false, isReady: true });

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
        // NOTE: No unstable_cache here — this data is customer-specific and must always
        // be fresh so the correct next Maqal pair is shown after each save.
        const data = await fetchCustomerDailyEntriesData(customerId);

        const res = NextResponse.json(data.result, {
            headers: {
                'x-all-unprocessed-dates': JSON.stringify(data.allUnprocessedDates),
                'x-maqal-id': String(data.maqalId),
            }
        });

        // Tell browser never to serve stale data
        res.headers.set('Cache-Control', 'no-store');
        return res;
    } catch (error: any) {
        console.error('Fetch Customer Daily Entries Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
