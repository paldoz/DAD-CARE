import test, { describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { setupIsolatedTestDb, teardownIsolatedTestDb, getTestClient } from './setup.js';
import { recalculateCustomerLedger } from '../lib/ledger-utils.js';
import { randomUUID } from 'crypto';

describe('FIFO & Ledger Math (ledger-utils.ts)', () => {
    let schemaName: string;
    let client: any;

    before(async () => {
        schemaName = await setupIsolatedTestDb('fifo_test');
        client = await getTestClient(schemaName);
    });

    after(async () => {
        await client.release();
        await teardownIsolatedTestDb(schemaName);
    });

    beforeEach(async () => {
        // Clear tables before each test
        await client.query(`TRUNCATE TABLE "Ledger" CASCADE`);
        await client.query(`TRUNCATE TABLE "Customer" CASCADE`);
    });

    const createTestCustomer = async (code: string, name: string) => {
        const id = randomUUID();
        await client.query(
            `INSERT INTO "Customer" (id, customer_code, name, created_at) VALUES ($1, $2, $3, NOW())`,
            [id, code, name]
        );
        return id;
    };

    const addLedgerEntry = async (
        customerId: string, 
        type: 'PRODUCT' | 'PAYMENT' | 'ADJUSTMENT', 
        amount: number, 
        dateStr: string
    ) => {
        const id = randomUUID();
        await client.query(
            `INSERT INTO "Ledger" (id, customer_id, type, amount, date, created_at, previous_debt, new_debt) 
             VALUES ($1, $2, $3, $4, $5, $5, 0, 0)`,
            [id, customerId, type, amount, dateStr]
        );
        return id;
    };

    test('Partial Payment: Owe 500, pay 200, remaining debt is 300', async () => {
        const cid = await createTestCustomer('1', 'Test Partial');
        
        await addLedgerEntry(cid, 'PRODUCT', 500, '2024-01-01 10:00:00');
        await addLedgerEntry(cid, 'PAYMENT', 200, '2024-01-02 10:00:00');

        const finalDebt = await recalculateCustomerLedger(cid, client);
        assert.strictEqual(finalDebt, 300, 'Partial payment must reduce debt accurately');
    });

    test('Overpayment: Owe 300, pay 400, output is credit (-100)', async () => {
        const cid = await createTestCustomer('2', 'Test Overpay');
        
        await addLedgerEntry(cid, 'PRODUCT', 300, '2024-01-01 10:00:00');
        await addLedgerEntry(cid, 'PAYMENT', 400, '2024-01-02 10:00:00');

        const finalDebt = await recalculateCustomerLedger(cid, client);
        assert.strictEqual(finalDebt, -100, 'Overpayment must result in negative debt');
    });

    test('Delete a Payment: Deleting a payment recalculates future balances correctly', async () => {
        const cid = await createTestCustomer('3', 'Test Del Payment');
        
        await addLedgerEntry(cid, 'PRODUCT', 300, '2024-01-01 10:00:00');
        const paymentId = await addLedgerEntry(cid, 'PAYMENT', 300, '2024-01-02 10:00:00');
        
        let finalDebt = await recalculateCustomerLedger(cid, client);
        assert.strictEqual(finalDebt, 0, 'Debt should be 0 after full payment');

        // Delete the payment (Soft Delete)
        await client.query(`UPDATE "Ledger" SET deleted_at = NOW() WHERE id = $1`, [paymentId]);

        finalDebt = await recalculateCustomerLedger(cid, client);
        assert.strictEqual(finalDebt, 300, 'Debt should rebound to 300 after payment is deleted');
    });

    test('Edit Historical Entry: Changing old product price cascades debt accurately', async () => {
        const cid = await createTestCustomer('4', 'Test Time Travel');
        
        // Day 1: Owe 300
        const prodId = await addLedgerEntry(cid, 'PRODUCT', 300, '2024-01-01 10:00:00');
        // Day 2: Pay 200 (Debt 100)
        await addLedgerEntry(cid, 'PAYMENT', 200, '2024-01-02 10:00:00');
        // Day 3: Buy 50 (Debt 150)
        await addLedgerEntry(cid, 'PRODUCT', 50, '2024-01-03 10:00:00');

        let finalDebt = await recalculateCustomerLedger(cid, client);
        assert.strictEqual(finalDebt, 150, 'Base debt should be 150');

        // Admin edits Day 1 product from 300 to 400
        await client.query(`UPDATE "Ledger" SET amount = 400 WHERE id = $1`, [prodId]);

        // Recalculate
        finalDebt = await recalculateCustomerLedger(cid, client);
        
        // Debt should increase by exactly 100
        assert.strictEqual(finalDebt, 250, 'Editing past entry must perfectly cascade downstream');
    });
});
