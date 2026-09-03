import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { MAQAL_EPOCH, computeWorkingDatePairs, validateMaqalPairs } from '../lib/maqal-utils';

describe('Authoritative Maqal Holiday-Aware Pairing & Immutability Verification', () => {

    test('TEST 1: Historical Maqals (MQ#1..MQ#24) are strictly locked to original timeline', () => {
        const pairs = computeWorkingDatePairs({ absenceDates: ['2026-09-01'] });

        assert.ok(pairs.length >= 27, 'Should produce at least 27 pairs');
        assert.strictEqual(MAQAL_EPOCH, '2026-07-14', 'Authoritative MAQAL_EPOCH is 2026-07-14');

        const mq1 = pairs.find(p => p.mq_num === 1);
        const mq23 = pairs.find(p => p.mq_num === 23);
        const mq24 = pairs.find(p => p.mq_num === 24);

        assert.ok(mq1, 'MQ#1 must exist');
        assert.strictEqual(mq1.date1, '2026-07-14', 'MQ#1 date1 must be 2026-07-14');
        assert.strictEqual(mq1.date2, '2026-07-15', 'MQ#1 date2 must be 2026-07-15');

        assert.ok(mq23, 'MQ#23 must exist');
        assert.strictEqual(mq23.date1, '2026-08-27', 'MQ#23 date1 must be 2026-08-27');
        assert.strictEqual(mq23.date2, '2026-08-28', 'MQ#23 date2 must be 2026-08-28');

        assert.ok(mq24, 'MQ#24 must exist');
        assert.strictEqual(mq24.date1, '2026-08-29', 'MQ#24 date1 must be 2026-08-29');
        assert.strictEqual(mq24.date2, '2026-08-30', 'MQ#24 date2 must be 2026-08-30');
    });

    test('TEST 2: Code-Safe Retroactive Absence Immunity (historical pairs never change)', () => {
        // Even if someone marks historical dates (e.g. 2026-08-27, 2026-08-29, 2026-07-20) as ABSENCE:
        const pairsWithPastAbsence = computeWorkingDatePairs({
            absenceDates: ['2026-07-20', '2026-08-27', '2026-08-29', '2026-09-01']
        });

        const mq23 = pairsWithPastAbsence.find(p => p.mq_num === 23);
        const mq24 = pairsWithPastAbsence.find(p => p.mq_num === 24);

        assert.ok(mq23 && mq24);
        assert.strictEqual(mq23.date1, '2026-08-27', 'MQ#23 date1 MUST remain 2026-08-27 despite retroactive absence');
        assert.strictEqual(mq23.date2, '2026-08-28', 'MQ#23 date2 MUST remain 2026-08-28 despite retroactive absence');
        assert.strictEqual(mq24.date1, '2026-08-29', 'MQ#24 date1 MUST remain 2026-08-29 despite retroactive absence');
        assert.strictEqual(mq24.date2, '2026-08-30', 'MQ#24 date2 MUST remain 2026-08-30 despite retroactive absence');
    });

    test('TEST 3: Future Holiday Skip — MQ#25 resolves to 31 Aug + 2 Sep when Sep 1 is ABSENCE', () => {
        const pairs = computeWorkingDatePairs({ absenceDates: ['2026-09-01'] });
        const mq25 = pairs.find(p => p.mq_num === 25);

        assert.ok(mq25, 'MQ#25 must exist');
        assert.strictEqual(mq25.date1, '2026-08-31', 'MQ#25 date1 must be 2026-08-31');
        assert.strictEqual(mq25.date2, '2026-09-02', 'MQ#25 date2 must be 2026-09-02 (skipping Sep 1)');
    });

    test('TEST 4: Sequence Continuity — MQ#26 and MQ#27 follow seamlessly', () => {
        const pairs = computeWorkingDatePairs({ absenceDates: ['2026-09-01'] });

        const mq26 = pairs.find(p => p.mq_num === 26);
        const mq27 = pairs.find(p => p.mq_num === 27);

        assert.ok(mq26, 'MQ#26 must exist');
        assert.strictEqual(mq26.date1, '2026-09-03', 'MQ#26 date1 must be 2026-09-03');
        assert.strictEqual(mq26.date2, '2026-09-04', 'MQ#26 date2 must be 2026-09-04');

        assert.ok(mq27, 'MQ#27 must exist');
        assert.strictEqual(mq27.date1, '2026-09-05', 'MQ#27 date1 must be 2026-09-05');
        assert.strictEqual(mq27.date2, '2026-09-06', 'MQ#27 date2 must be 2026-09-06');
    });

    test('TEST 5: Multiple Consecutive Holidays — generic multi-day skip', () => {
        // Both Sep 1 and Sep 2 are ABSENCE:
        const pairs = computeWorkingDatePairs({ absenceDates: ['2026-09-01', '2026-09-02'] });

        const mq25 = pairs.find(p => p.mq_num === 25);
        const mq26 = pairs.find(p => p.mq_num === 26);

        assert.ok(mq25 && mq26);
        assert.strictEqual(mq25.date1, '2026-08-31', 'MQ#25 date1 is 2026-08-31');
        assert.strictEqual(mq25.date2, '2026-09-03', 'MQ#25 date2 skips both Sep 1 and Sep 2 to become 2026-09-03');

        assert.strictEqual(mq26.date1, '2026-09-04', 'MQ#26 date1 is 2026-09-04');
        assert.strictEqual(mq26.date2, '2026-09-05', 'MQ#26 date2 is 2026-09-05');
    });

    test('TEST 6: Saved Activity Lock — once recorded in DailyBook/Ledger, date cannot be removed by retroactive absence', () => {
        // MQ#25 is Aug 31 + Sep 2. If Sep 2 has recorded entries, and later someone marks Sep 2 as ABSENCE:
        const pairs = computeWorkingDatePairs({
            absenceDates: ['2026-09-01', '2026-09-02'],
            recordedDates: ['2026-09-02'] // Recorded activity overrides absence!
        });

        const mq25 = pairs.find(p => p.mq_num === 25);
        assert.ok(mq25);
        assert.strictEqual(mq25.date1, '2026-08-31');
        assert.strictEqual(mq25.date2, '2026-09-02', 'Sep 2 is protected by Saved Activity Lock');
    });

    test('TEST 7: Generic Future Holiday Skip — future holiday on Sep 10 is skipped generically', () => {
        const pairs = computeWorkingDatePairs({ absenceDates: ['2026-09-01', '2026-09-10'] });

        // MQ#25: Aug 31 + Sep 2
        // MQ#26: Sep 3 + Sep 4
        // MQ#27: Sep 5 + Sep 6
        // MQ#28: Sep 7 + Sep 8
        // MQ#29: Sep 9 + Sep 11 (skipping Sep 10)
        const mq29 = pairs.find(p => p.mq_num === 29);
        assert.ok(mq29);
        assert.strictEqual(mq29.date1, '2026-09-09');
        assert.strictEqual(mq29.date2, '2026-09-11', 'MQ#29 date2 skips Sep 10 to reach Sep 11');
    });

    test('TEST 8: Non-Overlapping Invariant — validateMaqalPairs confirms zero gaps/overlaps', () => {
        const pairs = computeWorkingDatePairs({ absenceDates: ['2026-09-01', '2026-09-10'] });
        assert.doesNotThrow(() => validateMaqalPairs(pairs), 'All generated pairs must be strictly valid and non-overlapping');
    });

    test('TEST 9: Date-Specific Pricing Invariant — Previous pair for MQ#25 is MQ#24 (Aug 29 + Aug 30)', () => {
        // When Sep 1 = ABSENCE:
        const pairs = computeWorkingDatePairs({ absenceDates: ['2026-09-01'] });
        
        // Active pair is MQ#25:
        const activeIdx = pairs.findIndex(p => p.mq_num === 25);
        assert.ok(activeIdx > 0, 'MQ#25 must be present and not the first pair');
        
        const activePair = pairs[activeIdx];
        assert.strictEqual(activePair.date1, '2026-08-31', 'Active MQ#25 date1 is Aug 31');
        assert.strictEqual(activePair.date2, '2026-09-02', 'Active MQ#25 date2 is Sep 02');

        // Immediately preceding pair is MQ#24:
        const prevPair = pairs[activeIdx - 1];
        assert.ok(prevPair, 'Previous pair must exist');
        assert.strictEqual(prevPair.mq_num, 24, 'Previous pair is MQ#24');
        assert.strictEqual(prevPair.date1, '2026-08-29', 'Previous MQ#24 date1 is Aug 29');
        assert.strictEqual(prevPair.date2, '2026-08-30', 'Previous MQ#24 date2 MUST be Aug 30 (NOT Aug 31)');

        // Date-Specific Pricing allowedDates exposure:
        // [New Day 2, New Day 1, Old Day 2, Old Day 1]
        const allowedDates = [
            activePair.date2,
            activePair.date1,
            prevPair.date2,
            prevPair.date1
        ];

        assert.deepStrictEqual(allowedDates, [
            '2026-09-02', // New Day 2
            '2026-08-31', // New Day 1
            '2026-08-30', // Old Day 2 (correct MQ#24, never corrupted by calendar arithmetic)
            '2026-08-29'  // Old Day 1 (correct MQ#24)
        ]);
    });

    test('TEST 10: Customers Page pair_date1/pair_date2 — Sep 1 ABSENCE yields MQ#25 = Aug 31 + Sep 2 (not Sep 1)', () => {
        // This test verifies the exact invariant that the Customers API now uses.
        // Before the fix, app/api/customers/route.ts computed pair_date1/pair_date2 using raw
        // epoch arithmetic: '2026-06-28'::date + (offset/2*2), producing Sep 1 instead of Sep 2.
        // After the fix it reads from MAQAL_PAIRS_CTE which respects BusinessDay ABSENCE.

        const pairs = computeWorkingDatePairs({ absenceDates: ['2026-09-01'] });

        // The "latest" authoritative pair is the one with the highest mq_num covering today/future.
        // Simulate what the customers API NOW does: ORDER BY mq_num DESC LIMIT 1
        const sortedDesc = pairs.slice().sort((a, b) => b.mq_num - a.mq_num);
        const targetPair = sortedDesc.find(p => p.date1 >= '2026-08-31');

        assert.ok(targetPair, 'A future-covering target pair must exist');

        // Specifically MQ#25 should be the active pair around Sep 2026
        const mq25 = pairs.find(p => p.mq_num === 25);
        assert.ok(mq25, 'MQ#25 must exist');
        assert.strictEqual(mq25.date1, '2026-08-31',
            'Customers page pair_date1 for MQ#25 MUST be 2026-08-31');
        assert.strictEqual(mq25.date2, '2026-09-02',
            'Customers page pair_date2 for MQ#25 MUST be 2026-09-02 (NOT 2026-09-01)');

        // Negative assertion: the old calendar arithmetic would have produced Sep 1
        assert.notStrictEqual(mq25.date2, '2026-09-01',
            'pair_date2 must NOT be 2026-09-01 — that was the legacy epoch-arithmetic bug');
    });
});
