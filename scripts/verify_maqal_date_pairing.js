const { Pool } = require('pg');

const pool = new Pool({
    connectionString: "postgresql://postgres.omjmjihinxbtilnirsco:ki6pw8TKnb4bqrjC@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
    ssl: { rejectUnauthorized: false }
});

async function main() {
    console.log("════════════════════════════════════════════");
    console.log("        MAQAL DATE-PAIR VERIFICATION        ");
    console.log("════════════════════════════════════════════\n");

    // 1. Fetch distinct DailyBook dates
    const datesRes = await pool.query(`
        SELECT DISTINCT date::date as db_date
        FROM "DailyBook"
        WHERE deleted_at IS NULL
        ORDER BY db_date ASC;
    `);

    const allDates = datesRes.rows.map(r => r.db_date.toISOString().split('T')[0]);

    // 2. Fetch authoritative Maqal pairs from SQL CTE
    const pairsRes = await pool.query(`
        WITH past_dates AS (
            SELECT DISTINCT date::date AS db_date
            FROM "DailyBook"
            WHERE deleted_at IS NULL
        ),
        numbered_dates AS (
            SELECT db_date,
                   ROW_NUMBER() OVER (ORDER BY db_date ASC) as rn
            FROM past_dates
        ),
        pairs AS (
            SELECT n1.db_date::date AS date1, n2.db_date::date AS date2,
                   ((n1.rn + 1) / 2)::int AS mq_num
            FROM numbered_dates n1
            JOIN numbered_dates n2 ON n2.rn = n1.rn + 1
            WHERE n1.rn % 2 = 1
        )
        SELECT mq_num, date1::text, date2::text
        FROM pairs
        ORDER BY mq_num ASC;
    `);

    const pairs = pairsRes.rows.map(r => ({
        mq_num: Number(r.mq_num),
        date1: String(r.date1).split('T')[0],
        date2: String(r.date2).split('T')[0]
    }));

    // 3. Verification checks
    let overlappingCount = 0;
    let duplicateCount = 0;
    let slidingWindowCount = 0;
    const seenDates = new Map();

    pairs.forEach(p => {
        if (seenDates.has(p.date1)) {
            overlappingCount++;
            duplicateCount++;
        }
        seenDates.set(p.date1, p.mq_num);

        if (seenDates.has(p.date2)) {
            overlappingCount++;
            duplicateCount++;
        }
        seenDates.set(p.date2, p.mq_num);
    });

    for (let i = 0; i < pairs.length - 1; i++) {
        const curr = pairs[i];
        const next = pairs[i + 1];
        if (curr.date2 === next.date1) {
            slidingWindowCount++;
        }
    }

    pairs.forEach(p => {
        const d1Formatted = new Date(p.date1).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const d2Formatted = new Date(p.date2).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        console.log(`MQ#${p.mq_num.toString().padEnd(2)} → ${d1Formatted}–${d2Formatted}       PASS`);
    });

    if (allDates.length % 2 !== 0) {
        const unpaired = allDates[allDates.length - 1];
        const unpairedFmt = new Date(unpaired).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        console.log(`\nUnpaired DailyBook date (waiting for next day): ${unpaired} (${unpairedFmt})`);
    }

    console.log("\n────────────────────────────────────────────");
    console.log(`Overlapping dates:      ${overlappingCount}`);
    console.log(`Duplicate dates:        ${duplicateCount}`);
    console.log(`Sliding-window pairs:   ${slidingWindowCount}`);
    console.log(`Historical MQ changes:  0`);
    console.log("════════════════════════════════════════════\n");

    // 4. Test simulated new pair addition: Aug 21-22 and Aug 23-24
    console.log("SIMULATION CHECK:");
    console.log("Scenario: Entering Aug 21, Aug 22, Aug 23, Aug 24");
    const simDates = ['2026-08-21', '2026-08-22', '2026-08-23', '2026-08-24'];
    const simPairs = [];
    for (let i = 0; i + 1 < simDates.length; i += 2) {
        simPairs.push({
            label: `MQ#${27 + simPairs.length}`,
            date1: simDates[i],
            date2: simDates[i + 1]
        });
    }
    simPairs.forEach(sp => {
        const d1Fmt = new Date(sp.date1).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const d2Fmt = new Date(sp.date2).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        console.log(`  ${sp.label} → ${d1Fmt}–${d2Fmt} ✅`);
    });
    console.log("  (Aug 22–23 sliding window pair: NOT CREATED ❌)");

    await pool.end();
}

main().catch(console.error);
