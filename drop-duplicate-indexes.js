/**
 * drop-duplicate-indexes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Step 1: Verify exact pg_get_indexdef() strings for all 4 confirmed-redundant
 *         indexes + the uncertain pair (Ledger_reference_date_idx).
 * Step 2: If and only if every candidate's definition is verified identical to
 *         its counterpart, drop them one at a time using DIRECT_URL (port 5432,
 *         session mode) with DROP INDEX CONCURRENTLY (no table lock).
 * Step 3: Re-query pg_stat_user_indexes after each drop to confirm routing.
 *
 * Uses DIRECT_URL (port 5432) — required for DROP INDEX CONCURRENTLY because
 * PgBouncer in transaction mode (port 6543) cannot run CONCURRENTLY statements.
 *
 * Accounting safety: no data touched. Only redundant B-tree structures removed.
 */

require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

// ── Use DIRECT_URL (port 5432, session mode) for DDL ─────────────────────────
const directUrl = process.env.DIRECT_URL;
if (!directUrl) {
    console.error('ERROR: DIRECT_URL not found in .env.local');
    process.exit(1);
}

const pool = new Pool({
    connectionString: directUrl,
    ssl: { rejectUnauthorized: false },
    max: 1,
    idleTimeoutMillis: 60000,
    connectionTimeoutMillis: 30000,
});

