/**
 * Server-side utility to determine the authoritative active Daily Book date.
 *
 * This mirrors the client-side getNextWorkingDate() logic found in
 * app/daily-book/page-Abdiqani.tsx and verified in __tests__/workday-business-days.test.ts.
 *
 * Rules:
 *   1. Find the latest non-deleted DailyBook date.
 *   2. If none exist, return today's calendar date (matching the client fallback).
 *   3. If one exists, advance by 1 calendar day and skip any ABSENCE dates
 *      from the BusinessDay table.
 *
 * This function is called server-side only and is NEVER influenced by the
 * browser's displayed date or any client-provided date value.
 */

import pool from '@/lib/db';
import { addDays, format, parseISO } from 'date-fns';

export async function getAuthoritativeActiveDailyBookDate(clientOrPool: any = pool): Promise<string> {
    // 1. Fetch latest active (non-deleted) Daily Book date
    const { rows: recent } = await clientOrPool.query(`
        SELECT date::text as date FROM "DailyBook"
        WHERE deleted_at IS NULL
        ORDER BY date DESC
        LIMIT 1
    `);

    // 2. Fallback when no entries exist: today's calendar date
    if (recent.length === 0) {
        return format(new Date(), 'yyyy-MM-dd');
    }

    const lastSavedDateStr = String(recent[0].date).substring(0, 10);

    // 3. Fetch all ABSENCE dates from BusinessDay
    const { rows: bDays } = await clientOrPool.query(`
        SELECT date::text as date FROM "BusinessDay"
        WHERE status = 'ABSENCE'
    `);
    const absenceSet = new Set(bDays.map((b: any) => String(b.date).substring(0, 10)));

    // 4. Advance 1 day at a time, skipping any absence dates
    let current = addDays(parseISO(lastSavedDateStr), 1);
    while (absenceSet.has(format(current, 'yyyy-MM-dd'))) {
        current = addDays(current, 1);
    }

    return format(current, 'yyyy-MM-dd');
}
