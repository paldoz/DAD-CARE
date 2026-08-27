require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function investigateOrphans() {
    console.log('================================================================');
    console.log('🔍 INVESTIGATING ORPHAN RECEIPTS AND ORPHAN PAYMENTS');
    console.log('================================================================\n');

    const client = await pool.connect();
    try {
        // Find orphan receipts (receipt_id that has no PRODUCT row)
        const { rows: orphanReceiptIds } = await client.query(`
            SELECT DISTINCT p.receipt_id
            FROM "Ledger" p
            WHERE p.receipt_id IS NOT NULL AND p.deleted_at IS NULL
              AND NOT EXISTS (
                  SELECT 1 FROM "Ledger" prod 
                  WHERE prod.receipt_id = p.receipt_id AND prod.type = 'PRODUCT' AND prod.deleted_at IS NULL
              );
        `);

        console.log(`Orphan receipt_ids (no PRODUCT row): ${orphanReceiptIds.length}`);
        
        for (const { receipt_id } of orphanReceiptIds) {
            console.log(`\n--- receipt_id: ${receipt_id} ---`);
            const { rows } = await client.query(`
                SELECT id, type, customer_id, amount, receipt_id, maqal_id, reference_date::text, created_at::text
                FROM "Ledger"
                WHERE receipt_id = $1
                ORDER BY created_at ASC;
            `, [receipt_id]);
            
            for (const row of rows) {
                console.log(`  [${row.type}] id=${row.id.substring(0,8)} cust=${row.customer_id.substring(0,8)} amount=${row.amount} date=${row.reference_date} created=${row.created_at.substring(0,10)}`);
            }

            // Check if there's a soft-deleted PRODUCT
            const { rows: deletedProds } = await client.query(`
                SELECT id, type, deleted_at::text
                FROM "Ledger"
                WHERE receipt_id = $1 AND type = 'PRODUCT' AND deleted_at IS NOT NULL;
            `, [receipt_id]);
            if (deletedProds.length > 0) {
                console.log(`  ⚠️  Has ${deletedProds.length} soft-deleted PRODUCT row(s) — orphan is due to voided/deleted receipt`);
            }
        }

        // Find orphan payments (type=PAYMENT with no parent receipt product)
        const { rows: orphanPayments } = await client.query(`
            SELECT p.id, p.customer_id, p.amount, p.receipt_id, p.reference_date::text, p.created_at::text
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
        
        console.log(`\nOrphan payments: ${orphanPayments.length}`);
        for (const p of orphanPayments) {
            console.log(`  [PAYMENT] id=${p.id.substring(0,8)} cust=${p.customer_id.substring(0,8)} amount=${p.amount} receipt_id=${p.receipt_id ? p.receipt_id.substring(0,12)+'...' : 'NULL'} date=${p.reference_date}`);
        }

        // Confirm: do the orphan payments belong to the SAME customer as the orphan receipts?
        if (orphanPayments.length > 0 && orphanReceiptIds.length > 0) {
            console.log('\n  Checking if orphan payments are consistent with orphan receipts...');
            for (const p of orphanPayments) {
                const match = orphanReceiptIds.find(r => r.receipt_id === p.receipt_id);
                if (match) {
                    console.log(`  ✅ Orphan payment ${p.id.substring(0,8)} links to orphan receipt ${p.receipt_id.substring(0,16)} — consistent (same voided receipt)`);
                } else {
                    console.log(`  ⚠️  Orphan payment ${p.id.substring(0,8)} has no matching orphan receipt — unusual`);
                }
            }
        }

    } finally {
        client.release();
        await pool.end();
    }
}

investigateOrphans().catch(console.error);
