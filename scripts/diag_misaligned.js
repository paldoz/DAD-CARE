require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    const client = await pool.connect();
    try {
        // Sample the most recent misaligned payments
        const { rows: sample } = await client.query(`
            SELECT 
                p.id, c.name, 
                p.maqal_id as pay_maqal, 
                pr.maqal_id as prod_maqal,
                p.reference_date::text as pay_date, 
                pr.reference_date::text as prod_date,
                p.amount,
                p.receipt_id
            FROM "Ledger" p
            JOIN "Ledger" pr ON p.receipt_id = pr.receipt_id 
                AND pr.type = 'PRODUCT' AND pr.deleted_at IS NULL
            JOIN "Customer" c ON p.customer_id = c.id
            WHERE p.type = 'PAYMENT' AND p.deleted_at IS NULL
                AND p.maqal_id IS NOT NULL AND pr.maqal_id IS NOT NULL
                AND p.maqal_id != pr.maqal_id
            ORDER BY p.reference_date DESC
            LIMIT 15;
        `);

        console.log('=== Recent Misaligned Payments ===');
        for (const r of sample) {
            console.log(`  ${r.name}: $${r.amount} pay_date=${r.pay_date}`);
            console.log(`    pay_maqal=${r.pay_maqal} | prod_maqal=${r.prod_maqal} | prod_date=${r.prod_date}`);
            console.log(`    receipt=${r.receipt_id?.substring(0,12)}`);
        }

        // Count by customer
        const { rows: byCust } = await client.query(`
            SELECT c.name, COUNT(*) as cnt,
                   MIN(p.reference_date)::text as oldest,
                   MAX(p.reference_date)::text as newest
            FROM "Ledger" p
            JOIN "Ledger" pr ON p.receipt_id = pr.receipt_id 
                AND pr.type = 'PRODUCT' AND pr.deleted_at IS NULL
            JOIN "Customer" c ON p.customer_id = c.id
            WHERE p.type = 'PAYMENT' AND p.deleted_at IS NULL
                AND p.maqal_id IS NOT NULL AND pr.maqal_id IS NOT NULL
                AND p.maqal_id != pr.maqal_id
            GROUP BY c.name
            ORDER BY cnt DESC;
        `);

        console.log('\n=== Misaligned Payments by Customer ===');
        for (const r of byCust) {
            console.log(`  ${r.name}: ${r.cnt} payments (${r.oldest} to ${r.newest})`);
        }

        // How many payments have NULL maqal_id (where they should have one)?
        const { rows: nullInfo } = await client.query(`
            SELECT COUNT(*) as null_pay_maqal
            FROM "Ledger" p
            JOIN "Ledger" pr ON p.receipt_id = pr.receipt_id 
                AND pr.type = 'PRODUCT' AND pr.deleted_at IS NULL
            WHERE p.type = 'PAYMENT' AND p.deleted_at IS NULL 
                AND p.maqal_id IS NULL AND pr.maqal_id IS NOT NULL;
        `);
        console.log(`\n=== Payments with NULL maqal_id (but receipt has maqal_id): ${nullInfo[0].null_pay_maqal} ===`);

        // Get Xaliimo example
        const { rows: xaliimo } = await client.query(`
            SELECT 
                l.id, l.type, l.maqal_id, l.receipt_id, l.amount,
                l.reference_date::text as date
            FROM "Ledger" l
            JOIN "Customer" c ON l.customer_id = c.id
            WHERE c.name ILIKE '%xaliimo%' AND l.deleted_at IS NULL
            ORDER BY l.maqal_id NULLS LAST, l.reference_date
            LIMIT 30;
        `);
        console.log('\n=== Xaliimo Wala xolo Ledger ===');
        for (const r of xaliimo) {
            console.log(`  ${r.type} | maqal=${r.maqal_id} | receipt=${r.receipt_id?.substring(0,10)} | $${r.amount} | date=${r.date}`);
        }

    } finally {
        client.release();
        await pool.end();
    }
}

main().catch(console.error);
