require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    const c = await pool.connect();
    try {
        console.log('=== GLOBAL READ-ONLY FORENSIC AUDIT DATA ===\n');

        // 1. Tables inspected & counts
        console.log('--- 1. TABLE & RECORD COUNTS ---');
        const tablesRes = await c.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name;
        `);
        console.log('Public Tables:', tablesRes.rows.map(r => r.table_name));

        const custCounts = await c.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE deleted_at IS NULL) as active,
                COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) as deleted
            FROM "Customer";
        `);
        console.log('Customer Counts:', custCounts.rows[0]);

        const dbCounts = await c.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE deleted_at IS NULL) as active,
                COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) as deleted
            FROM "DailyBook";
        `);
        console.log('DailyBook Counts:', dbCounts.rows[0]);

        const dbiCounts = await c.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE deleted_at IS NULL) as active,
                COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) as deleted
            FROM "DailyBookItem";
        `);
        console.log('DailyBookItem Counts:', dbiCounts.rows[0]);

        const ledgerCounts = await c.query(`
            SELECT 
                type,
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE deleted_at IS NULL) as active,
                COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) as deleted
            FROM "Ledger"
            GROUP BY type;
        `);
        console.log('Ledger by Type:', ledgerCounts.rows);

        const receiptCounts = await c.query(`
            SELECT 
                COUNT(DISTINCT receipt_id) as total_receipts,
                COUNT(DISTINCT receipt_id) FILTER (WHERE type = 'PRODUCT' AND deleted_at IS NULL) as active_product_receipts,
                COUNT(DISTINCT receipt_id) FILTER (WHERE type = 'PAYMENT' AND deleted_at IS NULL) as active_payment_receipts
            FROM "Ledger"
            WHERE receipt_id IS NOT NULL;
        `);
        console.log('Receipt Counts:', receiptCounts.rows[0]);

        const maqalCounts = await c.query(`
            SELECT 
                COUNT(DISTINCT maqal_id) as distinct_maqal_ids,
                MIN(maqal_id) as min_maqal_id,
                MAX(maqal_id) as max_maqal_id
            FROM "Ledger"
            WHERE maqal_id IS NOT NULL AND deleted_at IS NULL;
        `);
        console.log('Ledger Maqal ID stats:', maqalCounts.rows[0]);

        // 2. Constraints Check
        console.log('\n--- 2. CONSTRAINTS AUDIT ---');
        const conRes = await c.query(`
            SELECT 
                tc.table_name, 
                tc.constraint_name, 
                tc.constraint_type,
                kcu.column_name,
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema = kcu.table_schema
            LEFT JOIN information_schema.constraint_column_usage AS ccu
                ON ccu.constraint_name = tc.constraint_name
                AND ccu.table_schema = tc.table_schema
            WHERE tc.table_schema = 'public'
            ORDER BY tc.table_name, tc.constraint_type;
        `);
        console.log(`Total Constraints in public schema: ${conRes.rows.length}`);
        const fks = conRes.rows.filter(r => r.constraint_type === 'FOREIGN KEY');
        console.log('Foreign Keys:');
        fks.forEach(f => console.log(`  - [${f.table_name}.${f.column_name}] -> [${f.foreign_table_name}.${f.foreign_column_name}]`));

        // 3. Check for any NULL customer_id, amount, new_debt
        console.log('\n--- 3. CRITICAL COLUMN INTEGRITY IN LEDGER ---');
        const colNulls = await c.query(`
            SELECT 
                COUNT(*) FILTER (WHERE customer_id IS NULL) as null_cust,
                COUNT(*) FILTER (WHERE amount IS NULL) as null_amount,
                COUNT(*) FILTER (WHERE previous_debt IS NULL) as null_prev_debt,
                COUNT(*) FILTER (WHERE new_debt IS NULL) as null_new_debt,
                COUNT(*) FILTER (WHERE reference_date IS NULL) as null_ref_date,
                COUNT(*) FILTER (WHERE type NOT IN ('PRODUCT', 'PAYMENT', 'ADJUSTMENT')) as invalid_type
            FROM "Ledger"
            WHERE deleted_at IS NULL;
        `);
        console.log('Ledger Null/Invalid Checks:', colNulls.rows[0]);

        // 4. Check for any payment with maqal_id == customer_code
        console.log('\n--- 4. HISTORICAL maqal_id == customer_code CONFUSION SCAN ---');
        const codeConfusion = await c.query(`
            SELECT 
                l.id, l.customer_id, c.name, c.customer_code, l.amount, l.maqal_id, l.receipt_id, l.reference_date, l.created_at
            FROM "Ledger" l
            JOIN "Customer" c ON c.id = l.customer_id
            WHERE l.type = 'PAYMENT' AND l.deleted_at IS NULL
              AND l.maqal_id IS NOT NULL
              AND c.customer_code IS NOT NULL
              AND c.customer_code ~ '^[0-9]+$'
              AND l.maqal_id::text = c.customer_code;
        `);
        console.log('Payments where maqal_id == customer_code:', codeConfusion.rows.length);
        if (codeConfusion.rows.length > 0) console.table(codeConfusion.rows);

        // 5. Check payments with maqal_id < 9 (first real Maqal ID)
        console.log('\n--- 5. PAYMENTS WITH maqal_id < 9 ---');
        const lowMaqal = await c.query(`
            SELECT 
                l.id, l.customer_id, c.name, c.customer_code, l.amount, l.maqal_id, l.receipt_id, l.created_at
            FROM "Ledger" l
            JOIN "Customer" c ON c.id = l.customer_id
            WHERE l.type = 'PAYMENT' AND l.deleted_at IS NULL
              AND l.maqal_id IS NOT NULL AND l.maqal_id < 9;
        `);
        console.log('Payments with maqal_id < 9:', lowMaqal.rows.length);
        if (lowMaqal.rows.length > 0) console.table(lowMaqal.rows);

        // 6. Check payments with receipt_id where payment customer != receipt customer
        console.log('\n--- 6. PAYMENT RECEIPT OWNER MISMATCHES ---');
        const receiptMismatch = await c.query(`
            WITH r_prods AS (
                SELECT receipt_id, customer_id, maqal_id
                FROM "Ledger"
                WHERE type = 'PRODUCT' AND deleted_at IS NULL AND receipt_id IS NOT NULL
                GROUP BY receipt_id, customer_id, maqal_id
            )
            SELECT 
                p.id as pay_id, p.customer_id as pay_cust, c.name as pay_cust_name,
                rp.customer_id as r_cust, p.receipt_id, p.amount, p.maqal_id as pay_maqal, rp.maqal_id as r_maqal
            FROM "Ledger" p
            JOIN "Customer" c ON c.id = p.customer_id
            JOIN r_prods rp ON rp.receipt_id = p.receipt_id
            WHERE p.type = 'PAYMENT' AND p.deleted_at IS NULL
              AND (p.customer_id != rp.customer_id OR p.maqal_id != rp.maqal_id);
        `);
        console.log('Payment receipt mismatches:', receiptMismatch.rows.length);
        if (receiptMismatch.rows.length > 0) console.table(receiptMismatch.rows);

        // 7. Check payments with NO maqal_id (NULL maqal_id)
        console.log('\n--- 7. PAYMENTS WITH NULL maqal_id ---');
        const nullMaqalPayments = await c.query(`
            SELECT 
                COUNT(*) as total_null_maqal,
                COUNT(*) FILTER (WHERE receipt_id IS NOT NULL) as has_receipt,
                COUNT(*) FILTER (WHERE receipt_id IS NULL) as no_receipt,
                MIN(reference_date) as min_date,
                MAX(reference_date) as max_date
            FROM "Ledger"
            WHERE type = 'PAYMENT' AND deleted_at IS NULL AND maqal_id IS NULL;
        `);
        console.log('Null maqal_id payments summary:', nullMaqalPayments.rows[0]);

        // 8. PendingApprovals records
        console.log('\n--- 8. PENDING APPROVALS TABLE ---');
        const pendingRes = await c.query(`
            SELECT id, action_type, status, customer_id, ledger_id, created_at
            FROM "PendingApprovals"
            ORDER BY created_at DESC;
        `);
        console.log(`PendingApprovals count: ${pendingRes.rows.length}`);
        if (pendingRes.rows.length > 0) console.table(pendingRes.rows);

        // 9. BusinessDay dates
        console.log('\n--- 9. BUSINESSDAY (ABSENCE) RECORDS ---');
        const bdRes = await c.query(`
            SELECT date, status, created_at
            FROM "BusinessDay"
            ORDER BY date ASC;
        `);
        console.log(`BusinessDay rows: ${bdRes.rows.length}`);
        if (bdRes.rows.length > 0) console.table(bdRes.rows);

        // 10. Check DailyBook vs DailyBookItem customer counts
        console.log('\n--- 10. DAILYBOOK ORPHAN CHECK ---');
        const orphanDbi = await c.query(`
            SELECT COUNT(*) as orphan_items
            FROM "DailyBookItem" dbi
            LEFT JOIN "DailyBook" db ON db.id = dbi.daily_book_id
            WHERE dbi.deleted_at IS NULL AND db.id IS NULL;
        `);
        console.log('DailyBookItems without parent DailyBook:', orphanDbi.rows[0].orphan_items);

        // 11. DailyBookItem with invalid customer
        const orphanDbiCust = await c.query(`
            SELECT COUNT(*) as orphan_cust_items
            FROM "DailyBookItem" dbi
            LEFT JOIN "Customer" c ON c.id = dbi.customer_id
            WHERE dbi.deleted_at IS NULL AND c.id IS NULL;
        `);
        console.log('DailyBookItems without valid Customer:', orphanDbiCust.rows[0].orphan_cust_items);

        // 12. Soft deleted records across all tables
        console.log('\n--- 12. SOFT DELETED RECORDS SUMMARY ---');
        const softDelRes = await c.query(`
            SELECT 
                (SELECT COUNT(*) FROM "Customer" WHERE deleted_at IS NOT NULL) as del_customers,
                (SELECT COUNT(*) FROM "DailyBook" WHERE deleted_at IS NOT NULL) as del_dailybooks,
                (SELECT COUNT(*) FROM "DailyBookItem" WHERE deleted_at IS NOT NULL) as del_dailybookitems,
                (SELECT COUNT(*) FROM "Ledger" WHERE deleted_at IS NOT NULL) as del_ledger
        `);
        console.log('Soft deleted counts:', softDelRes.rows[0]);

        // 13. Check if any duplicate active DailyBook exists for the same date
        console.log('\n--- 13. DUPLICATE DAILYBOOK DATES ---');
        const dupDbDates = await c.query(`
            SELECT date, COUNT(*) as cnt
            FROM "DailyBook"
            WHERE deleted_at IS NULL
            GROUP BY date
            HAVING COUNT(*) > 1;
        `);
        console.log('Duplicate active DailyBook dates:', dupDbDates.rows.length);

        console.log('\n=== AUDIT DATA COLLECTION COMPLETE ===');
    } finally {
        c.release();
        await pool.end();
    }
}

run().catch(err => {
    console.error('Audit query error:', err);
    process.exit(1);
});
