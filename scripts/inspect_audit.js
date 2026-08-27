require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function inspectAuditAnomalies() {
    const client = await pool.connect();
    try {
        console.log('=== 1. Inspect Duplicate Maqal Ownership ===');
        const { rows: dupes } = await client.query(`
            SELECT c.id as customer_id, c.name, l.maqal_id, l.receipt_id,
                   COUNT(*) as row_count,
                   MIN(l.reference_date)::text as min_date,
                   MAX(l.reference_date)::text as max_date
            FROM "Ledger" l
            JOIN "Customer" c ON l.customer_id = c.id
            WHERE l.type = 'PRODUCT' AND l.deleted_at IS NULL AND l.maqal_id IS NOT NULL
              AND (l.customer_id, l.maqal_id) IN (
                  SELECT customer_id, maqal_id
                  FROM "Ledger"
                  WHERE type = 'PRODUCT' AND deleted_at IS NULL AND maqal_id IS NOT NULL
                  GROUP BY customer_id, maqal_id
                  HAVING COUNT(DISTINCT receipt_id) > 1
              )
            GROUP BY c.id, c.name, l.maqal_id, l.receipt_id;
        `);
        for (const d of dupes) {
            console.log(`Customer: ${d.name} (${d.customer_id}) | maqal_id=${d.maqal_id} | receipt_id=${d.receipt_id} | Dates: ${d.min_date} to ${d.max_date} (${d.row_count} rows)`);
        }

        console.log('\n=== 2. Inspect Orphan Payments ===');
        const { rows: orphans } = await client.query(`
            SELECT p.id, c.name, p.receipt_id, p.maqal_id, p.amount, p.reference_date::text as date, p.note
            FROM "Ledger" p
            JOIN "Customer" c ON p.customer_id = c.id
            WHERE p.type = 'PAYMENT' AND p.deleted_at IS NULL AND p.receipt_id IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM "Ledger" prod 
                  WHERE prod.receipt_id = p.receipt_id AND prod.type = 'PRODUCT' AND prod.deleted_at IS NULL
              );
        `);
        for (const o of orphans) {
            console.log(`Orphan Payment: ${o.name} | $${o.amount} | Date: ${o.date} | Note: "${o.note}" | receipt: ${o.receipt_id} | maqal_id: ${o.maqal_id}`);
        }

    } finally {
        client.release();
        await pool.end();
    }
}

inspectAuditAnomalies().catch(console.error);
