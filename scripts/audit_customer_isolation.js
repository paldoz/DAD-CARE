require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function runCustomerIsolationAudit() {
    console.log('================================================================');
    console.log('🔍 FULL DATABASE CUSTOMER ISOLATION & RECEIPT INTEGRITY AUDIT');
    console.log('================================================================\n');

    const client = await pool.connect();
    try {
        // 1. Check if any receipt_id spans multiple customers
        const { rows: multiCustReceipts } = await client.query(`
            SELECT receipt_id, COUNT(DISTINCT customer_id) as customer_count,
                   array_agg(DISTINCT customer_id) as customer_ids
            FROM "Ledger"
            WHERE receipt_id IS NOT NULL AND deleted_at IS NULL
            GROUP BY receipt_id
            HAVING COUNT(DISTINCT customer_id) > 1;
        `);
        console.log(`1. Receipts spanning multiple customers: ${multiCustReceipts.length}`);
        for (const r of multiCustReceipts) {
            console.log(`   Receipt ${r.receipt_id}: customers = ${JSON.stringify(r.customer_ids)}`);
        }

        // 2. Check if any payment's customer_id differs from its parent receipt product's customer_id
        const { rows: mismatchedPaymentCust } = await client.query(`
            SELECT p.id as payment_id, p.customer_id as pay_cust, prod.customer_id as prod_cust,
                   p.receipt_id, p.amount
            FROM "Ledger" p
            JOIN "Ledger" prod ON p.receipt_id = prod.receipt_id AND prod.type = 'PRODUCT' AND prod.deleted_at IS NULL
            WHERE p.type = 'PAYMENT' AND p.deleted_at IS NULL
              AND p.customer_id != prod.customer_id;
        `);
        console.log(`2. Payments with customer_id != parent receipt product customer_id: ${mismatchedPaymentCust.length}`);
        for (const m of mismatchedPaymentCust) {
            console.log(`   Payment ${m.payment_id}: pay_cust=${m.pay_cust} vs prod_cust=${m.prod_cust} (rcpt=${m.receipt_id})`);
        }

        // 3. Check if any adjustment's customer_id differs from parent receipt product's customer_id
        const { rows: mismatchedAdjCust } = await client.query(`
            SELECT a.id as adj_id, a.customer_id as adj_cust, prod.customer_id as prod_cust,
                   a.receipt_id, a.amount
            FROM "Ledger" a
            JOIN "Ledger" prod ON a.receipt_id = prod.receipt_id AND prod.type = 'PRODUCT' AND prod.deleted_at IS NULL
            WHERE a.type = 'ADJUSTMENT' AND a.deleted_at IS NULL
              AND a.customer_id != prod.customer_id;
        `);
        console.log(`3. Adjustments with customer_id != parent receipt product customer_id: ${mismatchedAdjCust.length}`);

        // 4. Overall stats
        const { rows: [stats] } = await client.query(`
            SELECT 
                COUNT(*) as total_ledger_rows,
                COUNT(DISTINCT customer_id) as total_customers,
                COUNT(DISTINCT receipt_id) as total_receipts,
                COUNT(*) FILTER (WHERE type = 'PRODUCT') as product_rows,
                COUNT(*) FILTER (WHERE type = 'PAYMENT') as payment_rows,
                COUNT(*) FILTER (WHERE type = 'ADJUSTMENT') as adjustment_rows
            FROM "Ledger"
            WHERE deleted_at IS NULL;
        `);

        console.log('\n--- Overall Active Database Statistics ---');
        console.log(`  Total Active Customers:   ${stats.total_customers}`);
        console.log(`  Total Ledger Records:    ${stats.total_ledger_rows}`);
        console.log(`  Total Distinct Receipts: ${stats.total_receipts}`);
        console.log(`  Total Product Entries:   ${stats.product_rows}`);
        console.log(`  Total Payment Entries:   ${stats.payment_rows}`);
        console.log(`  Total Adjustment Entries:${stats.adjustment_rows}`);

    } finally {
        client.release();
        await pool.end();
    }
}

runCustomerIsolationAudit().catch(console.error);
