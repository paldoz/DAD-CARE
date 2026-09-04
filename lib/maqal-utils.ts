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

export const MAQAL_PAIRS_CTE = `
    WITH historical_pairs AS (
        SELECT
            (1 + i)::int AS mq_num,
            (('${MAQAL_EPOCH}'::date + (i * 2)))::date AS date1,
            (('${MAQAL_EPOCH}'::date + (i * 2 + 1)))::date AS date2,
            (9 + i)::int AS maqal_id
        FROM generate_series(0, 23) AS i
    ),
    recorded_dates AS (
        SELECT DISTINCT date::date AS d FROM "DailyBook" WHERE deleted_at IS NULL AND date >= '2026-08-31'::date
        UNION
        SELECT DISTINCT reference_date::date AS d FROM "Ledger" WHERE type = 'PRODUCT' AND deleted_at IS NULL AND reference_date >= '2026-08-31'::date
    ),
    effective_absence AS (
        SELECT b.date::date AS d
        FROM "BusinessDay" b
        WHERE b.status = 'ABSENCE'
          AND b.date >= '2026-08-31'::date
          AND b.date::date NOT IN (SELECT d FROM recorded_dates)
    ),
    future_calendar AS (
        SELECT ('2026-08-31'::date + s)::date AS cal_date
        FROM generate_series(0, GREATEST(
            ((CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Mogadishu')::date - '2026-08-31'::date) + 60,
            COALESCE((SELECT (MAX(date) - '2026-08-31'::date)::int + 10 FROM "DailyBook" WHERE deleted_at IS NULL), 0),
            COALESCE((SELECT (MAX(reference_date) - '2026-08-31'::date)::int + 10 FROM "Ledger" WHERE deleted_at IS NULL), 0),
            60
        )) AS s
    ),
    future_working_dates AS (
        SELECT
            cal_date,
            ROW_NUMBER() OVER (ORDER BY cal_date ASC) AS rn
        FROM future_calendar
        WHERE cal_date NOT IN (SELECT d FROM effective_absence)
    ),
    future_pairs AS (
        SELECT
            (24 + CEIL(w1.rn / 2.0))::int AS mq_num,
            w1.cal_date AS date1,
            w2.cal_date AS date2,
            (32 + CEIL(w1.rn / 2.0))::int AS maqal_id
        FROM future_working_dates w1
        JOIN future_working_dates w2 ON w2.rn = w1.rn + 1
        WHERE w1.rn % 2 = 1
    ),
    pairs AS (
        SELECT mq_num, date1, date2, maqal_id FROM historical_pairs
        UNION ALL
        SELECT mq_num, date1, date2, maqal_id FROM future_pairs
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

/**
 * Pure TypeScript reference implementation of the authoritative two-phase Maqal pairing engine.
 * Matches MAQAL_PAIRS_CTE 1-to-1 without requiring database access.
 */
export function computeWorkingDatePairs(options?: {
    absenceDates?: string[];
    recordedDates?: string[];
    futureDaysCount?: number;
}): AuthoritativeMqPair[] {
    const absenceSet = new Set((options?.absenceDates || []).map(d => d.split('T')[0]));
    const recordedSet = new Set((options?.recordedDates || []).map(d => d.split('T')[0]));
    const futureDays = options?.futureDaysCount ?? 60;

    const pairs: AuthoritativeMqPair[] = [];

    // Phase 1: Historical Maqals (MQ#1 through MQ#24) — permanently locked
    const epochDate = new Date(`${MAQAL_EPOCH}T00:00:00Z`);
    for (let i = 0; i < 24; i++) {
        const d1 = new Date(epochDate.getTime() + (i * 2) * 86400000).toISOString().split('T')[0];
        const d2 = new Date(epochDate.getTime() + (i * 2 + 1) * 86400000).toISOString().split('T')[0];
        pairs.push({
            mq_num: i + 1,
            date1: d1,
            date2: d2
        });
    }

    // Phase 2: Future / Working dates starting from 2026-08-31
    const phase2Start = new Date('2026-08-31T00:00:00Z');
    const workingDates: string[] = [];

    for (let s = 0; s < futureDays; s++) {
        const d = new Date(phase2Start.getTime() + s * 86400000).toISOString().split('T')[0];
        // Saved Activity Lock: if recorded, it's always worked. Otherwise, skip if absent.
        const isRecorded = recordedSet.has(d);
        const isAbsent = absenceSet.has(d) && !isRecorded;
        if (!isAbsent) {
            workingDates.push(d);
        }
    }

    for (let i = 0; i + 1 < workingDates.length; i += 2) {
        pairs.push({
            mq_num: pairs.length + 1,
            date1: workingDates[i],
            date2: workingDates[i + 1]
        });
    }

    validateMaqalPairs(pairs);
    return pairs;
}

export interface ResolvedMaqalIdentity {
    mq_num: number;
    maqal_id: number;
    date1: string;
    date2: string;
}

/**
 * Authoritatively resolves the Maqal (both mq_num and DB maqal_id) for a reference date.
 * Queries MAQAL_PAIRS_CTE. Returns ResolvedMaqalIdentity or null if the date is not part of any working pair.
 */
export async function resolveMaqalFromDate(
    dateStr: string,
    client: any
): Promise<ResolvedMaqalIdentity | null> {
    if (!dateStr) return null;
    const cleanDate = dateStr.split('T')[0];
    const res = await client.query(`
        ${MAQAL_PAIRS_CTE}
        SELECT mq_num, maqal_id, date1::text as date1, date2::text as date2
        FROM pairs
        WHERE $1::date IN (date1, date2)
        LIMIT 1;
    `, [cleanDate]);

    if (res.rows.length === 0) return null;
    return {
        mq_num: Number(res.rows[0].mq_num),
        maqal_id: Number(res.rows[0].maqal_id),
        date1: String(res.rows[0].date1).split('T')[0],
        date2: String(res.rows[0].date2).split('T')[0]
    };
}
