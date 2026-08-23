require('dotenv').config({ path: '.env' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
    // 1. Are there any payments with maqal_id IS NULL and receipt_id IS NULL?
    const res1 = await pool.query(`
        SELECT COUNT(*) as count, SUM(amount) as total
        FROM "Ledger" 
        WHERE type = 'PAYMENT' AND deleted_at IS NULL AND maqal_id IS NULL AND receipt_id IS NULL
    `);
    console.log('Payments with NULL maqal_id and NULL receipt_id:', res1.rows[0]);

    // 2. Do all 84 payments with receipt_id have matching PRODUCTs?
    const res2 = await pool.query(`
        WITH target_payments AS (
            SELECT id, receipt_id, amount
            FROM "Ledger"
            WHERE type = 'PAYMENT' AND deleted_at IS NULL AND maqal_id IS NULL AND receipt_id IS NOT NULL
        )
        SELECT 
            p.id, p.amount, p.receipt_id,
            COUNT(l.id) as matching_products_count,
            STRING_AGG(DISTINCT l.reference_date::text, ', ') as product_dates
        FROM target_payments p
        LEFT JOIN "Ledger" l ON l.receipt_id = p.receipt_id AND l.type = 'PRODUCT' AND l.deleted_at IS NULL
        GROUP BY p.id, p.amount, p.receipt_id
    `);
    
    let noMatch = 0;
    let match = 0;
    for (const row of res2.rows) {
        if (Number(row.matching_products_count) === 0) noMatch++;
        else match++;
    }
    console.log(`Of the 84 payments with receipt_id:`);
    console.log(`- ${match} share a receipt_id with at least one PRODUCT.`);
    console.log(`- ${noMatch} have a receipt_id but NO matching PRODUCT.`);

    if (noMatch > 0) {
        console.log('Sample of payments with NO matching product:');
        console.log(res2.rows.filter(r => Number(r.matching_products_count) === 0).slice(0, 5));
    }

    process.exit(0);
}
check();
