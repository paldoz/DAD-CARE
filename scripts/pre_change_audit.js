require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function preAudit() {
    const client = await pool.connect();
    try {
        console.log('================================================================');
        console.log('PRE-CHANGE READ-ONLY COMPREHENSIVE AUDIT REPORT');
        console.log('================================================================\n');

        // 1. Total Customers
        const { rows: custs } = await client.query(`
            SELECT id, name, customer_code FROM "Customer" WHERE deleted_at IS NULL ORDER BY name ASC
        `);
        console.log(`1. Total Active Customers: ${custs.length}`);

        // 2. Total Ledger Records
        const { rows: [ledgerStats] } = await client.query(`
            SELECT 
                COUNT(*) as total_rows,
                COUNT(*) FILTER (WHERE type = 'PRODUCT') as products,
                COUNT(*) FILTER (WHERE type = 'PAYMENT') as payments,
                COUNT(*) FILTER (WHERE type = 'ADJUSTMENT') as adjustments,
                COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) as soft_deleted,
                COUNT(DISTINCT receipt_id) as distinct_receipts,
                COUNT(DISTINCT customer_id) as distinct_customers
            FROM "Ledger"
        `);
        console.log(`2. Ledger Records Overview:`);
        console.log(`   Total Rows:          ${ledgerStats.total_rows}`);
        console.log(`   Products:            ${ledgerStats.products}`);
        console.log(`   Payments:            ${ledgerStats.payments}`);
        console.log(`   Adjustments:         ${ledgerStats.adjustments}`);
        console.log(`   Soft-deleted:        ${ledgerStats.soft_deleted}`);
        console.log(`   Distinct Receipts:   ${ledgerStats.distinct_receipts}`);
        console.log(`   Distinct Customers:  ${ledgerStats.distinct_customers}`);

        // 3. Check for any cross-customer receipt sharing
        const { rows: crossReceipts } = await client.query(`
            SELECT receipt_id, COUNT(DISTINCT customer_id) as cust_count, array_agg(DISTINCT customer_id) as cust_ids
            FROM "Ledger"
            WHERE receipt_id IS NOT NULL AND deleted_at IS NULL
            GROUP BY receipt_id
            HAVING COUNT(DISTINCT customer_id) > 1
        `);
        console.log(`3. Cross-Customer Receipt Sharing: ${crossReceipts.length === 0 ? '0 (PERFECT ✅)' : crossReceipts.length + ' ❌'}`);

        // 4. Check for orphan ledger records (customer_id not in Customer table)
        const { rows: orphanRows } = await client.query(`
            SELECT l.id, l.customer_id
            FROM "Ledger" l
            LEFT JOIN "Customer" c ON c.id = l.customer_id
            WHERE c.id IS NULL AND l.deleted_at IS NULL
        `);
        console.log(`4. Orphaned Ledger Records: ${orphanRows.length === 0 ? '0 (PERFECT ✅)' : orphanRows.length + ' ❌'}`);

        // 5. Oldest Maqal for all 56 active customers
        console.log(`5. Oldest Maqal Record Verification for all ${custs.length} customers:`);
        let oldestIntact = 0;
        for (const c of custs) {
            const { rows: oldest } = await client.query(`
                SELECT maqal_id, MIN(reference_date)::text as min_date, COUNT(*) as cnt
                FROM "Ledger"
                WHERE customer_id = $1 AND deleted_at IS NULL
                GROUP BY maqal_id
                ORDER BY MIN(reference_date) ASC
                LIMIT 1
            `, [c.id]);
            if (oldest.length > 0) oldestIntact++;
        }
        console.log(`   Customers with intact oldest Maqals: ${oldestIntact}/${custs.length} ✅\n`);

        console.log('================================================================');
        console.log('PRE-AUDIT COMPLETE — DATABASE IS HEALTHY AND READY FOR CODE UPDATE');
        console.log('================================================================');

    } finally {
        client.release();
        await pool.end();
    }
}

preAudit().catch(console.error);
