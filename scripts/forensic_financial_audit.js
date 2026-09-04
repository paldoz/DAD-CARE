require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function runAudit() {
    console.log('=== FORENSIC DATABASE SCHEMA & INTEGRITY AUDIT ===');

    // 1. Table Columns Dump
    const colsRes = await pool.query(`
        SELECT table_name, column_name, data_type, is_nullable
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        ORDER BY table_name, ordinal_position;
    `);
    
    const tables = {};
    for (const row of colsRes.rows) {
        if (!tables[row.table_name]) tables[row.table_name] = [];
        tables[row.table_name].push(`${row.column_name} (${row.data_type}, ${row.is_nullable === 'YES' ? 'nullable' : 'NOT NULL'})`);
    }
    
    console.log('\n--- 1. TABLE STRUCTURES ---');
    for (const [tName, cols] of Object.entries(tables)) {
        console.log(`\nTable [${tName}]:`);
        cols.forEach(c => console.log(`  - ${c}`));
    }

    // 2. Constraints Dump
    const constraintsRes = await pool.query(`
        SELECT
            tc.table_name, 
            kcu.column_name, 
            tc.constraint_type,
            tc.constraint_name,
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
    console.log('\n--- 2. CONSTRAINTS (PK, FK, UNIQUE) ---');
    console.table(constraintsRes.rows);

    // 3. DailyBook inspection
    const dbSample = await pool.query(`SELECT * FROM "DailyBook" LIMIT 3`);
    console.log('\n--- 3. DailyBook sample rows ---');
    console.log(JSON.stringify(dbSample.rows, null, 2));

    // 4. Scan for Mismatched Payment Linkages:
    // Does any payment have a receipt_id where the PRODUCT entries in that receipt belong to a DIFFERENT customer or DIFFERENT maqal_id?
    const mismatchRes = await pool.query(`
        WITH receipt_prods AS (
            SELECT 
                receipt_id,
                customer_id,
                maqal_id,
                COUNT(*) as prod_count,
                MIN(reference_date) as min_date,
                MAX(reference_date) as max_date
            FROM "Ledger"
            WHERE type = 'PRODUCT' AND deleted_at IS NULL AND receipt_id IS NOT NULL
            GROUP BY receipt_id, customer_id, maqal_id
        )
        SELECT 
            p.id as payment_id,
            p.customer_id as payment_customer_id,
            c.name as customer_name,
            c.customer_code,
            p.amount,
            p.previous_debt,
            p.new_debt,
            p.reference_date,
            p.note,
            p.receipt_id as payment_receipt_id,
            p.maqal_id as payment_maqal_id,
            rp.customer_id as receipt_customer_id,
            rp.maqal_id as receipt_maqal_id
        FROM "Ledger" p
        JOIN "Customer" c ON c.id = p.customer_id
        JOIN receipt_prods rp ON rp.receipt_id = p.receipt_id
        WHERE p.type = 'PAYMENT' AND p.deleted_at IS NULL
          AND (p.customer_id != rp.customer_id OR p.maqal_id != rp.maqal_id);
    `);
    console.log('\n--- 4. Payments Mismatched with Receipt Owner or Receipt Maqal ---');
    console.log(`Count: ${mismatchRes.rows.length}`);
    console.table(mismatchRes.rows);

    // 5. Scan for Orphaned Payment Receipts (Payments with receipt_id that does NOT exist on any PRODUCT)
    const orphanedRes = await pool.query(`
        SELECT 
            p.id, p.customer_id, c.name, c.customer_code, p.amount, p.reference_date, p.receipt_id, p.maqal_id, p.note
        FROM "Ledger" p
        JOIN "Customer" c ON c.id = p.customer_id
        WHERE p.type = 'PAYMENT' 
          AND p.deleted_at IS NULL 
          AND p.receipt_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM "Ledger" prod 
              WHERE prod.receipt_id = p.receipt_id 
                AND prod.type = 'PRODUCT' 
                AND prod.deleted_at IS NULL
          )
        ORDER BY p.created_at DESC;
    `);
    console.log('\n--- 5. Payments with Orphaned Receipts (No PRODUCT with that receipt_id) ---');
    console.log(`Count: ${orphanedRes.rows.length}`);
    console.table(orphanedRes.rows);

    // 6. Balance Drift check across ALL active customers
    const balanceDriftRes = await pool.query(`
        WITH lifetime AS (
            SELECT 
                customer_id,
                COALESCE(SUM(CASE 
                    WHEN type = 'PRODUCT' THEN amount 
                    WHEN type = 'PAYMENT' THEN -amount 
                    WHEN type = 'ADJUSTMENT' THEN amount 
                    ELSE 0 
                END), 0) AS lifetime_bal
            FROM "Ledger"
            WHERE deleted_at IS NULL
            GROUP BY customer_id
        ),
        latest_row AS (
            SELECT DISTINCT ON (customer_id)
                customer_id,
                new_debt AS latest_new_debt,
                created_at AS latest_created_at
            FROM "Ledger"
            WHERE deleted_at IS NULL
            ORDER BY customer_id, created_at DESC, id DESC
        )
        SELECT 
            c.id, c.name, c.customer_code,
            ROUND(l.lifetime_bal::numeric, 2) AS calculated_lifetime,
            ROUND(r.latest_new_debt::numeric, 2) AS stored_latest_debt,
            ROUND((l.lifetime_bal - r.latest_new_debt)::numeric, 2) AS drift
        FROM "Customer" c
        LEFT JOIN lifetime l ON l.customer_id = c.id
        LEFT JOIN latest_row r ON r.customer_id = c.id
        WHERE c.deleted_at IS NULL 
          AND ROUND(COALESCE(l.lifetime_bal, 0)::numeric, 2) != ROUND(COALESCE(r.latest_new_debt, 0)::numeric, 2)
        ORDER BY ABS(l.lifetime_bal - r.latest_new_debt) DESC;
    `);
    console.log('\n--- 6. Customers with Balance Drift (Lifetime Sum vs Latest Row new_debt) ---');
    console.log(`Count: ${balanceDriftRes.rows.length}`);
    console.table(balanceDriftRes.rows);

    // 7. Math consistency in Ledger transitions (previous_debt -> new_debt)
    const mathInconsistencyRes = await pool.query(`
        SELECT 
            id, customer_id, type, amount, previous_debt, new_debt,
            CASE 
                WHEN type = 'PRODUCT' THEN (previous_debt + amount)
                WHEN type = 'PAYMENT' THEN (previous_debt - amount)
                WHEN type = 'ADJUSTMENT' THEN (previous_debt + amount)
                ELSE previous_debt
            END AS expected_new_debt,
            created_at, note
        FROM "Ledger"
        WHERE deleted_at IS NULL
          AND (
              (type = 'PRODUCT' AND ROUND((previous_debt + amount)::numeric, 2) != ROUND(new_debt::numeric, 2))
              OR (type = 'PAYMENT' AND ROUND((previous_debt - amount)::numeric, 2) != ROUND(new_debt::numeric, 2))
          )
        ORDER BY created_at DESC;
    `);
    console.log('\n--- 7. Math Inconsistencies in Ledger (previous_debt vs new_debt) ---');
    console.log(`Count: ${mathInconsistencyRes.rows.length}`);
    console.table(mathInconsistencyRes.rows);

    await pool.end();
}

runAudit().catch(err => {
    console.error('Audit Error:', err);
    process.exit(1);
});
