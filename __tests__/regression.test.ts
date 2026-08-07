import test, { describe, before, after } from 'node:test';
import assert from 'node:assert';
import { setupIsolatedTestDb, teardownIsolatedTestDb, getTestClient } from './setup.js';
import { randomUUID } from 'crypto';
import { recalculateCustomerLedger } from '../lib/ledger-utils.js';

describe('Production Replay (Golden Dataset)', () => {
    let schemaName: string;
    let client: any;

    before(async () => {
        schemaName = await setupIsolatedTestDb('regression_test');
        client = await getTestClient(schemaName);
    });

    after(async () => {
        await client.release();
        await teardownIsolatedTestDb(schemaName);
    });

    test('Complex Multi-Day Business Scenario', async () => {
        const cust1 = randomUUID();
        const cust2 = randomUUID();

        // Seed Customers
        await client.query(`INSERT INTO "Customer" (id, customer_code, name, created_at) VALUES ($1, '100', 'Regression A', NOW())`, [cust1]);
        await client.query(`INSERT INTO "Customer" (id, customer_code, name, created_at) VALUES ($1, '101', 'Regression B', NOW())`, [cust2]);

        // Day 1: Both buy milk
        await client.query(`INSERT INTO "Ledger" (id, customer_id, type, amount, date, created_at, previous_debt, new_debt) VALUES ($1, $2, 'PRODUCT', 500, '2024-01-01', '2024-01-01', 0, 0)`, [randomUUID(), cust1]);
        await client.query(`INSERT INTO "Ledger" (id, customer_id, type, amount, date, created_at, previous_debt, new_debt) VALUES ($1, $2, 'PRODUCT', 250, '2024-01-01', '2024-01-01', 0, 0)`, [randomUUID(), cust2]);

        // Day 2: cust1 pays 300, cust2 buys VIP
        await client.query(`INSERT INTO "Ledger" (id, customer_id, type, amount, date, created_at, previous_debt, new_debt) VALUES ($1, $2, 'PAYMENT', 300, '2024-01-02', '2024-01-02', 0, 0)`, [randomUUID(), cust1]);
        await client.query(`INSERT INTO "Ledger" (id, customer_id, type, amount, date, created_at, previous_debt, new_debt) VALUES ($1, $2, 'PRODUCT', 100, '2024-01-02', '2024-01-02', 0, 0)`, [randomUUID(), cust2]);

        // Run Recalculation engine on both
        const finalCust1 = await recalculateCustomerLedger(cust1, client);
        const finalCust2 = await recalculateCustomerLedger(cust2, client);

        // Assert Golden Output
        assert.strictEqual(finalCust1, 200, 'Cust1 must owe exactly 200');
        assert.strictEqual(finalCust2, 350, 'Cust2 must owe exactly 350');

        // Day 3: Time-travel edit to Day 1 (Cust 1 product drops from 500 to 450)
        await client.query(`UPDATE "Ledger" SET amount = 450 WHERE customer_id = $1 AND type = 'PRODUCT' AND date = '2024-01-01'`, [cust1]);
        
        const recalculatedCust1 = await recalculateCustomerLedger(cust1, client);
        assert.strictEqual(recalculatedCust1, 150, 'Cust1 debt must automatically ripple to exactly 150 after time-travel edit');
    });
});
