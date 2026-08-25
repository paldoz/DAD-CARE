const assert = require('assert');

function validateMaqalPairs(pairs) {
    const seenDates = new Map();

    for (const pair of pairs) {
        if (!pair.date1 || !pair.date2) {
            throw new Error(`[Maqal Validation Error] MQ#${pair.mq_num} has missing date: date1=${pair.date1}, date2=${pair.date2}`);
        }

        const d1 = pair.date1.split('T')[0];
        const d2 = pair.date2.split('T')[0];

        if (d1 > d2) {
            throw new Error(`[Maqal Validation Error] MQ#${pair.mq_num} has inverted dates: date1=${d1} > date2=${d2}`);
        }

        if (seenDates.has(d1)) {
            const prevMq = seenDates.get(d1);
            throw new Error(
                `[Maqal Validation Error] Duplicate date detected! Date ${d1} appears in both MQ#${prevMq} and MQ#${pair.mq_num}. Maqals must be non-overlapping.`
            );
        }
        seenDates.set(d1, pair.mq_num);

        if (seenDates.has(d2)) {
            const prevMq = seenDates.get(d2);
            throw new Error(
                `[Maqal Validation Error] Duplicate date detected! Date ${d2} appears in both MQ#${prevMq} and MQ#${pair.mq_num}. Maqals must be non-overlapping.`
            );
        }
        seenDates.set(d2, pair.mq_num);
    }
}

function computePairsFromDates(dates) {
    const uniqueDates = Array.from(new Set(dates.map(d => d.split('T')[0]))).sort();
    const pairs = [];

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

function runTests() {
    console.log("===============================================================================");
    console.log("                   MAQAL DATE-PAIRING REGRESSION TESTS                         ");
    console.log("===============================================================================\n");

    // Test 1: Even dates [Aug 21, Aug 22, Aug 23, Aug 24]
    console.log("Test 1: 4 consecutive dates [Aug 21, Aug 22, Aug 23, Aug 24]");
    const res1 = computePairsFromDates(['2026-08-21', '2026-08-22', '2026-08-23', '2026-08-24']);
    assert.strictEqual(res1.pairs.length, 2);
    assert.strictEqual(res1.pairs[0].date1, '2026-08-21');
    assert.strictEqual(res1.pairs[0].date2, '2026-08-22');
    assert.strictEqual(res1.pairs[1].date1, '2026-08-23');
    assert.strictEqual(res1.pairs[1].date2, '2026-08-24');
    assert.strictEqual(res1.unpairedDate, null);
    console.log("  MQ#1 -> Aug 21-22  [PASS]");
    console.log("  MQ#2 -> Aug 23-24  [PASS]");
    console.log("  Unpaired: None     [PASS]\n");

    // Test 2: Odd dates [Aug 21, Aug 22, Aug 23]
    console.log("Test 2: 3 dates [Aug 21, Aug 22, Aug 23] - Aug 23 must remain unpaired");
    const res2 = computePairsFromDates(['2026-08-21', '2026-08-22', '2026-08-23']);
    assert.strictEqual(res2.pairs.length, 1);
    assert.strictEqual(res2.pairs[0].date1, '2026-08-21');
    assert.strictEqual(res2.pairs[0].date2, '2026-08-22');
    assert.strictEqual(res2.unpairedDate, '2026-08-23');
    console.log("  MQ#1 -> Aug 21-22        [PASS]");
    console.log("  Unpaired: Aug 23         [PASS]");
    console.log("  No Aug 22-23 formed      [PASS]\n");

    // Test 3: Historical Stability
    console.log("Test 3: Historical Stability when adding days sequentially");
    const baseDates = ['2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17'];
    const rBase = computePairsFromDates(baseDates);
    assert.strictEqual(rBase.pairs[0].date1, '2026-07-14');
    assert.strictEqual(rBase.pairs[0].date2, '2026-07-15');
    assert.strictEqual(rBase.pairs[1].date1, '2026-07-16');
    assert.strictEqual(rBase.pairs[1].date2, '2026-07-17');

    // Add 5th date
    const rAdd1 = computePairsFromDates([...baseDates, '2026-07-18']);
    assert.strictEqual(rAdd1.pairs.length, 2);
    assert.strictEqual(rAdd1.pairs[0].date1, '2026-07-14', 'MQ#1 must not change');
    assert.strictEqual(rAdd1.pairs[0].date2, '2026-07-15', 'MQ#1 must not change');
    assert.strictEqual(rAdd1.pairs[1].date1, '2026-07-16', 'MQ#2 must not change');
    assert.strictEqual(rAdd1.pairs[1].date2, '2026-07-17', 'MQ#2 must not change');
    assert.strictEqual(rAdd1.unpairedDate, '2026-07-18');
    console.log("  Added Jul 18 (odd) -> MQ#1 and MQ#2 preserved unchanged [PASS]");

    // Add 6th date
    const rAdd2 = computePairsFromDates([...baseDates, '2026-07-18', '2026-07-19']);
    assert.strictEqual(rAdd2.pairs.length, 3);
    assert.strictEqual(rAdd2.pairs[0].date1, '2026-07-14');
    assert.strictEqual(rAdd2.pairs[1].date1, '2026-07-16');
    assert.strictEqual(rAdd2.pairs[2].date1, '2026-07-18');
    assert.strictEqual(rAdd2.pairs[2].date2, '2026-07-19');
    console.log("  Added Jul 19 (even) -> MQ#3 formed: Jul 18-19 [PASS]\n");

    // Test 4: Validation detects overlapping pairs
    console.log("Test 4: Validation correctly throws error on overlapping pair input");
    let errorCaught = false;
    try {
        validateMaqalPairs([
            { mq_num: 27, date1: '2026-08-21', date2: '2026-08-22' },
            { mq_num: 28, date1: '2026-08-22', date2: '2026-08-23' } // Overlap!
        ]);
    } catch (e) {
        errorCaught = true;
        console.log(`  Caught expected error: "${e.message}" [PASS]\n`);
    }
    assert.strictEqual(errorCaught, true, "Must throw on overlapping pairs");

    console.log("===============================================================================");
    console.log("                     ALL UNIT TESTS PASSED (4/4)                               ");
    console.log("===============================================================================\n");
}

runTests();
