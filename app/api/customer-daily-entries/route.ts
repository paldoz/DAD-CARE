import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/require-session';
import { trackApiRoute } from '@/lib/egress-tracker';

import { unstable_cache } from 'next/cache';

const fetchCustomerDailyEntriesData = async (customerId: string) => {
    // 1. Fetch authoritative DailyBook 2-day pairs
    const pairsRes = await pool.query(`
        WITH past_dates AS (
            SELECT DISTINCT date::date as db_date
            FROM "DailyBook"
            WHERE deleted_at IS NULL
        ),
        numbered_dates AS (
            SELECT db_date,
                   ROW_NUMBER() OVER (ORDER BY db_date DESC) as rn
            FROM past_dates
        ),
        pairs AS (
            SELECT n2.db_date::date as date1, n1.db_date::date as date2
            FROM numbered_dates n1
            JOIN numbered_dates n2 ON n1.rn = n2.rn - 1
            WHERE n1.rn % 2 = 1
        ),
        numbered_pairs AS (
            SELECT date1, date2,
                   ROW_NUMBER() OVER (ORDER BY date2 ASC) as mq_num
            FROM pairs
        )
        SELECT mq_num, date1::text as date1, date2::text as date2
        FROM numbered_pairs
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

    // 2. Fetch customer's already processed product dates
    const processedRes = await pool.query(`
        SELECT DISTINCT TO_CHAR((reference_date AT TIME ZONE 'Africa/Mogadishu')::date, 'YYYY-MM-DD') as date_str
        FROM "Ledger"
        WHERE customer_id = $1
          AND type = 'PRODUCT'
          AND deleted_at IS NULL
          AND reference_date IS NOT NULL
    `, [customerId]);

    const processedDates = new Set(processedRes.rows.map(r => r.date_str as string));

    // 3. Find unprocessed pairs
    const unprocessedPairs = allPairs.filter(p => !processedDates.has(p.date1) || !processedDates.has(p.date2));

    const allUnprocessedDates: string[] = [];
    for (const p of unprocessedPairs) {
        allUnprocessedDates.push(p.date1, p.date2);
    }

    // Target pair to show: oldest unprocessed pair if any, or the latest pair
    const pairToShow = unprocessedPairs.length > 0 
        ? unprocessedPairs[0] 
        : (allPairs.length > 0 ? allPairs[allPairs.length - 1] : null);

    const day1Str = pairToShow ? pairToShow.date1 : new Date().toISOString().split('T')[0];
    const day2Str = pairToShow ? pairToShow.date2 : new Date().toISOString().split('T')[0];
    const currentMaqalId = pairToShow ? pairToShow.mq_num : 1;

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
