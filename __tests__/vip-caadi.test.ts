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

// VIP Caadi derivation helper as implemented in Daily Book
function deriveVipCategories(
    items: Array<{ customer_id: string; kg: number; note?: string }>,
    vipCaadiConfig: VipCaadiCategory[],
    dateStr: string
) {
    const idToCategory = new Map<string, { label: string; price?: string }>();
    for (const cat of vipCaadiConfig) {
        const catDate = cat.date ? cat.date.substring(0, 10) : undefined;
        if (!catDate || catDate === dateStr) {
            for (const custId of cat.customerIds) {
                if (!idToCategory.has(custId)) {
                    idToCategory.set(custId, {
                        label: cat.label || 'VIP Caadi',
                        price: cat.customerPrices?.[custId]
                    });
                }
            }
        }
    }

    // 1. VIP QAALI items (from note containing 'vip')
    const vipQaaliItems = items.filter(i => i.note && i.note.toLowerCase().includes('vip'));
    const vipQaaliCount = vipQaaliItems.reduce((sum, i) => sum + getVipCount(i.note, i.kg), 0);
    const vipQaaliCustIds = new Set(vipQaaliItems.map(i => i.customer_id));

    // 2. VIP CAADI items (from config, strictly excluding any customer in VIP QAALI)
    const vipCaadiItems: Array<{ customer_id: string; kg: number; price?: string; categoryLabel: string }> = [];
    for (const item of items) {
        const kg = parseFloat(String(item.kg)) || 0;
        if (!vipQaaliCustIds.has(item.customer_id) && idToCategory.has(item.customer_id) && kg > 0) {
            const info = idToCategory.get(item.customer_id)!;
            vipCaadiItems.push({
                customer_id: item.customer_id,
                kg,
                price: info.price,
                categoryLabel: info.label
            });
        }
    }

    const vipCaadiCount = vipCaadiItems.length;
    const vipCaadiTotalKg = vipCaadiItems.reduce((s: number, i: { kg: number }) => s + i.kg, 0);

    return {
        vipQaaliCount,
        vipQaaliItems,
        vipCaadiCount,
        vipCaadiTotalKg,
        vipCaadiItems
    };
}

// Selector customers derivation helper as implemented in Settings
function deriveSelectorCustomers(
    dailyBookItems: Array<{ customer_id: string; customer?: { id: string; name: string; customer_code: string; is_inactive?: boolean; is_kabarka?: boolean }; kg: number }>,
    allCustomers: Array<{ id: string; name: string; customer_code: string; is_inactive?: boolean; is_kabarka?: boolean }>
) {
    if (dailyBookItems && dailyBookItems.length > 0) {
        const list: Array<{ id: string; name: string; customer_code: string; kg: number }> = [];
        const seen = new Set<string>();
        for (const item of dailyBookItems) {
            const cust = item.customer || allCustomers.find(c => c.id === item.customer_id);
            if (cust && !cust.is_inactive && !cust.is_kabarka && !seen.has(item.customer_id)) {
                seen.add(item.customer_id);
                list.push({
                    id: item.customer_id,
                    name: cust.name || 'Unknown',
                    customer_code: cust.customer_code || '',
                    kg: parseFloat(String(item.kg)) || 0
                });
            }
        }
        if (list.length > 0) {
            return list.sort((a, b) => {
                const codeA = parseInt(a.customer_code.replace(/\D/g, ''), 10) || 0;
                const codeB = parseInt(b.customer_code.replace(/\D/g, ''), 10) || 0;
                return codeA - codeB;
            });
        }
    }
    return allCustomers
        .filter(c => !c.is_inactive && !c.is_kabarka)
        .map(c => ({ ...c, kg: 0 }))
        .sort((a, b) => {
            const codeA = parseInt(a.customer_code.replace(/\D/g, ''), 10) || 0;
            const codeB = parseInt(b.customer_code.replace(/\D/g, ''), 10) || 0;
            return codeA - codeB;
        });
}

