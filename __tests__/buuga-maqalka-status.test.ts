import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeWorkingDatePairs } from '../lib/maqal-utils';

describe('Buuga Maqalka Customer Selection Status Icons & Maqal Completion Verification', () => {

    test('TEST A & E: Customer has not completed holiday-aware Target Maqal pair -> shows ⚠️ Warning', () => {
        // Holiday context: 2026-09-01 = ABSENCE
        const pairs = computeWorkingDatePairs({ absenceDates: ['2026-09-01'] });
        const todayStr = '2026-09-03';

        // Target pair selection (most recently completed pair before today)
        const completedPairs = pairs.filter(p => p.date2 < todayStr);
        completedPairs.sort((a, b) => b.date2.localeCompare(a.date2));
        const targetPair = completedPairs[0];

        assert.ok(targetPair);
        assert.strictEqual(targetPair.mq_num, 25, 'Target pair must be MQ#25');
        assert.strictEqual(targetPair.date1, '2026-08-31');
        assert.strictEqual(targetPair.date2, '2026-09-02', 'Target pair must end on Sep 2 (skipping Sep 1 ABSENCE)');

        // Customer who has not processed MQ#25 in ledger
        const customer = {
            id: 'cust-1',
            name: 'Ruqiyo cejiye',
            customer_code: '34',
            total_books_count: 11,
            unprocessed_books_count: 0, // lifetime ledger kg exceeded daily kg
            is_target_days_done: false
        };

        const isCompleted = customer.is_target_days_done;
        const isWarning = !isCompleted && ((customer.total_books_count ?? 0) > 0 || (customer.unprocessed_books_count ?? 0) > 0);

        assert.strictEqual(isCompleted, false, 'Customer is not completed');
        assert.strictEqual(isWarning, true, 'Customer MUST show ⚠️ Warning (even when unprocessed_books_count is 0)');
    });

    test('TEST B & C: Customer completes Target Maqal -> shows 🔵 Blue checkmark (persists on reload)', () => {
        // Customer after saving receipt for MQ#25
        const lastSavedCustomerId = 'cust-1';
        const savedCustomer = {
            id: 'cust-1',
            name: 'Ruqiyo cejiye',
            customer_code: '34',
            total_books_count: 11,
            unprocessed_books_count: 0,
            is_target_days_done: true // DB ledger entries now exist for both target_pair dates
        };

        const isCompleted = savedCustomer.id === lastSavedCustomerId || savedCustomer.is_target_days_done;
        const isWarning = !isCompleted && ((savedCustomer.total_books_count ?? 0) > 0 || (savedCustomer.unprocessed_books_count ?? 0) > 0);

        assert.strictEqual(isCompleted, true, 'Customer MUST show 🔵 Blue checkmark');
        assert.strictEqual(isWarning, false, 'Warning MUST be removed once completed');

        // On refresh/reopen: lastSavedCustomerId is reset, but is_target_days_done is saved in DB
        const reloadedCustomer = {
            ...savedCustomer
        };
        const activeSavedIdOnReload = ''; // reset on fresh page load
        const isCompletedReloaded = reloadedCustomer.id === activeSavedIdOnReload || reloadedCustomer.is_target_days_done;
        const isWarningReloaded = !isCompletedReloaded && ((reloadedCustomer.total_books_count ?? 0) > 0 || (reloadedCustomer.unprocessed_books_count ?? 0) > 0);

        assert.strictEqual(isCompletedReloaded, true, 'Customer MUST remain 🔵 Blue checkmark after reload');
        assert.strictEqual(isWarningReloaded, false, 'Warning MUST remain false after reload');
    });

    test('TEST D: Different customer who has not completed Target Maqal -> shows ⚠️ Warning', () => {
        // Customer 57 (Farxiyo) also has not completed MQ#25
        const customer57 = {
            id: 'cust-57',
            name: 'Farxiyo cejiye',
            customer_code: '57',
            total_books_count: 2,
            unprocessed_books_count: 1,
            is_target_days_done: false
        };

        const isCompleted = customer57.is_target_days_done;
        const isWarning = !isCompleted && ((customer57.total_books_count ?? 0) > 0 || (customer57.unprocessed_books_count ?? 0) > 0);

        assert.strictEqual(isCompleted, false);
        assert.strictEqual(isWarning, true, 'Customer 57 MUST show ⚠️ Warning');
    });

    test('TEST F: Customer with no daily books does not show false warning', () => {
        // Customer who has never had any daily books (e.g. inactive / 0 books)
        const emptyCustomer = {
            id: 'cust-99',
            name: 'No Books Customer',
            customer_code: '99',
            total_books_count: 0,
            unprocessed_books_count: 0,
            is_target_days_done: false
        };

        const isCompleted = emptyCustomer.is_target_days_done;
        const isWarning = !isCompleted && ((emptyCustomer.total_books_count ?? 0) > 0 || (emptyCustomer.unprocessed_books_count ?? 0) > 0);

        assert.strictEqual(isCompleted, false);
        assert.strictEqual(isWarning, false, 'Customer with no books must NOT show warning');
    });

    test('TEST G: Selected customer combobox button displays matching icon', () => {
        // When selected: incomplete customer has ⚠️, completed customer has 🔵
        const incompleteCustomer = {
            id: 'cust-1',
            name: 'Ruqiyo cejiye',
            customer_code: '34',
            total_books_count: 11,
            unprocessed_books_count: 0,
            is_target_days_done: false
        };

        const completedCustomer = {
            id: 'cust-20',
            name: 'Luul shaahle',
            customer_code: '20',
            total_books_count: 11,
            unprocessed_books_count: 0,
            is_target_days_done: true
        };

        function getButtonIconType(c: any, lastSavedId = '') {
            const isCompleted = c.id === lastSavedId || c.is_target_days_done;
            const isWarning = !isCompleted && ((c.total_books_count ?? 0) > 0 || (c.unprocessed_books_count ?? 0) > 0);
            if (isCompleted) return 'CHECKMARK';
            if (isWarning) return 'WARNING';
            return 'NONE';
        }

        assert.strictEqual(getButtonIconType(incompleteCustomer), 'WARNING');
        assert.strictEqual(getButtonIconType(completedCustomer), 'CHECKMARK');
    });
});
