/**
 * verify-indexes.js
 * ─────────────────────────────────────────────────────────────
 * READ-ONLY index verification for Ledger and DailyBookItem tables.
 *
 * Checks:
 *   1. Exact index definitions (columns, order, uniqueness, partial predicates)
 *   2. pg_stat_user_indexes scan counts + statistics reset time
 *   3. Constraint dependencies (PK, FK, UNIQUE)
 *   4. Code-verified column sets needed by critical queries
 *   5. Duplicate detection with full evidence
 *
 * SAFE: zero writes, zero drops, zero schema changes.
 */

require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 1,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000,
});

function sep(c, n) { return (c || '-').repeat(n || 80); }
function fmt(bytes) {
    if (!bytes) return '0 B';
    if (bytes >= 1024*1024) return `${(bytes/1024/1024).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes/1024).toFixed(1)} KB`;
    return `${bytes} B`;
}

async function run() {
    const client = await pool.connect();
    console.log('\n' + sep('='));
    console.log('  DADWORK LEDGER — READ-ONLY INDEX VERIFICATION');
    console.log('  Ledger + DailyBookItem — No changes made');
    console.log(sep('='));

    try {

        // ── 0. Statistics reset time ──────────────────────────────────────────
        console.log('\n[0] STATISTICS RESET TIME (pg_stat context)\n' + sep());
        let statsReset = 'Unknown (stats_reset not accessible via pooler)';
        try {
            const { rows: resetRows } = await client.query(`
                SELECT stats_reset FROM pg_stat_bgwriter LIMIT 1;
            `);
            if (resetRows[0]?.stats_reset) {
                statsReset = new Date(resetRows[0].stats_reset).toISOString();
            }
        } catch (_) {
            // Not accessible through pgbouncer transaction pooler — acceptable
        }
        console.log(`  Statistics tracked since: ${statsReset}`);
        console.log('  NOTE: The transaction pooler may block access to pg_stat_bgwriter.');
        console.log('  ⚠ Zero scan counts must be interpreted carefully — see code analysis in [6].');
        console.log('  ⚠ An index with 0 scans may still be essential if it supports a rare report.');

        // ── 1. Exact index definitions ────────────────────────────────────────
        for (const tableName of ['Ledger', 'DailyBookItem']) {
            console.log(`\n\n[1] EXACT INDEX DEFINITIONS — "${tableName}"\n` + sep());
            const { rows: defs } = await client.query(`
                SELECT
                    i.relname                               AS index_name,
                    pg_get_indexdef(ix.indexrelid)          AS index_definition,
                    pg_relation_size(i.oid)                 AS index_bytes,
                    ix.indisunique                          AS is_unique,
                    ix.indisprimary                         AS is_primary,
                    ix.indisvalid                           AS is_valid,
                    ix.indpred IS NOT NULL                  AS is_partial,
                    COALESCE(pg_get_expr(ix.indpred, ix.indrelid), '(none)')  AS partial_predicate,
                    array_to_string(ARRAY(
                        SELECT pg_get_indexdef(ix.indexrelid, k + 1, true)
                        FROM generate_subscripts(ix.indkey, 1) AS k
                        ORDER BY k
                    ), ', ')                                AS columns
                FROM pg_class t
                JOIN pg_index ix ON t.oid = ix.indrelid
                JOIN pg_class i  ON i.oid = ix.indexrelid
                JOIN pg_namespace n ON n.oid = t.relnamespace
                WHERE n.nspname = 'public'
                  AND t.relname = $1
                ORDER BY ix.indisprimary DESC, ix.indisunique DESC, index_bytes DESC;
            `, [tableName]);

            console.log('Index Name'.padEnd(42) + 'Size'.padStart(10) + '  U  P  V  Partial  Columns');
            console.log(sep('-'));
            for (const r of defs) {
                const flags = `  ${r.is_unique?'Y':'N'}  ${r.is_primary?'Y':'N'}  ${r.is_valid?'Y':'N'}  ${r.is_partial?'YES':'NO '}`;
                console.log(
                    r.index_name.padEnd(42) +
                    fmt(parseInt(r.index_bytes||0)).padStart(10) +
                    flags +
                    `    ${r.columns}`
                );
                console.log('  DEF: ' + r.index_definition);
                if (r.is_partial) console.log('  PREDICATE: ' + r.partial_predicate);
                console.log('');
            }
        }

        // ── 2. Full definition strings for duplicate comparison ───────────────
        console.log('\n[2] INDEX SCAN COUNTS (pg_stat_user_indexes)\n' + sep());
        const { rows: scanRows } = await client.query(`
            SELECT
                s.relname                   AS table_name,
                s.indexrelname              AS index_name,
                s.idx_scan                  AS scans,
                s.idx_tup_read              AS tuples_read,
                s.idx_tup_fetch             AS tuples_fetched,
                pg_relation_size(i.oid)     AS index_bytes,
                ix.indisunique              AS is_unique,
                ix.indisprimary             AS is_primary,
                ix.indpred IS NOT NULL      AS is_partial
            FROM pg_stat_user_indexes s
            JOIN pg_class t  ON t.relname = s.relname AND t.relkind = 'r'
            JOIN pg_index ix ON ix.indrelid = t.oid
            JOIN pg_class i  ON i.relname = s.indexrelname AND i.oid = ix.indexrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND s.relname IN ('Ledger', 'DailyBookItem')
            ORDER BY s.relname, s.idx_scan DESC;
        `);

        console.log('Table               Index'.padEnd(65) + 'Scans'.padStart(10) + 'Tup.Read'.padStart(12) + 'Size'.padStart(10) + '  Type');
        console.log(sep('-'));
        for (const r of scanRows) {
            const type = r.is_primary ? 'PRIMARY' : r.is_unique ? 'UNIQUE' : r.is_partial ? 'PARTIAL' : 'INDEX';
            const zeroFlag = parseInt(r.scans) === 0 ? '  ← 0 scans' : '';
            console.log(
                `${r.table_name.padEnd(18)} ${r.index_name.padEnd(45)}` +
                parseInt(r.scans||0).toLocaleString().padStart(10) +
                parseInt(r.tuples_read||0).toLocaleString().padStart(12) +
                fmt(parseInt(r.index_bytes||0)).padStart(10) +
                `  ${type}${zeroFlag}`
            );
        }

        // ── 3. Constraint dependencies ────────────────────────────────────────
        console.log('\n\n[3] CONSTRAINT DEPENDENCIES\n' + sep());
        console.log('  (Indexes that support PK, UNIQUE constraints, or FK cannot be dropped)\n');
        const { rows: constRows } = await client.query(`
            SELECT
                t.relname   AS table_name,
                i.relname   AS index_name,
                con.conname AS constraint_name,
                con.contype AS constraint_type,
                CASE con.contype
                    WHEN 'p' THEN 'PRIMARY KEY'
                    WHEN 'u' THEN 'UNIQUE'
                    WHEN 'f' THEN 'FOREIGN KEY'
                    ELSE con.contype::text
                END AS type_label
            FROM pg_class t
            JOIN pg_index ix   ON t.oid = ix.indrelid
            JOIN pg_class i    ON i.oid = ix.indexrelid
            JOIN pg_constraint con ON con.conindid = ix.indexrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname IN ('Ledger', 'DailyBookItem')
            ORDER BY t.relname, con.contype;
        `);
        if (constRows.length === 0) {
            console.log('  No constraint-backed indexes found via pg_constraint.conindid.');
        }
        for (const r of constRows) {
            console.log(`  [${r.type_label}] "${r.table_name}"."${r.index_name}" → constraint "${r.constraint_name}"`);
        }

        // ── 4. Duplicate detection (exact column comparison) ──────────────────
        console.log('\n\n[4] DUPLICATE INDEX DETECTION (exact column+predicate comparison)\n' + sep());
        const { rows: dupRows } = await client.query(`
            SELECT
                t.relname                               AS table_name,
                array_agg(i.relname ORDER BY pg_relation_size(i.oid) DESC) AS duplicate_indexes,
                array_agg(pg_relation_size(i.oid) ORDER BY pg_relation_size(i.oid) DESC) AS sizes,
                array_agg(pg_get_indexdef(ix.indexrelid) ORDER BY pg_relation_size(i.oid) DESC) AS definitions,
                array_agg(ix.indisunique ORDER BY pg_relation_size(i.oid) DESC)  AS unique_flags,
                array_agg(ix.indisprimary ORDER BY pg_relation_size(i.oid) DESC) AS primary_flags,
                -- Key for grouping: normalized column list + predicate
                array_to_string(ARRAY(
                    SELECT pg_get_indexdef(ix.indexrelid, k + 1, true)
                    FROM generate_subscripts(ix.indkey, 1) AS k ORDER BY k
                ), ',')                                 AS col_key,
                COALESCE(pg_get_expr(ix.indpred, ix.indrelid), '')  AS predicate_key
            FROM pg_class t
            JOIN pg_index ix ON t.oid = ix.indrelid
            JOIN pg_class i  ON i.oid = ix.indexrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname IN ('Ledger', 'DailyBookItem')
              AND ix.indisvalid = true
            GROUP BY t.relname, col_key, predicate_key
            HAVING COUNT(*) > 1
            ORDER BY t.relname, SUM(pg_relation_size(i.oid)) DESC;
        `);

        if (dupRows.length === 0) {
            console.log('  ✅ No exact-column duplicates found.\n');
            console.log('  NOTE: Some indexes may have overlapping but non-identical column sets.');
            console.log('  See Section [5] for near-duplicate / subsumption analysis.');
        } else {
            let totalWastedBytes = 0;
            for (const r of dupRows) {
                const names   = r.duplicate_indexes;
                const sizes   = r.sizes.map(Number);
                const defs    = r.definitions;
                const uniques = r.unique_flags;
                const prims   = r.primary_flags;

                // The smallest duplicate(s) can be candidates for removal
                const wasted  = sizes.slice(1).reduce((a, b) => a + b, 0);
                totalWastedBytes += wasted;

                console.log(`\n  🔴 EXACT DUPLICATE GROUP on "${r.table_name}" — columns: [${r.col_key}]`);
                if (r.predicate_key) console.log(`     Partial predicate: WHERE ${r.predicate_key}`);
                console.log('');
                for (let idx = 0; idx < names.length; idx++) {
                    const role = prims[idx] ? '[PRIMARY KEY]' : uniques[idx] ? '[UNIQUE]' : '[INDEX]';
                    const keep = idx === 0 ? '  ← KEEP (largest, most mature)' : '  ← CANDIDATE FOR REMOVAL';
                    console.log(`     ${role} ${names[idx].padEnd(45)} ${fmt(sizes[idx])}${keep}`);
                    console.log(`            DEF: ${defs[idx]}`);
                }
                console.log(`\n     Potential saving: ${fmt(wasted)}`);
            }
            console.log(`\n  Total potential saving from exact duplicates: ${fmt(totalWastedBytes)}`);
        }

        // ── 5. Near-duplicate / subsumption analysis ──────────────────────────
        console.log('\n\n[5] NEAR-DUPLICATE ANALYSIS (leading column overlap)\n' + sep());
        console.log('  Checking indexes whose first column matches — may indicate subsumption.\n');
        const { rows: nearRows } = await client.query(`
            SELECT
                t.relname   AS table_name,
                i.relname   AS index_name,
                pg_relation_size(i.oid) AS index_bytes,
                ix.indisunique AS is_unique,
                ix.indisprimary AS is_primary,
                ix.indpred IS NOT NULL AS is_partial,
                COALESCE(pg_get_expr(ix.indpred, ix.indrelid), '') AS predicate,
                pg_get_indexdef(ix.indexrelid) AS full_def,
                array_to_string(ARRAY(
                    SELECT pg_get_indexdef(ix.indexrelid, k + 1, true)
                    FROM generate_subscripts(ix.indkey, 1) AS k
                    ORDER BY k
                ), ' | ') AS columns
            FROM pg_class t
            JOIN pg_index ix ON t.oid = ix.indrelid
            JOIN pg_class i  ON i.oid = ix.indexrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname IN ('Ledger', 'DailyBookItem')
              AND ix.indisvalid = true
            ORDER BY t.relname, columns, index_bytes DESC;
        `);

        // Group by table, then show leading column groups
        const byTable = {};
        for (const r of nearRows) {
            if (!byTable[r.table_name]) byTable[r.table_name] = [];
            byTable[r.table_name].push(r);
        }

        for (const [tbl, rows] of Object.entries(byTable)) {
            // Group by first column
            const byFirstCol = {};
            for (const r of rows) {
                const firstCol = r.columns.split(' | ')[0];
                if (!byFirstCol[firstCol]) byFirstCol[firstCol] = [];
                byFirstCol[firstCol].push(r);
            }
            for (const [firstCol, group] of Object.entries(byFirstCol)) {
                if (group.length < 2) continue;
                console.log(`  "${tbl}" — indexes sharing leading column [${firstCol}]:`);
                for (const r of group) {
                    const type = r.is_primary ? 'PK' : r.is_unique ? 'UQ' : r.is_partial ? 'PARTIAL' : '  ';
                    console.log(
                        `    [${type}] ${r.index_name.padEnd(45)} ${fmt(parseInt(r.index_bytes)).padStart(10)}  cols: ${r.columns}`
                    );
                    if (r.predicate) console.log(`          WHERE: ${r.predicate}`);
                }
                console.log('');
            }
        }

        // ── 6. Code-verified column requirements ──────────────────────────────
        console.log('\n[6] CRITICAL QUERY COLUMN REQUIREMENTS (from code analysis)\n' + sep());
        const requirements = [
            {
                query: 'FIFO / Latest debt lookup',
                code: 'WHERE customer_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1',
                needs: ['customer_id', 'deleted_at', 'created_at', 'id'],
                table: 'Ledger'
            },
            {
                query: 'Ledger GET (paginated history)',
                code: 'WHERE customer_id=$1 AND deleted_at IS NULL [cursor: created_at < $X OR (created_at = $X AND id < $Y)] ORDER BY created_at DESC, id DESC',
                needs: ['customer_id', 'deleted_at', 'created_at', 'id'],
                table: 'Ledger'
            },
            {
                query: 'Dashboard: DISTINCT ON latest debt per customer',
                code: 'WHERE deleted_at IS NULL ORDER BY customer_id, created_at DESC, id DESC',
                needs: ['deleted_at', 'customer_id', 'created_at', 'id'],
                table: 'Ledger'
            },
            {
                query: 'Dashboard: total payments / kg (type filter)',
                code: "WHERE type='PAYMENT'/'PRODUCT' AND deleted_at IS NULL",
                needs: ['type', 'deleted_at'],
                table: 'Ledger'
            },
            {
                query: 'Dashboard: weekly debt (created_at range)',
                code: "WHERE created_at >= date_trunc('week',...) AND deleted_at IS NULL",
                needs: ['created_at', 'deleted_at'],
                table: 'Ledger'
            },
            {
                query: 'Maqal PAIRS CTE — DailyBook date lookup',
                code: "SELECT DISTINCT date::date FROM DailyBook WHERE deleted_at IS NULL AND date >= '2026-08-31'",
                needs: ['deleted_at', 'date'],
                table: 'DailyBook'
            },
            {
                query: 'Maqal PAIRS CTE — Ledger reference_date lookup',
                code: "SELECT DISTINCT reference_date::date FROM Ledger WHERE type='PRODUCT' AND deleted_at IS NULL AND reference_date >= '2026-08-31'",
                needs: ['type', 'deleted_at', 'reference_date'],
                table: 'Ledger'
            },
            {
                query: 'Duplicate product date check (on insert)',
                code: "WHERE customer_id=$1 AND type='PRODUCT' AND reference_date = ANY($2) AND deleted_at IS NULL",
                needs: ['customer_id', 'type', 'reference_date', 'deleted_at'],
                table: 'Ledger'
            },
            {
                query: 'Receipt isolation / maqal_id lookup',
                code: 'WHERE receipt_id=$1 AND deleted_at IS NULL',
                needs: ['receipt_id', 'deleted_at'],
                table: 'Ledger'
            },
            {
                query: 'Payments page (type + created_at sort)',
                code: "WHERE type='PAYMENT' AND deleted_at IS NULL ORDER BY created_at DESC, id DESC",
                needs: ['type', 'deleted_at', 'created_at', 'id'],
                table: 'Ledger'
            },
            {
                query: 'DailyBookItem — customer entries for a book',
                code: 'WHERE daily_book_id=$1 AND customer_id=$2 AND deleted_at IS NULL',
                needs: ['daily_book_id', 'customer_id', 'deleted_at'],
                table: 'DailyBookItem'
            },
        ];

        for (const r of requirements) {
            console.log(`  [${r.table}] ${r.query}`);
            console.log(`    Columns needed: ${r.needs.join(', ')}`);
            console.log(`    Pattern: ${r.code.slice(0, 100)}`);
            console.log('');
        }

        // ── 7. Proposed removal list ──────────────────────────────────────────
        console.log('\n[7] INDEX ASSESSMENT SUMMARY\n' + sep());
        console.log('  Based on exact definitions, scan counts, constraint checks, and code analysis.\n');
        console.log('  Legend: CONFIRMED REDUNDANT | UNCERTAIN | RETAIN');
        console.log(sep('-'));

        // This will be populated after seeing section 4 output above — we do it dynamically
        // by re-querying the same data in a structured way
        const { rows: assessRows } = await client.query(`
            SELECT
                t.relname                               AS table_name,
                i.relname                               AS index_name,
                pg_relation_size(i.oid)                 AS index_bytes,
                ix.indisunique                          AS is_unique,
                ix.indisprimary                         AS is_primary,
                COALESCE(s.idx_scan, 0)                 AS scans,
                COALESCE(s.idx_tup_read, 0)             AS tup_read,
                ix.indpred IS NOT NULL                  AS is_partial,
                COALESCE(pg_get_expr(ix.indpred, ix.indrelid), '') AS predicate,
                array_to_string(ARRAY(
                    SELECT pg_get_indexdef(ix.indexrelid, k + 1, true)
                    FROM generate_subscripts(ix.indkey, 1) AS k
                    ORDER BY k
                ), ', ')                                AS columns,
                pg_get_indexdef(ix.indexrelid)          AS full_def
            FROM pg_class t
            JOIN pg_index ix ON t.oid = ix.indrelid
            JOIN pg_class i  ON i.oid = ix.indexrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            LEFT JOIN pg_stat_user_indexes s ON s.indexrelname = i.relname AND s.relname = t.relname
            WHERE n.nspname = 'public'
              AND t.relname IN ('Ledger', 'DailyBookItem')
              AND ix.indisvalid = true
            ORDER BY t.relname, index_bytes DESC;
        `);

        // Build a map for duplicate detection: col_key+predicate -> [indexes]
        const colKeyMap = {};
        for (const r of assessRows) {
            const key = `${r.table_name}::${r.columns}::${r.predicate}`;
            if (!colKeyMap[key]) colKeyMap[key] = [];
            colKeyMap[key].push(r);
        }

        const confirmed = [];
        const uncertain = [];

        for (const r of assessRows) {
            const key = `${r.table_name}::${r.columns}::${r.predicate}`;
            const group = colKeyMap[key];
            const isExactDup = group.length > 1;
            const isSmaller = isExactDup && parseInt(r.index_bytes) < Math.max(...group.map(g => parseInt(g.index_bytes)));

            if (r.is_primary) continue; // never remove PK
            if (r.is_unique) continue;  // never remove UNIQUE (may back a constraint)

            if (isExactDup && isSmaller) {
                confirmed.push({
                    table: r.table_name, name: r.index_name, bytes: parseInt(r.index_bytes),
                    scans: parseInt(r.scans), columns: r.columns, predicate: r.predicate,
                    reason: `Exact duplicate of a larger index covering identical columns [${r.columns}]${r.predicate ? ' WHERE ' + r.predicate : ''}`
                });
            } else if (parseInt(r.scans) === 0 && !r.is_primary && !r.is_unique) {
                uncertain.push({
                    table: r.table_name, name: r.index_name, bytes: parseInt(r.index_bytes),
                    scans: 0, columns: r.columns, predicate: r.predicate,
                    reason: `0 scans since stats reset (${statsReset}) — may support rare queries or just be unused`
                });
            }
        }

        console.log('\n  ✅ CONFIRMED REDUNDANT (exact-column duplicates, safe to remove with approval):');
        if (confirmed.length === 0) {
            console.log('     None — no exact-column duplicates detected.');
        } else {
            let totalSaving = 0;
            for (const c of confirmed) {
                totalSaving += c.bytes;
                console.log(`\n  DROP INDEX "${c.name}" ON "${c.table}";`);
                console.log(`     Columns:  ${c.columns}`);
                if (c.predicate) console.log(`     Predicate: WHERE ${c.predicate}`);
                console.log(`     Scans:    ${c.scans.toLocaleString()}`);
                console.log(`     Size:     ${fmt(c.bytes)}`);
                console.log(`     Reason:   ${c.reason}`);
            }
            console.log(`\n  Total confirmed saving: ${fmt(totalSaving)}`);
        }

        console.log('\n  ⚠️  UNCERTAIN (0 scans — requires further review before removal):');
        if (uncertain.length === 0) {
            console.log('     None.');
        } else {
            for (const u of uncertain) {
                console.log(`\n  ? "${u.name}" ON "${u.table}"`);
                console.log(`     Columns: ${u.columns}`);
                if (u.predicate) console.log(`     Predicate: WHERE ${u.predicate}`);
                console.log(`     Size:    ${fmt(u.bytes)}`);
                console.log(`     Reason:  ${u.reason}`);
            }
        }

        console.log('\n\n' + sep('='));
        console.log('  INVESTIGATION COMPLETE — READ-ONLY — No changes made');
        console.log(sep('=') + '\n');

    } catch (err) {
        console.error('Query error:', err.message);
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