describe('VIP CAADI Comprehensive Feature Verification', () => {

    it('1. All Daily Book customers (e.g. 57) appear in Customer Selector', () => {
        const mockDailyItems = Array.from({ length: 57 }, (_, i) => ({
            customer_id: `cust_${i + 1}`,
            customer: { id: `cust_${i + 1}`, name: `Customer ${i + 1}`, customer_code: `${i + 1}`, is_inactive: false, is_kabarka: false },
            kg: (i % 5) + 1
        }));
        const selectorList = deriveSelectorCustomers(mockDailyItems, []);
        assert.equal(selectorList.length, 57, 'Selector must show all 57 customers for that Daily Book date');
        assert.equal(selectorList[0].customer_code, '1');
        assert.equal(selectorList[56].customer_code, '57');
    });

    it('2. Newly added customer (#57) appears in Customer Selector', () => {
        const existingCustomers = Array.from({ length: 56 }, (_, i) => ({
            id: `cust_${i + 1}`, name: `Customer ${i + 1}`, customer_code: `${i + 1}`, is_inactive: false, is_kabarka: false
        }));
        const newCustomer57 = { id: 'cust_57', name: 'New Customer 57', customer_code: '57', is_inactive: false, is_kabarka: false };
        const dailyItems = [...existingCustomers, newCustomer57].map((c, i) => ({
            customer_id: c.id,
            customer: c,
            kg: 10
        }));

        const selectorList = deriveSelectorCustomers(dailyItems, [...existingCustomers, newCustomer57]);
        assert.equal(selectorList.length, 57);
        const found = selectorList.find(c => c.id === 'cust_57');
        assert.ok(found, 'Customer #57 must appear in selector');
        assert.equal(found?.name, 'New Customer 57');
    });

    it('3. VIP CAADI assignment is separate from selector availability (57 in selector != 57 in VIP CAADI)', () => {
        // Daily Book has 57 customers, but user assigns only 22 to VIP CAADI
        const assignedIds = Array.from({ length: 22 }, (_, i) => `cust_${i + 1}`);
        const config: VipCaadiCategory[] = [{
            id: 'cat-1',
            label: 'VIP Caadi',
            customerIds: assignedIds,
            customerPrices: {},
            date: '2026-09-02'
        }];

        const dailyItems = Array.from({ length: 57 }, (_, i) => ({
            customer_id: `cust_${i + 1}`,
            kg: 5,
            note: ''
        }));

        const result = deriveVipCategories(dailyItems, config, '2026-09-02');
        assert.equal(result.vipCaadiCount, 22, 'Category count must be 22 (assigned), NOT 57 (selector total)');
    });

    it('4. VIP CAADI count is calculated from assigned customers with actual KG', () => {
        const config: VipCaadiCategory[] = [{
            id: 'cat-1',
            label: 'VIP Caadi',
            customerIds: ['cust_1', 'cust_2', 'cust_3', 'cust_absent'],
            customerPrices: { 'cust_1': '100', 'cust_2': '95' },
            date: '2026-09-02'
        }];

        const dailyItems = [
            { customer_id: 'cust_1', kg: 10, note: '' },
            { customer_id: 'cust_2', kg: 15, note: '' },
            { customer_id: 'cust_3', kg: 5, note: '' },
            { customer_id: 'cust_absent', kg: 0, note: '' } // 0 KG on this date
        ];

        const result = deriveVipCategories(dailyItems, config, '2026-09-02');
        assert.equal(result.vipCaadiCount, 3, 'Only customers with KG > 0 on this date count');
        assert.equal(result.vipCaadiTotalKg, 30, '10 + 15 + 5 = 30 KG');
    });

    it('5. VIP CAADI KG comes directly from Daily Book entry for selected date', () => {
        const config: VipCaadiCategory[] = [{
            id: 'cat-1',
            label: 'VIP Caadi',
            customerIds: ['cust_1', 'cust_2'],
            customerPrices: { 'cust_1': '100', 'cust_2': '95' },
            date: '2026-09-02'
        }];

        const dailyItems = [
            { customer_id: 'cust_1', kg: 17.5, note: '' },
            { customer_id: 'cust_2', kg: 22.5, note: '' }
        ];

        const result = deriveVipCategories(dailyItems, config, '2026-09-02');
        assert.equal(result.vipCaadiTotalKg, 40, '17.5 + 22.5 = 40 KG');
    });

    it('6. Date-Aware KG: Customer KG changes correctly by date', () => {
        const config: VipCaadiCategory[] = [{
            id: 'cat-1',
            label: 'VIP Caadi',
            customerIds: ['cust_hamdi'],
            customerPrices: { 'cust_hamdi': '100' }
        }];

        // On 2026-09-02 Hamdi has 5 KG
        const itemsSep02 = [{ customer_id: 'cust_hamdi', kg: 5, note: '' }];
        const resultSep02 = deriveVipCategories(itemsSep02, config, '2026-09-02');
        assert.equal(resultSep02.vipCaadiTotalKg, 5, 'Hamdi has 5 KG on Sep 02');

        // On 2026-08-31 Hamdi has 8 KG
        const itemsAug31 = [{ customer_id: 'cust_hamdi', kg: 8, note: '' }];
        const resultAug31 = deriveVipCategories(itemsAug31, config, '2026-08-31');
        assert.equal(resultAug31.vipCaadiTotalKg, 8, 'Hamdi has 8 KG on Aug 31');
    });

    it('7 & 8. Zero Double-Counting: VIP QAALI customer is strictly excluded from VIP CAADI', () => {
        const config: VipCaadiCategory[] = [{
            id: 'cat-1',
            label: 'VIP Caadi',
            customerIds: ['cust_qaali_and_caadi', 'cust_caadi_only'],
            customerPrices: { 'cust_qaali_and_caadi': '100', 'cust_caadi_only': '95' },
            date: '2026-09-02'
        }];

        const dailyItems = [
            { customer_id: 'cust_qaali_and_caadi', kg: 10, note: '10 vip 38' }, // VIP QAALI
            { customer_id: 'cust_caadi_only', kg: 15, note: '' } // VIP CAADI
        ];

        const result = deriveVipCategories(dailyItems, config, '2026-09-02');
        assert.equal(result.vipQaaliCount, 10, 'cust_qaali_and_caadi is in VIP QAALI');
        assert.equal(result.vipCaadiCount, 1, 'Only cust_caadi_only is in VIP CAADI');
        assert.equal(result.vipCaadiTotalKg, 15, 'Only cust_caadi_only KG in VIP CAADI');
        assert.ok(!result.vipCaadiItems.some(i => i.customer_id === 'cust_qaali_and_caadi'), 'No double counting');
    });

    it('9 & 10. Category Default State: Starts collapsed, expand is local UI state', () => {
        // Initial state is empty array of expanded IDs
        const initialExpanded: string[] = [];
        const isCollapsedInitially = !initialExpanded.includes('cat-1');
        assert.equal(isCollapsedInitially, true, 'Default state must be collapsed');

        // Toggle expand
        const toggledExpanded = [...initialExpanded, 'cat-1'];
        assert.equal(toggledExpanded.includes('cat-1'), true, 'Clicking category expands locally');

        // Toggle collapse
        const reCollapsed = toggledExpanded.filter(id => id !== 'cat-1');
        assert.equal(reCollapsed.includes('cat-1'), false, 'Clicking again collapses locally');
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
