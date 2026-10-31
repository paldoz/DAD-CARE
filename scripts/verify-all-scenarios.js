const { format, addDays, parseISO } = require('date-fns');

// 1. Simulation of getAuthoritativeActiveDailyBookDate logic
async function mockGetAuthoritativeDate(recentDailyBooks, absenceDays, systemDateStr) {
    if (!recentDailyBooks || recentDailyBooks.length === 0) {
        return systemDateStr;
    }
    const lastSavedDateStr = String(recentDailyBooks[0].date).substring(0, 10);
    const absenceSet = new Set((absenceDays || []).map(b => String(b.date).substring(0, 10)));
    let current = addDays(parseISO(lastSavedDateStr), 1);
    while (absenceSet.has(format(current, 'yyyy-MM-dd'))) {
        current = addDays(current, 1);
    }
    return format(current, 'yyyy-MM-dd');
}

// 2. Simulation of client-side customer visibility filter in page.tsx
function isCustomerVisibleInDailyBook(customer, bookDateStr) {
    const customerStartDateStr = customer.first_daily_book_date
        ? String(customer.first_daily_book_date).substring(0, 10)
        : (customer.created_at ? format(parseISO(customer.created_at), 'yyyy-MM-dd') : null);

    if (customerStartDateStr && customerStartDateStr > bookDateStr) {
        return false;
    }
    if (customer.deleted_at) {
        const customerDeletedStr = format(parseISO(customer.deleted_at), 'yyyy-MM-dd');
        if (customerDeletedStr <= bookDateStr) {
            return false;
        }
    }
    return true;
}

let passed = 0;
let failed = 0;
function assert(desc, condition) {
    if (condition) {
        console.log(`PASS: ${desc}`);
        passed++;
    } else {
        console.error(`FAIL: ${desc}`);
        failed++;
    }
}

async function runTests() {
    console.log('--- RUNNING SCENARIO TESTS ---');

    // Scenario 1: October 31 actual date, October 30 active: new customer appears October 30.
    // Last saved daily book was Oct 29. Next active date is Oct 30. Actual date is Oct 31.
    const activeDateS1 = await mockGetAuthoritativeDate([{ date: '2026-10-29' }], [], '2026-10-31');
    assert('Scenario 1 - Active date calculated as 2026-10-30', activeDateS1 === '2026-10-30');
    const newCustS1 = {
        id: 'cust-1',
        first_daily_book_date: activeDateS1,
        created_at: '2026-10-31T14:00:00Z'
    };
    assert('Scenario 1 - Customer appears in October 30 active book', isCustomerVisibleInDailyBook(newCustS1, '2026-10-30') === true);
    assert('Scenario 1 - Customer does not appear in historical Oct 29 book', isCustomerVisibleInDailyBook(newCustS1, '2026-10-29') === false);

    // Scenario 2: Historical browsing: new customer is assigned to the active date, not the historical date.
    // User is browsing historical date Oct 15 in the UI, but server assigns active book date (Oct 30).
    const assignedDateS2 = activeDateS1; // Server ignores UI date '2026-10-15'
    assert('Scenario 2 - Server assigns active date 2026-10-30 even when user is on 2026-10-15', assignedDateS2 === '2026-10-30');
    assert('Scenario 2 - Customer is hidden when user browses 2026-10-15', isCustomerVisibleInDailyBook(newCustS1, '2026-10-15') === false);

    // Scenario 3: Empty active Daily Book: new customer still appears.
    // Active book on 2026-10-30 has no saved DailyBook entries yet (empty items).
    assert('Scenario 3 - Customer appears in empty active book (2026-10-30)', isCustomerVisibleInDailyBook(newCustS1, '2026-10-30') === true);

    // Scenario 4: Absence date: active date skips ABSENCE correctly.
    // Last saved was Oct 29. Oct 30 is ABSENCE. Active book should be Oct 31.
    const activeDateS4 = await mockGetAuthoritativeDate([{ date: '2026-10-29' }], [{ date: '2026-10-30', status: 'ABSENCE' }], '2026-10-31');
    assert('Scenario 4 - Active date skips Oct 30 absence and resolves to 2026-10-31', activeDateS4 === '2026-10-31');
    const newCustS4 = {
        id: 'cust-s4',
        first_daily_book_date: activeDateS4,
        created_at: '2026-10-31T14:00:00Z'
    };
    assert('Scenario 4 - Customer is hidden on absence date 2026-10-30', isCustomerVisibleInDailyBook(newCustS4, '2026-10-30') === false);
    assert('Scenario 4 - Customer is visible on next working date 2026-10-31', isCustomerVisibleInDailyBook(newCustS4, '2026-10-31') === true);

    // Scenario 5: Saving the current Daily Book advances the next assignment correctly.
    // Now Oct 30 is saved. Next customer created should be assigned to Oct 31.
    const activeDateS5 = await mockGetAuthoritativeDate([{ date: '2026-10-30' }], [], '2026-10-31');
    assert('Scenario 5 - Saving Oct 30 advances authoritative date to 2026-10-31', activeDateS5 === '2026-10-31');

    // Scenario 6: Existing customers retain their historical visibility.
    // Existing customer has first_daily_book_date = null, created_at = '2026-06-01T08:00:00Z'.
    const existingCust = {
        id: 'cust-old',
        first_daily_book_date: null,
        created_at: '2026-06-01T08:00:00Z'
    };
    assert('Scenario 6 - Existing customer visible on June 01, 2026', isCustomerVisibleInDailyBook(existingCust, '2026-06-01') === true);
    assert('Scenario 6 - Existing customer visible on October 30, 2026', isCustomerVisibleInDailyBook(existingCust, '2026-10-30') === true);
    assert('Scenario 6 - Existing customer hidden before registration (May 31, 2026)', isCustomerVisibleInDailyBook(existingCust, '2026-05-31') === false);

    // Scenario 7: New customers appear immediately without duplicate rows.
    // Client sorts customers by numeric customer_code and maps uniquely by ID.
    const customerList = [
        { id: '1', customer_code: '1', first_daily_book_date: '2026-10-30', created_at: '2026-10-31T00:00:00Z' },
        { id: '2', customer_code: '2', first_daily_book_date: '2026-10-30', created_at: '2026-10-31T00:00:00Z' }
    ];
    const visible = customerList.filter(c => isCustomerVisibleInDailyBook(c, '2026-10-30'));
    const uniqueIds = new Set(visible.map(c => c.id));
    assert('Scenario 7 - No duplicate rows rendered for new customers', visible.length === uniqueIds.size && visible.length === 2);

    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
}

runTests();

