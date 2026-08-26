const { Pool } = require('pg');
require('dotenv').config({ path: '.env' });
const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });

async function run() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        console.log('=== COMMITTING PERMANENT DATABASE RELATIONSHIPS ===');

        // 1. Assign maqal_id = 29 to all products and payments for Aug 23-24
        const { rowCount: r29Count } = await client.query(`
            UPDATE "Ledger"
            SET maqal_id = 29
            WHERE deleted_at IS NULL
              AND (
                  (type = 'PRODUCT' AND reference_date IN ('2026-08-23', '2026-08-24'))
                  OR (receipt_id IN (
                      SELECT DISTINCT receipt_id
                      FROM "Ledger"
                      WHERE type = 'PRODUCT' AND reference_date IN ('2026-08-23', '2026-08-24') AND deleted_at IS NULL
                  ))
              )
        `);
        console.log(`1. Set maqal_id = 29 for Aug 23-24: ${r29Count} rows`);

        // 2. Assign maqal_id = 30 to all products and payments for Aug 25-26
        const { rowCount: r30Count } = await client.query(`
            UPDATE "Ledger"
            SET maqal_id = 30
            WHERE deleted_at IS NULL
              AND (
                  (type = 'PRODUCT' AND reference_date IN ('2026-08-25', '2026-08-26'))
                  OR (receipt_id IN (
                      SELECT DISTINCT receipt_id
                      FROM "Ledger"
                      WHERE type = 'PRODUCT' AND reference_date IN ('2026-08-25', '2026-08-26') AND deleted_at IS NULL
                  ))
              )
        `);
        console.log(`2. Set maqal_id = 30 for Aug 25-26: ${r30Count} rows`);

        // 3. Fix low maqal_id test entries (<= 8) from earlier tests
        const { rowCount: fixLowCount } = await client.query(`
            UPDATE "Ledger"
            SET maqal_id = 9 + FLOOR((COALESCE(reference_date::date, created_at::date) - '2026-07-14'::date) / 2)::int
            WHERE deleted_at IS NULL AND (maqal_id IS NULL OR maqal_id <= 8)
        `);
        console.log(`3. Normalized low/null maqal_ids based on authoritative date pair epoch: ${fixLowCount} rows`);

        // 4. Align EVERY payment's maqal_id to its product receipt's maqal_id
        const { rowCount: alignCount } = await client.query(`
            WITH prod_maqals AS (
                SELECT DISTINCT receipt_id, maqal_id
                FROM "Ledger"
                WHERE type = 'PRODUCT' AND deleted_at IS NULL AND receipt_id IS NOT NULL AND maqal_id IS NOT NULL
            )
            UPDATE "Ledger" pay
            SET maqal_id = pm.maqal_id
            FROM prod_maqals pm
            WHERE pay.receipt_id = pm.receipt_id
              AND pay.type = 'PAYMENT'
              AND pay.deleted_at IS NULL
              AND (pay.maqal_id IS DISTINCT FROM pm.maqal_id)
        `);
        console.log(`4. Aligned payment maqal_id with product receipt maqal_id: ${alignCount} rows`);

        await client.query('COMMIT');
        console.log('✅ COMMIT SUCCESSFUL!');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ Error during database repair:', e);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
