import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/require-session';
import { trackApiRoute } from '@/lib/egress-tracker';

import { MAQAL_PAIRS_CTE, validateMaqalPairs, getMaqalIdFromDate, getDatePairFromMaqalId } from '@/lib/maqal-utils';

const fetchCustomerDailyEntriesData = async (customerId: string, targetMaqalId?: number | null) => {
    // 1. Fetch ALL authoritative DailyBook 2-day pairs (strictly chronological ASC)
    const pairsRes = await pool.query(`
        ${MAQAL_PAIRS_CTE}
        SELECT mq_num, date1::text as date1, date2::text as date2, maqal_id
        FROM pairs
        ORDER BY mq_num ASC;
    `);

    interface PairRecord {
        mq_num: number;
        date1: string;
        date2: string;
        maqal_id: number;
    }

    const allPairs: PairRecord[] = pairsRes.rows.map(r => ({
        mq_num: Number(r.mq_num),
        date1: String(r.date1).split('T')[0],
        date2: String(r.date2).split('T')[0],
        maqal_id: Number(r.maqal_id) || getMaqalIdFromDate(String(r.date1))
    }));

    validateMaqalPairs(allPairs);

    if (allPairs.length === 0) {
        return {
            result: [],
            allUnprocessedDates: [],
            maqalId: targetMaqalId || 9,
            timelineOptions: []
        };
    }

    // Build lookup: date string -> maqal_id
    const dateToMaqalId = new Map<string, number>();
    for (const pair of allPairs) {
        dateToMaqalId.set(pair.date1, pair.maqal_id);
        dateToMaqalId.set(pair.date2, pair.maqal_id);
    }

    // 2. Fetch customer's processed product DATES & MAQAL IDs from Ledger
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

    const processedMaqalIds = new Set<number>();

    for (const row of processedRes.rows) {
        const dateStr = row.date_str as string;
        const maqalId = row.maqal_id;

        if (maqalId != null && !isNaN(Number(maqalId))) {
            processedMaqalIds.add(Number(maqalId));
        }

        const mqFromDate = dateToMaqalId.get(dateStr);
        if (mqFromDate != null) {
            processedMaqalIds.add(mqFromDate);
        }
    }

    // Unprocessed pairs are all authoritative pairs not yet in processedMaqalIds
    // Filtered by customer start date
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

    const eligiblePairs = earliestDate 
        ? allPairs.filter(p => p.date2 >= earliestDate)
        : allPairs;

    const unprocessedPairs = eligiblePairs.filter(p => !processedMaqalIds.has(p.maqal_id));

    // Determine target pair
    let pairToShow: PairRecord;
    if (targetMaqalId) {
        const found = allPairs.find(p => p.maqal_id === targetMaqalId);
        if (found) {
            pairToShow = found;
        } else {
            const { date1, date2 } = getDatePairFromMaqalId(targetMaqalId);
            pairToShow = {
                mq_num: targetMaqalId - 8,
                date1,
                date2,
                maqal_id: targetMaqalId
            };
        }
    } else {
        // Auto (Oldest First): First unprocessed pair in chronological order
        if (unprocessedPairs.length > 0) {
            pairToShow = unprocessedPairs[0];
        } else {
            // All caught up -> default to the latest pair
            pairToShow = allPairs[allPairs.length - 1];
        }
    }

    const allUnprocessedDates: string[] = [];
    for (const p of unprocessedPairs) {
        allUnprocessedDates.push(p.date1, p.date2);
    }

    const formatFriendlyPair = (d1: string, d2: string) => {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const p1 = d1.split('-');
        const p2 = d2.split('-');
        const m1 = months[parseInt(p1[1], 10) - 1] || p1[1];
        const day1 = parseInt(p1[2], 10);
        const m2 = months[parseInt(p2[1], 10) - 1] || p2[1];
        const day2 = parseInt(p2[2], 10);
        return `${m1} ${day1} & ${m2} ${day2}`;
    };

    // Build exactly four chronological options:
    // 2 previous completed + 2 current/upcoming
    const allCompleted = allPairs.filter(p => processedMaqalIds.has(p.maqal_id));
    const allUpcoming = unprocessedPairs;

    const completedSlice = allCompleted.slice(-2);
    const neededUpcoming = Math.max(2, 4 - completedSlice.length);
    const upcomingSlice = allUpcoming.slice(0, neededUpcoming);
    
    // If not enough upcoming, take up to 4 completed
    const finalCompleted = allCompleted.slice(-Math.max(completedSlice.length, 4 - upcomingSlice.length));

    const timelineOptions: { maqalId: number; mqNum: number; date1: string; date2: string; label: string; status: 'DONE' | 'CURRENT' | 'NOT_DONE' | 'WAITING' }[] = [];

    for (const p of finalCompleted) {
        const dateFormatted = formatFriendlyPair(p.date1, p.date2);
        timelineOptions.push({
            maqalId: p.maqal_id,
            mqNum: p.mq_num,
            date1: p.date1,
            date2: p.date2,
            label: `✓ MQ#${p.mq_num} — ${dateFormatted} (Done)`,
            status: 'DONE'
        });
    }

    for (let i = 0; i < upcomingSlice.length; i++) {
        const p = upcomingSlice[i];
        const isCurrent = i === 0;
        const status = isCurrent ? 'CURRENT' : 'NOT_DONE';
        const prefix = isCurrent ? '📌' : (i === 1 ? '⚠️' : '⚡');
        const suffix = isCurrent ? '(Current)' : (i === 1 ? '(Not Done)' : '(Next)');
        const dateFormatted = formatFriendlyPair(p.date1, p.date2);
        timelineOptions.push({
            maqalId: p.maqal_id,
            mqNum: p.mq_num,
            date1: p.date1,
            date2: p.date2,
            label: `${prefix} MQ#${p.mq_num} — ${dateFormatted} ${suffix}`,
            status
        });
    }

    const day1Str = pairToShow.date1;
    const day2Str = pairToShow.date2;
    const currentMaqalId = pairToShow.maqal_id;

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
        maqalId: currentMaqalId,
        timelineOptions
    };
};

export const GET = trackApiRoute('/api/customer-daily-entries', async (request: Request) => {
    const { errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customerId');
    const targetMaqalId = searchParams.get('targetMaqalId') ? parseInt(searchParams.get('targetMaqalId')!, 10) : null;

    if (!customerId) {
        return NextResponse.json({ error: 'Customer ID required' }, { status: 400 });
    }

    try {
        const data = await fetchCustomerDailyEntriesData(customerId, targetMaqalId);

        const res = NextResponse.json(data.result, {
            headers: {
                'x-all-unprocessed-dates': JSON.stringify(data.allUnprocessedDates),
                'x-maqal-id': String(data.maqalId),
                'x-timeline-options': JSON.stringify(data.timelineOptions)
            }
        });

        res.headers.set('Cache-Control', 'no-store');
        return res;
    } catch (error: any) {
        console.error('Fetch Customer Daily Entries Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
