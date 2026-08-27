require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function runFinalComprehensiveAudit() {
    console.log('================================================================');
    console.log('🔍 FINAL DATABASE CUSTOMER ISOLATION & AUDIT VERIFICATION');
    console.log('================================================================\n');

    const client = await pool.connect();
    try {
        // 1. Overall stats
        const { rows: [stats] } = await client.query(`
            SELECT 
                COUNT(DISTINCT customer_id) as total_customers,
                COUNT(*) as total_ledger_rows,
                COUNT(DISTINCT receipt_id) as total_receipts,
                COUNT(*) FILTER (WHERE type = 'PRODUCT') as total_products,
                COUNT(*) FILTER (WHERE type = 'PAYMENT') as total_payments
            FROM "Ledger"
            WHERE deleted_at IS NULL;
        `);

        // 2. Receipts spanning multiple customers
        const { rows: multiCustReceipts } = await client.query(`
            SELECT receipt_id, COUNT(DISTINCT customer_id) as customer_count
            FROM "Ledger"
            WHERE receipt_id IS NOT NULL AND deleted_at IS NULL
            GROUP BY receipt_id
            HAVING COUNT(DISTINCT customer_id) > 1;
        `);

        // 3. Payment / customer mismatches (payment customer_id != product customer_id for same receipt)
        const { rows: paymentMismatches } = await client.query(`
            SELECT p.id as payment_id, p.customer_id as pay_cust, prod.customer_id as prod_cust, p.receipt_id
            FROM "Ledger" p
            JOIN "Ledger" prod ON p.receipt_id = prod.receipt_id AND prod.type = 'PRODUCT' AND prod.deleted_at IS NULL
            WHERE p.type = 'PAYMENT' AND p.deleted_at IS NULL
              AND p.customer_id != prod.customer_id;
        `);

        // 4. Adjustment / customer mismatches
        const { rows: adjustmentMismatches } = await client.query(`
            SELECT a.id as adj_id, a.customer_id as adj_cust, prod.customer_id as prod_cust, a.receipt_id
            FROM "Ledger" a
            JOIN "Ledger" prod ON a.receipt_id = prod.receipt_id AND prod.type = 'PRODUCT' AND prod.deleted_at IS NULL
            WHERE a.type = 'ADJUSTMENT' AND a.deleted_at IS NULL
              AND a.customer_id != prod.customer_id;
        `);

        // 5. Orphan receipts (receipt_id exists on PAYMENT or ADJUSTMENT but NO PRODUCT rows exist)
        const { rows: orphanReceipts } = await client.query(`
            SELECT DISTINCT p.receipt_id
            FROM "Ledger" p
            WHERE p.receipt_id IS NOT NULL AND p.deleted_at IS NULL
              AND NOT EXISTS (
                  SELECT 1 FROM "Ledger" prod 
                  WHERE prod.receipt_id = p.receipt_id AND prod.type = 'PRODUCT' AND prod.deleted_at IS NULL
              );
        `);

        // 6. Orphan payments (payment rows where receipt_id is null or has no parent product)
        const { rows: orphanPayments } = await client.query(`
            SELECT p.id, p.customer_id, p.amount, p.reference_date::text as date
            FROM "Ledger" p
            WHERE p.type = 'PAYMENT' AND p.deleted_at IS NULL
              AND (
                  p.receipt_id IS NULL 
                  OR NOT EXISTS (
                      SELECT 1 FROM "Ledger" prod 
                      WHERE prod.receipt_id = p.receipt_id AND prod.type = 'PRODUCT' AND prod.deleted_at IS NULL
                  )
              );
        `);

        // 7. Duplicate receipt ownership (same customer + receipt_id having multiple different maqal_ids among products)
        const { rows: duplicateReceiptOwnership } = await client.query(`
            SELECT customer_id, receipt_id, COUNT(DISTINCT maqal_id) as maqal_count
            FROM "Ledger"
            WHERE type = 'PRODUCT' AND deleted_at IS NULL AND receipt_id IS NOT NULL AND maqal_id IS NOT NULL
            GROUP BY customer_id, receipt_id
            HAVING COUNT(DISTINCT maqal_id) > 1;
        `);

        // 8. Duplicate payment ownership (payments with duplicate transaction IDs across customers - impossible by primary key, but checked)
        const { rows: duplicatePaymentOwnership } = await client.query(`
            SELECT id, COUNT(DISTINCT customer_id) as cust_count
            FROM "Ledger"
            WHERE type = 'PAYMENT' AND deleted_at IS NULL
            GROUP BY id
            HAVING COUNT(DISTINCT customer_id) > 1;
        `);

        console.log(`Active Customers:                      ${stats.total_customers}`);
        console.log(`Ledger Records:                        ${stats.total_ledger_rows}`);
        console.log(`Receipts:                              ${stats.total_receipts}`);
        console.log(`Products:                              ${stats.total_products}`);
        console.log(`Payments:                              ${stats.total_payments}`);
        console.log(`\nReceipts spanning multiple customers:  ${multiCustReceipts.length}`);
        console.log(`Payment/customer mismatches:           ${paymentMismatches.length}`);
        console.log(`Adjustment/customer mismatches:        ${adjustmentMismatches.length}`);
        console.log(`Orphan receipts (standalone payments): ${orphanReceipts.length}`);
        console.log(`Orphan payments:                       ${orphanPayments.length}`);
        console.log(`Duplicate receipt ownership:           ${duplicateReceiptOwnership.length}`);
        console.log(`Duplicate payment ownership:           ${duplicatePaymentOwnership.length}`);

    } finally {
        client.release();
        await pool.end();
    }
}

runFinalComprehensiveAudit().catch(console.error);
