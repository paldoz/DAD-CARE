/**
 * apply-migration-003.js
 *
 * Adds priority_pair_key column to CustomerNoteStatus and backfills
 * existing active (Sax Saar ON) rows with the current target Maqal pair key.
 *
 * Safe to run more than once (idempotent).
 * Aborts without changes if no target pair can be determined from the DB.
 *
 * DOES NOT TOUCH: Ledger, DailyBook, Customer, payments, balances,
 *                 Maqal numbering, Mashquul Saar, or Blue Checkmark logic.
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

// ── Extract MAQAL_PAIRS_CTE from the authoritative TS source ─────────────────
// This guarantees the migration uses exactly the same pair logic as the app.
const maqalUtilsSrc = fs.readFileSync(
    path.join(__dirname, '../lib/maqal-utils.ts'),
    'utf8'
);
const cteMatch = maqalUtilsSrc.match(/export const MAQAL_PAIRS_CTE = `([^`]+)`/);
if (!cteMatch) {
    console.error('ABORT: Could not extract MAQAL_PAIRS_CTE from lib/maqal-utils.ts');
    process.exit(1);
}
// Extract the MAQAL_EPOCH value and substitute it into the CTE string
// (the CTE uses ${MAQAL_EPOCH} as a JS template literal placeholder)
const epochMatch = maqalUtilsSrc.match(/export const MAQAL_EPOCH = '([^']+)'/);
if (!epochMatch) {
    console.error('ABORT: Could not extract MAQAL_EPOCH from lib/maqal-utils.ts');
    process.exit(1);
}
const MAQAL_EPOCH = epochMatch[1];
const MAQAL_PAIRS_CTE = cteMatch[1].replace(/\$\{MAQAL_EPOCH\}/g, MAQAL_EPOCH);
console.log(`[✓] MAQAL_EPOCH: ${MAQAL_EPOCH}`);
console.log(`[✓] MAQAL_PAIRS_CTE extracted and substituted (${MAQAL_PAIRS_CTE.length} chars)`);

// ── Database connection ───────────────────────────────────────────────────────
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) {
    console.error('ABORT: No connection string found in .env.local');
    process.exit(1);
}

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    const client = await pool.connect();
    try {
        console.log('\n=== Migration 003: Sax Saar pair key ===\n');

        // ── Step 0: Read-only pre-flight comparison ───────────────────────────
        // Verify this script's MAQAL_PAIRS_CTE produces the same target pair
        // as the customers API, before touching anything.
        console.log('[Step 0] Read-only pre-flight: comparing target pair with customers API calculation...');
        const pairCheckQuery = `
            ${MAQAL_PAIRS_CTE}
            SELECT
                date1::text AS date1,
                date2::text AS date2,
                date1::text || '+' || date2::text AS pair_key
            FROM pairs
            WHERE date2 < (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Mogadishu')::date
            ORDER BY date2 DESC
            LIMIT 1;
        `;
        const pairResult = await client.query(pairCheckQuery);

        if (pairResult.rows.length === 0) {
            console.error('\nABORT: No target pair found in database.');
            console.error('This means there are no completed Maqal pairs yet.');
            console.error('Cannot safely backfill existing Sax Saar statuses.');
            console.error('No database changes were made.\n');
            process.exit(1);
        }

        const targetPairKey = pairResult.rows[0].pair_key;
        console.log(`[✓] Target pair found: ${pairResult.rows[0].date1} + ${pairResult.rows[0].date2}`);
        console.log(`[✓] Pair key to assign: "${targetPairKey}"`);

        // ── Step 1: Add column (idempotent) ──────────────────────────────────
        console.log('\n[Step 1] Adding priority_pair_key column...');
        await client.query(`
            ALTER TABLE "CustomerNoteStatus"
              ADD COLUMN IF NOT EXISTS priority_pair_key TEXT DEFAULT NULL;
        `);
        console.log('[✓] Column added (or already existed).');

        // ── Step 2: Show current active Sax Saar statuses before backfill ────
        const beforeRows = await client.query(`
            SELECT customer_id, priority_enabled, priority_pair_key
            FROM "CustomerNoteStatus"
            WHERE priority_enabled = TRUE
            ORDER BY customer_id;
        `);
        console.log(`\n[Step 2] Active Sax Saar rows before backfill: ${beforeRows.rowCount}`);
        if (beforeRows.rowCount > 0) {
            console.table(beforeRows.rows);
        }

        // ── Step 3: Backfill with LITERAL pair key (never writes NULL) ────────
        // Uses the pair key from Step 0 as a literal string parameter.
        // Only touches rows that have no pair key yet (priority_pair_key IS NULL).
        console.log(`\n[Step 3] Backfilling with pair key "${targetPairKey}"...`);
        const updateResult = await client.query(`
            UPDATE "CustomerNoteStatus"
            SET priority_pair_key = $1
            WHERE priority_enabled = TRUE
              AND priority_pair_key IS NULL
        `, [targetPairKey]);
        console.log(`[✓] Rows updated: ${updateResult.rowCount}`);

        // ── Step 4: Verify — all active rows now have a pair key ──────────────
        const afterRows = await client.query(`
            SELECT customer_id, priority_enabled, priority_pair_key
            FROM "CustomerNoteStatus"
            WHERE priority_enabled = TRUE
            ORDER BY customer_id;
        `);
        console.log(`\n[Step 4] Active Sax Saar rows after backfill: ${afterRows.rowCount}`);
        if (afterRows.rowCount > 0) {
            console.table(afterRows.rows);
        }

        const missingKey = afterRows.rows.filter(r => !r.priority_pair_key);
        if (missingKey.length > 0) {
            console.error(`\n[!] WARNING: ${missingKey.length} active row(s) still have NULL priority_pair_key.`);
            console.table(missingKey);
        } else {
            console.log('[✓] All active Sax Saar rows have a valid pair key.');
        }

        // ── Step 5: Schema verification ───────────────────────────────────────
        const colCheck = await client.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = 'CustomerNoteStatus'
              AND column_name = 'priority_pair_key';
        `);
        console.log('\n[Step 5] Column schema verification:');
        console.table(colCheck.rows);

        console.log('\n=== Migration 003 complete ===\n');

    } catch (e) {
        console.error('\nError during migration 003:', e);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

run();

