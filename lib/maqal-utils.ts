/**
 * Authoritative Maqal Date-Pairing Logic & Validation
 *
 * Rules:
 * 1. Strictly non-overlapping consecutive DailyBook date pairs:
 *    date[0]+date[1], date[2]+date[3], date[4]+date[5]...
 * 2. Anchored from the beginning of time (ORDER BY date ASC) so historical pairs NEVER shift.
 * 3. An odd trailing date remains unpaired until its partner is saved.
 * 4. Automatic validation: every date must appear at most once across all pairs.
 */

export const MAQAL_EPOCH = '2026-07-14';

export function getMaqalIdFromDate(dateStr: string): number {
    const epoch = new Date(`${MAQAL_EPOCH}T00:00:00Z`);
    const d = new Date(`${dateStr.split('T')[0]}T00:00:00Z`);
    const diffDays = Math.floor((d.getTime() - epoch.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return 9;
    return 9 + Math.floor(diffDays / 2);
}

export function getDisplayMqFromMaqalId(maqalId: number): number {
    return maqalId >= 9 ? maqalId - 8 : maqalId;
}

export function getDisplayMqFromDate(dateStr: string): number {
    return getDisplayMqFromMaqalId(getMaqalIdFromDate(dateStr));
}

export function getDatePairFromMaqalId(maqalId: number): { date1: string; date2: string } {
    const epoch = new Date(`${MAQAL_EPOCH}T00:00:00Z`);
    const offsetDays = (maqalId - 9) * 2;
    const d1 = new Date(epoch.getTime() + offsetDays * 24 * 60 * 60 * 1000);
    const d2 = new Date(d1.getTime() + 24 * 60 * 60 * 1000);
    return {
        date1: d1.toISOString().split('T')[0],
        date2: d2.toISOString().split('T')[0]
    };
}

export const MAQAL_PAIRS_CTE = `
    WITH pairs AS (
        SELECT
            (1 + i)::int AS mq_num,
            (('${MAQAL_EPOCH}'::date + (i * 2)))::date AS date1,
            (('${MAQAL_EPOCH}'::date + (i * 2 + 1)))::date AS date2,
            (9 + i)::int AS maqal_id
        FROM generate_series(0, GREATEST(
            CEIL(((CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Mogadishu')::date - '${MAQAL_EPOCH}'::date) / 2.0)::int + 1,
            COALESCE((SELECT CEIL((MAX(date) - '${MAQAL_EPOCH}'::date) / 2.0)::int FROM "DailyBook" WHERE deleted_at IS NULL), 0),
            COALESCE((SELECT CEIL((MAX(reference_date) - '${MAQAL_EPOCH}'::date) / 2.0)::int FROM "Ledger" WHERE deleted_at IS NULL), 0)
        )) AS i
    )
`;

export interface AuthoritativeMqPair {
    mq_num: number;
    date1: string; // YYYY-MM-DD
    date2: string; // YYYY-MM-DD
}

/**
 * Validates that an array of Maqal date pairs contains no overlapping or duplicate dates.
 * Throws an error immediately if any corruption or sliding-window overlap is detected.
 */
export function validateMaqalPairs(pairs: AuthoritativeMqPair[]): void {
    const seenDates = new Map<string, number>(); // date -> mq_num

    for (const pair of pairs) {
        if (!pair.date1 || !pair.date2) {
            throw new Error(`[Maqal Validation Error] MQ#${pair.mq_num} has missing date: date1=${pair.date1}, date2=${pair.date2}`);
        }

        const d1 = pair.date1.split('T')[0];
        const d2 = pair.date2.split('T')[0];

        if (d1 > d2) {
            throw new Error(`[Maqal Validation Error] MQ#${pair.mq_num} has inverted dates: date1=${d1} > date2=${d2}`);
        }

        // Check if date1 was already used in a previous Maqal
        if (seenDates.has(d1)) {
            const prevMq = seenDates.get(d1);
            throw new Error(
                `[Maqal Validation Error] Duplicate date detected! Date ${d1} appears in both MQ#${prevMq} and MQ#${pair.mq_num}. Maqals must be non-overlapping.`
            );
        }
        seenDates.set(d1, pair.mq_num);

        // Check if date2 was already used in a previous Maqal
        if (seenDates.has(d2)) {
            const prevMq = seenDates.get(d2);
            throw new Error(
                `[Maqal Validation Error] Duplicate date detected! Date ${d2} appears in both MQ#${prevMq} and MQ#${pair.mq_num}. Maqals must be non-overlapping.`
            );
        }
        seenDates.set(d2, pair.mq_num);
    }
}

/**
 * Computes non-overlapping pairs from an array of date strings (sorted ASC).
 */
export function computePairsFromDates(dates: string[]): { pairs: AuthoritativeMqPair[]; unpairedDate: string | null } {
    // Unique and sorted ASC
    const uniqueDates = Array.from(new Set(dates.map(d => d.split('T')[0]))).sort();
    const pairs: AuthoritativeMqPair[] = [];

    for (let i = 0; i + 1 < uniqueDates.length; i += 2) {
        pairs.push({
            mq_num: pairs.length + 1,
            date1: uniqueDates[i],
            date2: uniqueDates[i + 1]
        });
    }

    validateMaqalPairs(pairs);

    const unpairedDate = uniqueDates.length % 2 !== 0 ? uniqueDates[uniqueDates.length - 1] : null;

    return { pairs, unpairedDate };
}

/**
 * Fetch and validate authoritative Maqal date pairs from the database.
 */
export async function fetchAuthoritativeMaqalPairs(client: any): Promise<AuthoritativeMqPair[]> {
    const result = await client.query(`
        ${MAQAL_PAIRS_CTE}
        SELECT mq_num, date1::text, date2::text
        FROM pairs
        ORDER BY mq_num ASC;
    `);

    const pairs: AuthoritativeMqPair[] = result.rows.map((r: any) => ({
        mq_num: Number(r.mq_num),
        date1: String(r.date1).split('T')[0],
        date2: String(r.date2).split('T')[0]
    }));

    validateMaqalPairs(pairs);

    return pairs;
}

export interface CustomerMaqalState {
    /** The maqal_id that Auto (Oldest First) selects. Never null. */
    autoMaqalId: number;
    /** date1 of the Auto-selected pair */
    autoDate1: string;
    /** date2 of the Auto-selected pair */
    autoDate2: string;
    /** MQ display number (maqal_id - 8) of the Auto-selected pair */
    autoMqNum: number;
    /** Number of unfinished Maqals (capped at 2 for UI) */
    warningCount: number;
    /** Up to 2 unfinished pairs with exact dates, for the warning badges */
    unfinishedMaqals: Array<{ maqalId: number; mqNum: number; date1: string; date2: string }>;
    /** Final debt after save */
    finalDebt: number;
    /** The saved Maqal ID */
    savedMaqalId: number;
    /** Timeline selector options (4 items: 2 done + 2 upcoming) */
    timelineOptions: Array<{
        maqalId: number;
        mqNum: number;
        date1: string;
        date2: string;
        label: string;
        status: 'DONE' | 'CURRENT' | 'NOT_DONE' | 'WAITING';
    }>;
    /** Flat list of unprocessed date strings for existing allUnprocessedDates state */
    allUnprocessedDates: string[];
}

/**
 * SERVER-AUTHORITATIVE: Compute the full Maqal state for a customer after a save.
 * Called inside /api/ledger POST after COMMIT.
 * Returns everything the UI needs to render the next state without a second HTTP round-trip.
 */
export async function getCustomerNextMaqalState(
    pool: any,
    customerId: string,
    savedMaqalId: number,
    finalDebt: number
): Promise<CustomerMaqalState> {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const formatFriendly = (d1: string, d2: string) => {
        const p1 = d1.split('-');
        const p2 = d2.split('-');
        const m1 = months[parseInt(p1[1], 10) - 1] || p1[1];
        const day1 = parseInt(p1[2], 10);
        const m2 = months[parseInt(p2[1], 10) - 1] || p2[1];
        const day2 = parseInt(p2[2], 10);
        return `${m1} ${day1} & ${m2} ${day2}`;
    };

    // 1. Get authoritative calendar pairs (independent of DailyBook)
    const pairsRes = await pool.query(`
        ${MAQAL_PAIRS_CTE}
        SELECT mq_num, date1::text as date1, date2::text as date2, maqal_id
        FROM pairs
        ORDER BY mq_num ASC;
    `);

    const allPairs = pairsRes.rows.map((r: any) => ({
        mq_num: Number(r.mq_num),
        date1: String(r.date1).split('T')[0],
        date2: String(r.date2).split('T')[0],
        maqal_id: Number(r.maqal_id)
    }));

    // 2. Get processed maqal_ids for this customer
    const processedRes = await pool.query(`
        SELECT DISTINCT
            COALESCE(maqal_id, (9 + FLOOR((COALESCE(reference_date::date, created_at::date) - $2::date) / 2))::int) AS maqal_id
        FROM "Ledger"
        WHERE customer_id = $1
          AND type = 'PRODUCT'
          AND deleted_at IS NULL
    `, [customerId, MAQAL_EPOCH]);

    const processedMaqalIds = new Set<number>(processedRes.rows.map((r: any) => Number(r.maqal_id)));

    // 3. Get customer start date — use LEAST across all sources (same logic as /api/customer-daily-entries)
    const startRes = await pool.query(`
        SELECT LEAST(
            (c.created_at AT TIME ZONE 'Africa/Mogadishu')::date,
            COALESCE((SELECT MIN(reference_date::date) FROM "Ledger" WHERE customer_id = $1 AND deleted_at IS NULL), 'infinity'::date),
            COALESCE((SELECT MIN(db.date::date) FROM "DailyBookItem" dbi JOIN "DailyBook" db ON dbi.daily_book_id = db.id WHERE dbi.customer_id = $1 AND dbi.deleted_at IS NULL AND db.deleted_at IS NULL), 'infinity'::date)
        )::text AS start_date
        FROM "Customer" c
        WHERE c.id = $1
    `, [customerId]);

    const startDate: string | null = startRes.rows[0]?.start_date || null;

    // 4. Filter to eligible pairs (after customer start date)
    // NOTE: Do NOT filter by today — the Maqal calendar is authoritative.
    // A customer with DailyBook entries for Aug 25-26 must be able to process MQ#22
    // even if date1 (Aug 25) has already passed or is approaching.
    const eligiblePairs = allPairs.filter((p: any) =>
        !startDate || p.date2 >= startDate
    );

    const unprocessedPairs = eligiblePairs.filter((p: any) => !processedMaqalIds.has(p.maqal_id));
    const processedPairs = eligiblePairs.filter((p: any) => processedMaqalIds.has(p.maqal_id));

    // 5. Determine Auto target: oldest unfinished, or latest pair if all done
    const autoPair = unprocessedPairs.length > 0
        ? unprocessedPairs[0]
        : allPairs[allPairs.length - 1];

    // 6. Build unfinished list (up to 2 for warning badges)
    const unfinishedMaqals = unprocessedPairs.slice(0, 2).map((p: any) => ({
        maqalId: p.maqal_id,
        mqNum: p.mq_num,
        date1: p.date1,
        date2: p.date2
    }));

    // 7. Build timeline options (2 done + 2 upcoming = 4 total)
    const completedSlice = processedPairs.slice(-2);
    const neededUpcoming = Math.max(2, 4 - completedSlice.length);
    const upcomingSlice = unprocessedPairs.slice(0, neededUpcoming);
    const finalCompleted = processedPairs.slice(-Math.max(completedSlice.length, 4 - upcomingSlice.length));

    const timelineOptions: CustomerMaqalState['timelineOptions'] = [];
    for (const p of finalCompleted) {
        timelineOptions.push({
            maqalId: p.maqal_id,
            mqNum: p.mq_num,
            date1: p.date1,
            date2: p.date2,
            label: `✓ MQ#${p.mq_num} — ${formatFriendly(p.date1, p.date2)} (Done)`,
            status: 'DONE'
        });
    }
    for (let i = 0; i < upcomingSlice.length; i++) {
        const p = upcomingSlice[i];
        const isCurrent = i === 0;
        const prefix = isCurrent ? '📌' : (i === 1 ? '⚠️' : '⚡');
        const suffix = isCurrent ? '(Current)' : (i === 1 ? '(Not Done)' : '(Next)');
        timelineOptions.push({
            maqalId: p.maqal_id,
            mqNum: p.mq_num,
            date1: p.date1,
            date2: p.date2,
            label: `${prefix} MQ#${p.mq_num} — ${formatFriendly(p.date1, p.date2)} ${suffix}`,
            status: isCurrent ? 'CURRENT' : 'NOT_DONE'
        });
    }

    // 8. Build flat allUnprocessedDates
    const allUnprocessedDates: string[] = [];
    for (const p of unprocessedPairs) {
        allUnprocessedDates.push(p.date1, p.date2);
    }

    return {
        autoMaqalId: autoPair.maqal_id,
        autoDate1: autoPair.date1,
        autoDate2: autoPair.date2,
        autoMqNum: autoPair.mq_num,
        warningCount: unprocessedPairs.length,
        unfinishedMaqals,
        finalDebt,
        savedMaqalId,
        timelineOptions,
        allUnprocessedDates
    };
}

