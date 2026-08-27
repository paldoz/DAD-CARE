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