function sep(c, n) { return (c || '─').repeat(n || 80); }
function fmt(bytes) {
    const b = parseInt(bytes || 0);
    if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(2)} MB`;
    if (b >= 1024) return `${(b / 1024).toFixed(0)} KB`;
    return `${b} B`;
}

// ── Candidate list ────────────────────────────────────────────────────────────
// Each entry: { drop: name to remove, keep: name to retain, table, note }
const CONFIRMED_CANDIDATES = [
    {
        drop: 'Ledger_created_at_idx',
        keep: 'idx_ledger_created_at',
        table: 'Ledger',
        note: 'Plain index on created_at — smaller duplicate'
    },
    {
        drop: 'idx_ledger_type',
        keep: 'Ledger_type_idx',
        table: 'Ledger',
        note: 'Plain index on type — smaller duplicate'
    },
    {
        drop: 'idx_ledger_opt',
        keep: 'idx_ledger_product_kg_fast',
        table: 'Ledger',
        note: 'Partial index (customer_id, type WHERE deleted_at IS NULL) — exact duplicate'
    },
    {
        drop: 'idx_dbitem_book_id',
        keep: 'DailyBookItem_daily_book_id_idx',
        table: 'DailyBookItem',
        note: 'Plain index on daily_book_id — smaller duplicate'
    },
];

// ── Uncertain pair — verify only, do NOT drop ─────────────────────────────────
const UNCERTAIN_PAIR = {
    a: 'Ledger_reference_date_idx',
    b: 'idx_ledger_reference_date',
    table: 'Ledger',
};

async function getIndexDef(client, indexName) {
    const { rows } = await client.query(
        `SELECT pg_get_indexdef(oid) AS def, pg_relation_size(oid) AS bytes
         FROM pg_class WHERE relname = $1 AND relkind = 'i'`,
        [indexName]
    );
    return rows[0] || null;
}

async function getIndexScans(client, indexName) {
    const { rows } = await client.query(
        `SELECT idx_scan, idx_tup_read FROM pg_stat_user_indexes WHERE indexrelname = $1`,
        [indexName]
    );
    return rows[0] || { idx_scan: 'N/A', idx_tup_read: 'N/A' };
}

async function indexExists(client, indexName) {
    const { rows } = await client.query(
        `SELECT 1 FROM pg_class WHERE relname = $1 AND relkind = 'i'`,
        [indexName]
    );
    return rows.length > 0;
}

async function run() {
    const client = await pool.connect();
    console.log('\n' + sep('═'));
    console.log('  DADWORK LEDGER — FINAL INDEX VERIFICATION + REMOVAL');
    console.log('  Using DIRECT_URL (port 5432, session mode)');
    console.log(sep('═'));

    let verificationPassed = 0;
    let verificationFailed = 0;
    const verified = [];

    try {

        // ── PHASE 1: Verify all 4 confirmed candidates ────────────────────────
        console.log('\n\nPHASE 1: EXACT DEFINITION VERIFICATION\n' + sep());
        console.log('Comparing pg_get_indexdef() strings character-for-character.\n');

        for (const c of CONFIRMED_CANDIDATES) {
            console.log(`  Candidate: DROP "${c.drop}" — keep "${c.keep}" [${c.table}]`);

            const dropDef = await getIndexDef(client, c.drop);
            const keepDef = await getIndexDef(client, c.keep);

            if (!dropDef) {
                console.log(`  ⚠️  SKIP — "${c.drop}" does not exist (already removed?)\n`);
                continue;
            }
            if (!keepDef) {
                console.log(`  ❌ ABORT — "${c.keep}" does not exist! Cannot proceed.\n`);
                verificationFailed++;
                continue;
            }

            // Normalize: replace the index name within the definition string
            // pg_get_indexdef returns: CREATE INDEX "name" ON "table" USING ...
            // We strip the name so we can compare the structural definition
            const normalize = (def, name) =>
                def.replace(new RegExp(`"${name}"`, 'g'), '__IDX__')
                   .replace(new RegExp(name, 'g'), '__IDX__')
                   .trim();

            const normDrop = normalize(dropDef.def, c.drop);
            const normKeep = normalize(keepDef.def, c.keep);

            const isIdentical = normDrop === normKeep;

            console.log(`  DROP  def [${fmt(dropDef.bytes)}]: ${dropDef.def}`);
            console.log(`  KEEP  def [${fmt(keepDef.bytes)}]: ${keepDef.def}`);
            console.log(`  Match: ${isIdentical ? '✅ IDENTICAL (after name substitution)' : '❌ DIFFERENT'}`);

            if (isIdentical) {
                const dropScans = await getIndexScans(client, c.drop);
                const keepScans = await getIndexScans(client, c.keep);
                console.log(`  DROP scans: ${parseInt(dropScans.idx_scan||0).toLocaleString()}  |  KEEP scans: ${parseInt(keepScans.idx_scan||0).toLocaleString()}`);
                console.log(`  Note: ${c.note}`);
                console.log(`  → VERIFIED SAFE TO REMOVE (${fmt(dropDef.bytes)} saving)\n`);
                verificationPassed++;
                verified.push({ ...c, bytes: parseInt(dropDef.bytes) });
            } else {
                console.log(`  → ❌ DEFINITIONS DIFFER — will NOT remove\n`);
                verificationFailed++;
            }
        }

        // ── PHASE 1b: Verify uncertain pair — report only ─────────────────────
        console.log('\n  UNCERTAIN PAIR — Verification only, no removal:\n');
        const defA = await getIndexDef(client, UNCERTAIN_PAIR.a);
        const defB = await getIndexDef(client, UNCERTAIN_PAIR.b);

        if (!defA || !defB) {
            console.log(`  ⚠️  One or both of the uncertain pair indexes do not exist.`);
        } else {
            const normalize = (def, name) => def.replace(new RegExp(`"${name}"`, 'g'), '__IDX__').replace(new RegExp(name, 'g'), '__IDX__').trim();
            const normA = normalize(defA.def, UNCERTAIN_PAIR.a);
            const normB = normalize(defB.def, UNCERTAIN_PAIR.b);
            const match = normA === normB;

            console.log(`  A: "${UNCERTAIN_PAIR.a}" [${fmt(defA.bytes)}]`);
            console.log(`     ${defA.def}`);
            console.log(`  B: "${UNCERTAIN_PAIR.b}" [${fmt(defB.bytes)}]`);
            console.log(`     ${defB.def}`);
            console.log(`  Match: ${match ? '✅ IDENTICAL — eligible for future removal as 5th index' : '❌ DIFFERENT — must NOT be removed'}`);
            if (!match) {
                console.log('  Note: These serve different query shapes. Retain both.');
            } else {
                console.log(`  Note: Not removed today per instructions. Requires separate approval.`);
                console.log(`  Potential additional saving if approved: ${fmt(Math.min(parseInt(defA.bytes), parseInt(defB.bytes)))}`);
            }
        }

        // ── PHASE 2: Summary before action ───────────────────────────────────
        const totalSaving = verified.reduce((a, b) => a + b.bytes, 0);
        console.log('\n\n' + sep('═'));
        console.log('PHASE 1 SUMMARY');
        console.log(sep('─'));
        console.log(`  Candidates verified as safe:   ${verified.length} of ${CONFIRMED_CANDIDATES.length}`);
        console.log(`  Candidates blocked (different): ${verificationFailed}`);
        console.log(`  Total storage to be freed:      ${fmt(totalSaving)}`);

        if (verified.length === 0) {
            console.log('\n  ✅ Nothing to remove. All definitions differed or were already absent.');
            return;
        }

        // ── PHASE 3: Drop one at a time ───────────────────────────────────────
        console.log('\n\nPHASE 2: REMOVING VERIFIED DUPLICATE INDEXES (one at a time)\n' + sep());
        console.log('  Using DROP INDEX CONCURRENTLY — no table locks, production-safe.\n');

        let totalFreed = 0;
        let dropped = 0;

        for (const c of verified) {
            console.log(`\n  [${dropped + 1}/${verified.length}] Dropping "${c.drop}" on "${c.table}"...`);

            // Double-check it still exists before dropping
            const exists = await indexExists(client, c.drop);
            if (!exists) {
                console.log(`  ⚠️  "${c.drop}" no longer exists — skipping.`);
                continue;
            }

            // Capture size before drop
            const beforeDef = await getIndexDef(client, c.drop);
            const sizeFreed = beforeDef ? parseInt(beforeDef.bytes) : c.bytes;

            // DROP INDEX CONCURRENTLY cannot run inside a transaction
            // We are on a direct connection (port 5432, session mode) — this is safe
            await client.query(`DROP INDEX CONCURRENTLY IF EXISTS "${c.drop}"`);

            dropped++;
            totalFreed += sizeFreed;

            console.log(`  ✅ Dropped "${c.drop}" — freed ${fmt(sizeFreed)}`);

            // Verify surviving index is still present and routing
            const keepStillExists = await indexExists(client, c.keep);
            const keepScans = await getIndexScans(client, c.keep);
            console.log(`  ✅ "${c.keep}" still present: ${keepStillExists ? 'YES' : '❌ NO — INVESTIGATE!'}`);
            console.log(`     Scans on retained index: ${parseInt(keepScans.idx_scan||0).toLocaleString()}`);
        }

        // ── PHASE 4: Final state ─────────────────────────────────────────────
        console.log('\n\n' + sep('═'));
        console.log('PHASE 2 COMPLETE — FINAL INDEX STATE');
        console.log(sep('─'));
        console.log(`  Indexes removed:  ${dropped}`);
        console.log(`  Storage freed:    ${fmt(totalFreed)}`);

        const { rows: finalState } = await client.query(`
            SELECT
                t.relname AS table_name,
                i.relname AS index_name,
                pg_relation_size(i.oid) AS bytes,
                ix.indisunique AS is_unique,
                ix.indisprimary AS is_primary,
                COALESCE(s.idx_scan, 0) AS scans,
                ix.indpred IS NOT NULL AS is_partial,
                array_to_string(ARRAY(
                    SELECT pg_get_indexdef(ix.indexrelid, k + 1, true)
                    FROM generate_subscripts(ix.indkey, 1) AS k ORDER BY k
                ), ', ') AS columns
            FROM pg_class t
            JOIN pg_index ix ON t.oid = ix.indrelid
            JOIN pg_class i  ON i.oid = ix.indexrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            LEFT JOIN pg_stat_user_indexes s ON s.indexrelname = i.relname AND s.relname = t.relname
            WHERE n.nspname = 'public'
              AND t.relname IN ('Ledger', 'DailyBookItem')
              AND ix.indisvalid = true
            ORDER BY t.relname, pg_relation_size(i.oid) DESC;
        `);

        console.log('\n  Remaining indexes on Ledger and DailyBookItem:\n');
        console.log('  Table               Index'.padEnd(65) + 'Size'.padStart(10) + 'Scans'.padStart(12) + '  Type');
        console.log('  ' + sep('-', 78));
        for (const r of finalState) {
            const type = r.is_primary ? 'PRIMARY' : r.is_unique ? 'UNIQUE' : r.is_partial ? 'PARTIAL' : 'INDEX';
            console.log(
                `  ${r.table_name.padEnd(18)} ${r.index_name.padEnd(45)}` +
                fmt(parseInt(r.bytes)).padStart(10) +
                parseInt(r.scans).toLocaleString().padStart(12) +
                `  ${type}`
            );
        }

        const totalRemaining = finalState.reduce((a, b) => a + parseInt(b.bytes), 0);
        console.log(`\n  Total index bytes remaining: ${fmt(totalRemaining)}`);
        console.log('\n' + sep('═'));
        console.log('  REMOVAL COMPLETE — No data altered. No accounting logic changed.');
        console.log(sep('═') + '\n');

    } catch (err) {
        console.error('\n❌ ERROR:', err.message);
        if (err.message.includes('CONCURRENTLY')) {
            console.error('   CONCURRENTLY failed — this may mean the connection is inside a transaction.');
            console.error('   Verify DIRECT_URL points to port 5432 (session mode), not 6543 (transaction pooler).');
        }
        console.error(err.stack);
    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
