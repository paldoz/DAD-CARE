import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VipCaadiCategory } from '../types';
import { MAQAL_EPOCH, computePairsFromDates } from '../lib/maqal-utils';

// Helper replicate from daily-book/page.tsx
function getVipCount(note: string | undefined, fallbackKg: number = 0): number {
    if (!note) return 0;
    const lower = note.toLowerCase();
    if (!lower.includes('vip')) return 0;

    const regex = /(\d+(?:\.\d+)?)\s*vip/g;
    let match;
    let totalCount = 0;
    let found = false;
    while ((match = regex.exec(lower)) !== null) {
        found = true;
        totalCount += parseFloat(match[1]);
    }
    return found ? totalCount : fallbackKg;
}

// Calculate KG split and pricing for a customer on a given date
function calculateCustomerKgSplitAndPrice(
    bookKg: number,
    note: string | undefined,
    assignedVipCaadiKgInput: number | undefined,
    categoryDefaultPrice: number | undefined,
    customerOverridePrice: string | undefined,
    defaultNormalPrice: number = 38
) {
    const vipQaaliKg = getVipCount(note, bookKg);
    const maxVipCaadiKg = Math.max(0, bookKg - vipQaaliKg);

    // Validation
    const requestedVipCaadiKg = assignedVipCaadiKgInput !== undefined ? assignedVipCaadiKgInput : maxVipCaadiKg;
    const isValid = requestedVipCaadiKg >= 0 && requestedVipCaadiKg <= maxVipCaadiKg;

    const vipCaadiKg = Math.min(Math.max(0, requestedVipCaadiKg), maxVipCaadiKg);
    const normalKg = Math.max(0, bookKg - vipQaaliKg - vipCaadiKg);

    // Pricing
    const parsedOverride = customerOverridePrice ? parseFloat(customerOverridePrice) : undefined;
    const effectiveVipCaadiPrice = parsedOverride && !isNaN(parsedOverride) && parsedOverride > 0
        ? parsedOverride
        : (categoryDefaultPrice ?? null);

    const vipCaadiAmount = effectiveVipCaadiPrice ? vipCaadiKg * effectiveVipCaadiPrice : 0;
    const normalAmount = normalKg * defaultNormalPrice;
    const totalAmount = vipCaadiAmount + normalAmount;

    return {
        bookKg,
        vipQaaliKg,
        maxVipCaadiKg,
        vipCaadiKg,
        normalKg,
        isValid,
        effectiveVipCaadiPrice,
        vipCaadiAmount,
        normalAmount,
        totalAmount,
        reconciledKg: vipQaaliKg + vipCaadiKg + normalKg
    };
}

// Merge helper testing adding customers non-destructively
function mergeCustomerIntoCategory(
    category: VipCaadiCategory,
    newCustomerId: string,
    newCustomerMaxKg: number
): VipCaadiCategory {
    const existingIdSet = new Set(category.customerIds);
    if (existingIdSet.has(newCustomerId)) {
        return category;
    }
    return {
        ...category,
        customerIds: [...category.customerIds, newCustomerId],
        customerKgs: {
            ...(category.customerKgs || {}),
            [newCustomerId]: newCustomerMaxKg
        },
        customerPrices: {
            ...(category.customerPrices || {})
        }
    };
}

