import { test, describe } from 'node:test';
import assert from 'node:assert';
import { groupTransactionsInfoReceipts, calculateMaqalCharge } from '../app/utils/ledgerHelpers.js';
import { groupTransactionsInfoReceipts as exportPdfGrouping } from '../lib/export-pdf.js';
import { MAQAL_EPOCH, computePairsFromDates, validateMaqalPairs } from '../lib/maqal-utils.js';

describe('Security & Integrity Remediation Verification', () => {
    test('P1 Fix Verification: PDF Export uses authoritative grouping engine', () => {
        // Assert reference equality: export-pdf.ts must export the exact same grouping function
        assert.strictEqual(
            exportPdfGrouping,
            groupTransactionsInfoReceipts,
            'lib/export-pdf.ts must use the authoritative groupTransactionsInfoReceipts from app/utils/ledgerHelpers.ts'
        );
    });

    test('P1 Grouping & Backward Ripple Math: Late payments ripple correctly', () => {
        const txns: any[] = [
            // MQ#1 Product
            {
                id: 'tx-prod-1',
                customer_id: 'cust-1',
                type: 'PRODUCT',
                reference_date: '2026-07-14',
                kg: 10,
                price_per_kg: 35,
                amount: 350,
                previous_debt: 0,
                new_debt: 350,
                maqal_id: 9,
                receipt_id: 'rec-1',
                created_at: '2026-07-14T08:00:00Z'
            },
            // MQ#2 Product
            {
                id: 'tx-prod-2',
                customer_id: 'cust-1',
                type: 'PRODUCT',
                reference_date: '2026-07-16',
                kg: 10,
                price_per_kg: 35,
                amount: 350,
                previous_debt: 350,
                new_debt: 700,
                maqal_id: 10,
                receipt_id: 'rec-2',
                created_at: '2026-07-16T08:00:00Z'
            },
            // Late Payment on MQ#1
            {
                id: 'tx-pay-late',
                customer_id: 'cust-1',
                type: 'PAYMENT',
                reference_date: '2026-07-18',
                amount: 350,
                previous_debt: 700,
                new_debt: 350,
                maqal_id: 9,
                receipt_id: 'rec-1',
                created_at: '2026-07-18T10:00:00Z'
            }
        ];

        const groups = groupTransactionsInfoReceipts(txns);
        assert.strictEqual(groups.length, 2, 'Should create exactly 2 Maqal receipt groups');

        const mq1 = groups.find(g => g.receiptId === 'rec-1');
        const mq2 = groups.find(g => g.receiptId === 'rec-2');

        assert.ok(mq1, 'MQ#1 group exists');
        assert.ok(mq2, 'MQ#2 group exists');

        assert.strictEqual(mq1.totalPaid, 350, 'MQ#1 total paid must be $350');
        assert.strictEqual(mq1.closingBalance, 0, 'MQ#1 closing balance (Reesto) must be $0');
        assert.strictEqual(mq2.openingBalance, 0, 'MQ#2 opening balance must ripple down to $0');
        assert.strictEqual(mq2.closingBalance, 350, 'MQ#2 closing balance must be $350');
    });

    test('P2 Epoch Invariant: Authoritative MAQAL_EPOCH is July 14, 2026', () => {
        assert.strictEqual(MAQAL_EPOCH, '2026-07-14', 'System-wide MAQAL_EPOCH must be 2026-07-14');
        
        const sampleDates = [
            '2026-07-14', '2026-07-15',
            '2026-07-16', '2026-07-17',
            '2026-07-18', '2026-07-19'
        ];
        const { pairs } = computePairsFromDates(sampleDates);
        assert.strictEqual(pairs.length, 3);
        assert.strictEqual(pairs[0].mq_num, 1);
        assert.strictEqual(pairs[0].date1, '2026-07-14');
        assert.strictEqual(pairs[0].date2, '2026-07-15');
        assert.doesNotThrow(() => validateMaqalPairs(pairs));
    });

    test('FLOOR Charge Calculation Invariant: Fractional dollar is forgiven', () => {
        assert.strictEqual(calculateMaqalCharge(4.5, 35), 157); // 157.50 -> 157
        assert.strictEqual(calculateMaqalCharge(5.0, 35), 175);
        assert.strictEqual(calculateMaqalCharge(3.5, 35), 122); // 122.50 -> 122
        assert.strictEqual(calculateMaqalCharge(2.5, 35), 87);  // 87.50 -> 87
    });
});
