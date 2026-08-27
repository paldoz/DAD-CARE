require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function fixMisalignedPayments() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Align payment maqal_id to match the product maqal_id of the same receipt
        const updateRes = await client.query(`
            UPDATE "Ledger" p
            SET maqal_id = prod.maqal_id
            FROM (
                SELECT DISTINCT ON (receipt_id) receipt_id, maqal_id
                FROM "Ledger"
                WHERE type = 'PRODUCT' AND deleted_at IS NULL AND maqal_id IS NOT NULL
                ORDER BY receipt_id, created_at ASC
            ) prod
            WHERE p.receipt_id = prod.receipt_id
              AND p.type = 'PAYMENT'
              AND p.deleted_at IS NULL
              AND (p.maqal_id IS NULL OR p.maqal_id != prod.maqal_id);
        `);

        console.log(`✅ Successfully updated ${updateRes.rowCount} payment records to match their receipt product maqal_id.`);

        // Also check if any adjustment records in receipts have misaligned maqal_id
        const updateAdj = await client.query(`
            UPDATE "Ledger" a
            SET maqal_id = prod.maqal_id
            FROM (
                SELECT DISTINCT ON (receipt_id) receipt_id, maqal_id
                FROM "Ledger"
                WHERE type = 'PRODUCT' AND deleted_at IS NULL AND maqal_id IS NOT NULL
                ORDER BY receipt_id, created_at ASC
            ) prod
            WHERE a.receipt_id = prod.receipt_id
              AND a.type = 'ADJUSTMENT'
              AND a.deleted_at IS NULL
              AND (a.maqal_id IS NULL OR a.maqal_id != prod.maqal_id);
        `);

        console.log(`✅ Successfully updated ${updateAdj.rowCount} adjustment records to match their receipt product maqal_id.`);

        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Error repairing payment maqal_ids:', e);
    } finally {
        client.release();
        await pool.end();
    }
}

fixMisalignedPayments();
