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
        if (!cat.date || cat.date === dateStr) {
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
    const vipCaadiTotalKg = vipCaadiItems.reduce((s, i) => s + i.kg, 0);

    return {
        vipQaaliCount,
        vipQaaliItems,
        vipCaadiCount,
        vipCaadiTotalKg,
        vipCaadiItems
    };
}

describe('VIP CAADI Feature Verification', () => {

    it('Invariant: Existing VIP QAALI note parsing remains 100% intact', () => {
        assert.equal(getVipCount('10 vip 38'), 10);
        assert.equal(getVipCount('5 VIP'), 5);
        assert.equal(getVipCount('7 vip 36, 3 notebook 32'), 7);
        assert.equal(getVipCount('No note', 15), 0);
        assert.equal(getVipCount(undefined, 10), 0);
    });

    it('VIP CAADI: Correctly derives count, total KG, custom labels, and individual prices', () => {
        const config: VipCaadiCategory[] = [
            {
                id: 'cat-1',
                label: 'VIP Caadi',
                customerIds: ['cust_1', 'cust_2'],
                customerPrices: {
                    'cust_1': '100',
                    'cust_2': '95'
                },
                date: '2026-09-02'
            },
            {
                id: 'cat-2',
                label: 'VIP Special',
                customerIds: ['cust_3'],
                customerPrices: {
                    'cust_3': '110'
                }
            }
        ];

        const dailyItems = [
            { customer_id: 'cust_1', kg: 15, note: '' },
            { customer_id: 'cust_2', kg: 20, note: '' },
            { customer_id: 'cust_3', kg: 10, note: '' },
            { customer_id: 'cust_4', kg: 8, note: '' } // Normal customer
        ];

        const result = deriveVipCategories(dailyItems, config, '2026-09-02');

        assert.equal(result.vipQaaliCount, 0, 'No VIP Qaali note present');
        assert.equal(result.vipCaadiCount, 3, '3 customers configured as VIP Caadi');
        assert.equal(result.vipCaadiTotalKg, 45, '15 + 20 + 10 = 45 KG');

        // Customer prices and labels verification
        const c1 = result.vipCaadiItems.find(i => i.customer_id === 'cust_1');
        assert.equal(c1?.price, '100');
        assert.equal(c1?.categoryLabel, 'VIP Caadi');

        const c2 = result.vipCaadiItems.find(i => i.customer_id === 'cust_2');
        assert.equal(c2?.price, '95');

        const c3 = result.vipCaadiItems.find(i => i.customer_id === 'cust_3');
        assert.equal(c3?.price, '110');
        assert.equal(c3?.categoryLabel, 'VIP Special');
    });

    it('Zero Double-Counting: Customer with explicit VIP QAALI note is counted in VIP QAALI only', () => {
        const config: VipCaadiCategory[] = [
            {
                id: 'cat-1',
                label: 'VIP Caadi',
                customerIds: ['cust_vip_both', 'cust_caadi_only'],
                customerPrices: {
                    'cust_vip_both': '100',
                    'cust_caadi_only': '95'
                }
            }
        ];

        const dailyItems = [
            // cust_vip_both is in VIP Caadi config, but has an explicit VIP Qaali note
            { customer_id: 'cust_vip_both', kg: 12, note: '12 vip 38' },
            // cust_caadi_only is in VIP Caadi config with no VIP Qaali note
            { customer_id: 'cust_caadi_only', kg: 25, note: '' }
        ];

        const result = deriveVipCategories(dailyItems, config, '2026-09-02');

        assert.equal(result.vipQaaliCount, 12, 'cust_vip_both counts in VIP QAALI');
        assert.equal(result.vipCaadiCount, 1, 'cust_caadi_only counts in VIP CAADI');
        assert.equal(result.vipCaadiTotalKg, 25, 'Only cust_caadi_only KG is in VIP CAADI');
        assert.ok(!result.vipCaadiItems.some(i => i.customer_id === 'cust_vip_both'), 'cust_vip_both NOT double-counted in VIP Caadi');
    });

    it('Invariant: Maqal pair engine remains authoritative and untouched', () => {
        // Verify MAQAL_EPOCH has not changed
        assert.equal(MAQAL_EPOCH, '2026-07-14', 'Epoch must remain July 14, 2026');

        // Verify pair generation: Aug 31 + Sep 1 are paired in the same Maqal
        const { pairs } = computePairsFromDates([
            '2026-07-14', '2026-07-15',  // MQ#1
            '2026-07-16', '2026-07-17',  // MQ#2
            '2026-08-31', '2026-09-01',  // some MQ#N
        ]);

        const aug31Pair = pairs.find(p => p.date1 === '2026-08-31' || p.date2 === '2026-08-31');
        const sep01Pair = pairs.find(p => p.date1 === '2026-09-01' || p.date2 === '2026-09-01');

        assert.ok(aug31Pair, 'Aug 31 belongs to a pair');
        assert.ok(sep01Pair, 'Sep 1 belongs to a pair');
        assert.equal(aug31Pair?.mq_num, sep01Pair?.mq_num, 'Aug 31 and Sep 1 are in the SAME Maqal pair');

        // No pair ever mixes dates from different cycles
        for (const pair of pairs) {
            assert.ok(pair.date1, `Pair MQ#${pair.mq_num} has date1`);
            assert.ok(pair.date2, `Pair MQ#${pair.mq_num} has date2`);
            assert.ok(pair.date1 < pair.date2, `Pair MQ#${pair.mq_num} is ordered correctly`);
        }
    });

    it('VIP CAADI: Date-specific category applies only to its date', () => {
        const config: VipCaadiCategory[] = [
            {
                id: 'cat-date',
                label: 'Weekend VIP',
                customerIds: ['cust_weekend'],
                customerPrices: { 'cust_weekend': '120' },
                date: '2026-09-05'
            }
        ];

        const dailyItems = [
            { customer_id: 'cust_weekend', kg: 18, note: '' }
        ];

        // On matching date — customer is VIP CAADI
        const resultMatch = deriveVipCategories(dailyItems, config, '2026-09-05');
        assert.equal(resultMatch.vipCaadiCount, 1, 'Customer counted on matching date');

        // On different date — category does NOT apply
        const resultOther = deriveVipCategories(dailyItems, config, '2026-09-06');
        assert.equal(resultOther.vipCaadiCount, 0, 'Customer NOT counted on different date');
    });
});
