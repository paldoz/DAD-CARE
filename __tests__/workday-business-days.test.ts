import test from 'node:test';
import assert from 'node:assert/strict';
import { format, addDays, parseISO } from 'date-fns';
import pool from '../lib/db';
import { fetchAuthoritativeMaqalPairs } from '../lib/maqal-utils';

function getNextWorkingDate(lastSavedDateStr: string | null, bDays: Array<{ date: string; status: string }>): Date {
    if (!lastSavedDateStr) return new Date();
    const absenceSet = new Set(
        (bDays || []).filter(b => b.status === 'ABSENCE').map(b => String(b.date).substring(0, 10))
    );
    let current = addDays(parseISO(lastSavedDateStr), 1);
    while (absenceSet.has(format(current, 'yyyy-MM-dd'))) {
        current = addDays(current, 1);
    }
    return current;
}

test('Safety Invariant 1: Maqal pair generation is holiday-aware and preserves historical anchors', async () => {
    const pairs = await fetchAuthoritativeMaqalPairs(pool);
    assert.ok(pairs.length > 0, 'Should return authoritative pairs');

    const mq23 = pairs.find(p => p.mq_num === 23);
    const mq24 = pairs.find(p => p.mq_num === 24);
    const mq25 = pairs.find(p => p.mq_num === 25);
    const mq26 = pairs.find(p => p.mq_num === 26);
    const mq27 = pairs.find(p => p.mq_num === 27);

    assert.ok(mq23, 'MQ#23 must exist');
    assert.ok(mq24, 'MQ#24 must exist');
    assert.ok(mq25, 'MQ#25 must exist');
    assert.ok(mq26, 'MQ#26 must exist');
    assert.ok(mq27, 'MQ#27 must exist');

    assert.strictEqual(mq23.date1, '2026-08-27', 'MQ#23 date1 must be 2026-08-27');
    assert.strictEqual(mq23.date2, '2026-08-28', 'MQ#23 date2 must be 2026-08-28');

    assert.strictEqual(mq24.date1, '2026-08-29', 'MQ#24 date1 must be 2026-08-29');
    assert.strictEqual(mq24.date2, '2026-08-30', 'MQ#24 date2 must be 2026-08-30');

    // With 2026-09-01 as ABSENCE in BusinessDay, MQ#25 skips Sep 1:
    assert.strictEqual(mq25.date1, '2026-08-31', 'MQ#25 date1 must be 2026-08-31');
    assert.strictEqual(mq25.date2, '2026-09-02', 'MQ#25 date2 must be 2026-09-02');

    assert.strictEqual(mq26.date1, '2026-09-03', 'MQ#26 date1 must be 2026-09-03');
    assert.strictEqual(mq26.date2, '2026-09-04', 'MQ#26 date2 must be 2026-09-04');

    assert.strictEqual(mq27.date1, '2026-09-05', 'MQ#27 date1 must be 2026-09-05');
    assert.strictEqual(mq27.date2, '2026-09-06', 'MQ#27 date2 must be 2026-09-06');
});

test('Safety Invariant 2: Daily Book sequence calculator skips single absence', () => {
    const lastSaved = '2026-08-31';
    const businessDays = [{ date: '2026-09-01', status: 'ABSENCE' }];

    const nextDate = getNextWorkingDate(lastSaved, businessDays);
    assert.strictEqual(format(nextDate, 'yyyy-MM-dd'), '2026-09-02');
});

test('Safety Invariant 3: Daily Book sequence calculator skips multiple consecutive absences', () => {
    const lastSaved = '2026-08-31';
    const businessDays = [
        { date: '2026-09-01', status: 'ABSENCE' },
        { date: '2026-09-02', status: 'ABSENCE' }
    ];

    const nextDate = getNextWorkingDate(lastSaved, businessDays);
    assert.strictEqual(format(nextDate, 'yyyy-MM-dd'), '2026-09-03');
});

test('Safety Invariant 4: Normal worked days increment by exactly 1 day', () => {
    const lastSaved = '2026-08-31';
    const businessDays = [{ date: '2026-09-01', status: 'WORKED' }];

    const nextDate = getNextWorkingDate(lastSaved, businessDays);
    assert.strictEqual(format(nextDate, 'yyyy-MM-dd'), '2026-09-01');
});