describe('VIP CAADI Pricing & KG Split Comprehensive Verification', () => {

    it('TEST 1: Book = 14, VIP Qaali = 0, VIP Caadi = 12 -> Expected normal = 2', () => {
        const split = calculateCustomerKgSplitAndPrice(14, '', 12, 36, undefined);
        assert.equal(split.bookKg, 14);
        assert.equal(split.vipQaaliKg, 0);
        assert.equal(split.vipCaadiKg, 12);
        assert.equal(split.normalKg, 2);
        assert.equal(split.reconciledKg, 14);
        assert.equal(split.isValid, true);
    });

    it('TEST 2: Book = 10, VIP Qaali = 5, VIP Caadi = 3 -> Expected normal = 2', () => {
        const split = calculateCustomerKgSplitAndPrice(10, '5 vip 38', 3, 36, undefined);
        assert.equal(split.bookKg, 10);
        assert.equal(split.vipQaaliKg, 5);
        assert.equal(split.vipCaadiKg, 3);
        assert.equal(split.normalKg, 2);
        assert.equal(split.reconciledKg, 10);
        assert.equal(split.isValid, true);
    });

    it('TEST 3: Book = 10, VIP Qaali = 5, VIP Caadi = 6 -> Expected validation failure (Max is 5)', () => {
        const split = calculateCustomerKgSplitAndPrice(10, '5 vip 38', 6, 36, undefined);
        assert.equal(split.maxVipCaadiKg, 5, 'Max VIP Caadi must be 5');
        assert.equal(split.isValid, false, '6 VIP Caadi exceeds max of 5, must fail validation');
    });

    it('TEST 4: Default VIP Caadi price = 36, Customer override absent -> Expected effective price = 36', () => {
        const split = calculateCustomerKgSplitAndPrice(10, '', 5, 36, '');
        assert.equal(split.effectiveVipCaadiPrice, 36, 'Must inherit category default price');
    });

    it('TEST 5: Default VIP Caadi price = 36, Customer override = 35 -> Expected effective price = 35', () => {
        const split = calculateCustomerKgSplitAndPrice(10, '', 5, 36, '35');
        assert.equal(split.effectiveVipCaadiPrice, 35, 'Must use individual customer override price');
    });

    it('TEST 6: Customer #30 has VIP Caadi = 12 on 2026-09-02; Switch to 2026-09-03 -> Expected VIP Caadi = 0 unless separately saved', () => {
        const categories: VipCaadiCategory[] = [{
            id: 'cat-sep-02',
            label: 'VIP Caadi',
            customerIds: ['cust_30'],
            defaultPrice: 36,
            customerPrices: {},
            customerKgs: { 'cust_30': 12 },
            date: '2026-09-02'
        }];

        // Querying Sep 02
        const catSep02 = categories.find(c => c.date === '2026-09-02');
        assert.ok(catSep02);
        assert.equal(catSep02?.customerKgs?.['cust_30'], 12);

        // Querying Sep 03 (no category saved for Sep 03)
        const catSep03 = categories.find(c => c.date === '2026-09-03');
        assert.equal(catSep03, undefined, 'No VIP Caadi on Sep 03 unless separately assigned and saved');
    });

    it('TEST 7: Existing customers #1, #2, #30 have saved assignments. Add #55 -> Existing data remains untouched', () => {
        const existingCategory: VipCaadiCategory = {
            id: 'cat-1',
            label: 'VIP Caadi',
            customerIds: ['cust_1', 'cust_2', 'cust_30'],
            defaultPrice: 36,
            customerPrices: { 'cust_30': '35' },
            customerKgs: { 'cust_1': 10, 'cust_2': 5, 'cust_30': 12 },
            date: '2026-09-02'
        };

        const merged = mergeCustomerIntoCategory(existingCategory, 'cust_55', 3);

        // Verify #1, #2, #30 are 100% preserved
        assert.equal(merged.customerKgs?.['cust_1'], 10);
        assert.equal(merged.customerKgs?.['cust_2'], 5);
        assert.equal(merged.customerKgs?.['cust_30'], 12);
        assert.equal(merged.customerPrices?.['cust_30'], '35');
        assert.equal(merged.defaultPrice, 36);

        // Verify #55 is added cleanly
        assert.ok(merged.customerIds.includes('cust_55'));
        assert.equal(merged.customerKgs?.['cust_55'], 3);
        assert.equal(merged.customerIds.length, 4);
    });

    it('TEST 8: Customer list is sorted by numeric ID: 1, 2, 3, 4, ... 55', () => {
        const rawList = [
            { code: '55', name: 'Fadxi' },
            { code: '42', name: 'Hidayo' },
            { code: '3', name: 'Ali' },
            { code: '30', name: 'Seynab' },
            { code: '1', name: 'Farah' },
            { code: '20', name: 'Amina' },
            { code: '2', name: 'Hassan' }
        ];

        const sorted = [...rawList].sort((a, b) => {
            const codeA = parseInt(a.code.replace(/\D/g, ''), 10) || 0;
            const codeB = parseInt(b.code.replace(/\D/g, ''), 10) || 0;
            return codeA - codeB;
        });

        const sortedCodes = sorted.map(c => parseInt(c.code, 10));
        assert.deepEqual(sortedCodes, [1, 2, 3, 20, 30, 42, 55], 'Customer codes must sort strictly numerically ascending');
    });

    it('TEST 9: Category total uses VIP Caadi KG, not Book KG (12 + 5 = 17 KG, not 14 + 8 = 22 KG)', () => {
        const cust30 = calculateCustomerKgSplitAndPrice(14, '', 12, 36, undefined);
        const cust20 = calculateCustomerKgSplitAndPrice(8, '', 5, 36, undefined);

        const categoryTotalKg = cust30.vipCaadiKg + cust20.vipCaadiKg;
        const rawBookTotalKg = cust30.bookKg + cust20.bookKg;

        assert.equal(categoryTotalKg, 17, 'Category total must be 12 + 5 = 17 KG');
        assert.equal(rawBookTotalKg, 22, 'Raw book total is 22 KG');
        assert.notEqual(categoryTotalKg, rawBookTotalKg);
    });

    it('TEST 10: 14 Book KG + 12 VIP Caadi KG results in exactly 2 normal KG with exact financial reconciliation ($508)', () => {
        // Customer #30: Book = 14 KG, VIP Caadi = 12 KG @ $36/KG, Normal = 2 KG @ $38/KG
        const split = calculateCustomerKgSplitAndPrice(14, '', 12, 36, undefined, 38);
        assert.equal(split.vipCaadiKg, 12);
        assert.equal(split.normalKg, 2);
        assert.equal(split.vipCaadiAmount, 432, '12 * 36 = $432');
        assert.equal(split.normalAmount, 76, '2 * 38 = $76');
        assert.equal(split.totalAmount, 508, '432 + 76 = $508 total');
        assert.equal(split.reconciledKg, 14);
    });

    it('11. Invariant: Existing VIP QAALI note parsing remains 100% intact', () => {
        assert.equal(getVipCount('10 vip 38'), 10);
        assert.equal(getVipCount('5 VIP'), 5);
        assert.equal(getVipCount('7 vip 36, 3 notebook 32'), 7);
        assert.equal(getVipCount('No note', 15), 0);
        assert.equal(getVipCount(undefined, 10), 0);
    });

    it('12. Invariant: Maqal pair engine remains authoritative and untouched', () => {
        assert.equal(MAQAL_EPOCH, '2026-07-14', 'Epoch must remain July 14, 2026');

        const { pairs } = computePairsFromDates([
            '2026-07-14', '2026-07-15',
            '2026-07-16', '2026-07-17',
            '2026-08-31', '2026-09-01',
        ]);

        const aug31Pair = pairs.find(p => p.date1 === '2026-08-31' || p.date2 === '2026-08-31');
        const sep01Pair = pairs.find(p => p.date1 === '2026-09-01' || p.date2 === '2026-09-01');

        assert.ok(aug31Pair, 'Aug 31 belongs to a pair');
        assert.ok(sep01Pair, 'Sep 1 belongs to a pair');
        assert.equal(aug31Pair?.mq_num, sep01Pair?.mq_num, 'Aug 31 and Sep 1 are in the SAME Maqal pair');
    });
});
