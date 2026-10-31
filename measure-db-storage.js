/**
 * measure-db-storage.js
 * READ-ONLY diagnostic: measures actual Supabase PostgreSQL
 * database storage consumption by table, index, and dead tuples.
 * SAFE: zero writes, zero deletes, zero schema changes.
 */

require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

// Use transaction pooler (port 6543) — same as the live app uses
const connectionString = process.env.DATABASE_URL || process.env.DIRECT_URL;
if (!connectionString) {
    console.error('ERROR: No database connection string found in .env.local');
    process.exit(1);
}

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 1,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000,
});

function fmt(bytes) {
    if (bytes == null || isNaN(bytes)) return 'N/A';
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
}

function sep(char, len) {
    char = char || '-'; len = len || 80;
    return char.repeat(len);
}

async function run() {
    const client = await pool.connect();
    console.log('\n' + sep('='));
    console.log('  DADWORK LEDGER - DATABASE STORAGE AUDIT (READ-ONLY)');
    console.log(sep('='));

    try {

        // 1. Table sizes
        console.log('\n[1] TABLE SIZES\n' + sep());
        const { rows: tRows } = await client.query(`
            SELECT
                c.relname                               AS table_name,
                pg_total_relation_size(c.oid)           AS total_bytes,
                pg_relation_size(c.oid)                 AS data_bytes,
                pg_indexes_size(c.oid)                  AS index_bytes,
                c.reltuples::bigint                     AS est_rows
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r'
            ORDER BY total_bytes DESC;
        `);

        let grandTotal = 0;
        for (const r of tRows) { grandTotal += parseInt(r.total_bytes, 10) || 0; }

        console.log('Table                       Total       Data      Indexes    Est.Rows');
        console.log(sep('-'));
        for (const r of tRows) {
            const total = parseInt(r.total_bytes, 10) || 0;
            const pct   = grandTotal > 0 ? ((total / grandTotal) * 100).toFixed(1) : '0.0';
            console.log(
                r.table_name.padEnd(26) +
                fmt(total).padStart(10) +
                fmt(parseInt(r.data_bytes,10)||0).padStart(10) +
                fmt(parseInt(r.index_bytes,10)||0).padStart(10) +
                parseInt(r.est_rows||0).toLocaleString().padStart(12) +
                `  (${pct}%)`
            );
        }
        console.log(sep('-'));
        console.log('GRAND TOTAL'.padEnd(26) + fmt(grandTotal).padStart(10));

        // 2. Index details
        console.log('\n[2] INDEX SIZES\n' + sep());
        const { rows: idxRows } = await client.query(`
            SELECT
                t.relname                   AS table_name,
                i.relname                   AS index_name,
                pg_relation_size(i.oid)     AS index_bytes,
                ix.indisunique              AS is_unique,
                ix.indisprimary             AS is_primary
            FROM pg_class t
            JOIN pg_index ix ON t.oid = ix.indrelid
            JOIN pg_class i  ON i.oid = ix.indexrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relkind = 'r'
            ORDER BY index_bytes DESC;
        `);
        console.log('Table                     Index                                    Size        Type');
        console.log(sep('-'));
        for (const r of idxRows) {
            const type = r.is_primary ? 'PRIMARY' : r.is_unique ? 'UNIQUE' : 'INDEX';
            console.log(
                r.table_name.padEnd(24) +
                r.index_name.padEnd(40) +
                fmt(parseInt(r.index_bytes,10)||0).padStart(10) +
                '  ' + type
            );
        }

        // 3. Dead tuples / bloat
        console.log('\n[3] DEAD TUPLES & BLOAT\n' + sep());
        const { rows: statRows } = await client.query(`
            SELECT
                relname              AS table_name,
                n_live_tup           AS live_rows,
                n_dead_tup           AS dead_rows,
                CASE WHEN (n_live_tup + n_dead_tup) > 0
                     THEN ROUND(100.0 * n_dead_tup / (n_live_tup + n_dead_tup), 1)
                     ELSE 0 END      AS dead_pct,
                last_autovacuum
            FROM pg_stat_user_tables
            ORDER BY n_dead_tup DESC;
        `);
        console.log('Table                         Live        Dead    Dead%   Last Autovacuum');
        console.log(sep('-'));
        for (const r of statRows) {
            const deadPct = parseFloat(r.dead_pct || 0);
            const flag = deadPct > 10 ? '  WARNING:BLOAT' : '';
            console.log(
                r.table_name.padEnd(28) +
                parseInt(r.live_rows||0).toLocaleString().padStart(10) +
                parseInt(r.dead_rows||0).toLocaleString().padStart(10) +
                `${r.dead_pct||'0'}%`.padStart(8) +
                `   ${r.last_autovacuum ? new Date(r.last_autovacuum).toISOString().slice(0,16) : 'Never'}` +
                flag
            );
        }

        // 4. Exact row counts with soft-delete breakdown
        console.log('\n[4] EXACT ROW COUNTS (live vs soft-deleted)\n' + sep());
        const tables = [
            ['Customer', true], ['DailyBook', true], ['DailyBookItem', true],
            ['Ledger', true], ['AdminSession', false], ['AuditLog', false],
            ['User', true], ['CustomerNoteStatus', false]
        ];
        for (const [tbl, hasSoftDelete] of tables) {
            try {
                if (hasSoftDelete) {
                    const r = await client.query(
                        `SELECT COUNT(*) FILTER (WHERE deleted_at IS NULL)     AS live,
                                COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted
                         FROM "${tbl}"`
                    );
                    const live = parseInt(r.rows[0].live, 10);
                    const del  = parseInt(r.rows[0].deleted, 10);
                    const flag = del > 0 ? `  <-- ${del} soft-deleted rows` : '';
                    console.log(`  ${tbl.padEnd(24)} live: ${live.toLocaleString().padStart(6)}   soft-deleted: ${del.toLocaleString().padStart(6)}${flag}`);
                } else {
                    const r = await client.query(`SELECT COUNT(*) AS cnt FROM "${tbl}"`);
                    const cnt = parseInt(r.rows[0].cnt, 10);
                    console.log(`  ${tbl.padEnd(24)} total: ${cnt.toLocaleString().padStart(6)}`);
                }
            } catch (e) {
                console.log(`  ${tbl.padEnd(24)} ERROR: ${e.message}`);
            }
        }

        // 5. AuditLog breakdown
        console.log('\n[5] AUDITLOG AGE DISTRIBUTION\n' + sep());
        try {
            const { rows: auditAge } = await client.query(`
                SELECT
                    CASE
                        WHEN created_at >= NOW() - INTERVAL '1 day'   THEN 'Last 1 day'
                        WHEN created_at >= NOW() - INTERVAL '7 days'  THEN 'Last 7 days'
                        WHEN created_at >= NOW() - INTERVAL '30 days' THEN 'Last 30 days'
                        ELSE '> 30 days (auto-cleanup eligible)'
                    END AS age_bucket,
                    COUNT(*) AS cnt
                FROM "AuditLog"
                GROUP BY 1
                ORDER BY MIN(created_at);
            `);
            for (const r of auditAge) {
                console.log(`  ${r.age_bucket.padEnd(35)} ${parseInt(r.cnt).toLocaleString()} rows`);
            }
            const { rows: auditTop } = await client.query(`
                SELECT action, COUNT(*) AS cnt FROM "AuditLog"
                GROUP BY action ORDER BY cnt DESC LIMIT 10;
            `);
            console.log('\n  Top action types:');
            for (const r of auditTop) {
                console.log(`    ${r.action.padEnd(35)} ${parseInt(r.cnt).toLocaleString()} rows`);
            }
        } catch (e) { console.log('  AuditLog error: ' + e.message); }

        // 6. AdminSession breakdown
        console.log('\n[6] ADMINSESSION STATUS\n' + sep());
        try {
            const { rows: sess } = await client.query(`
                SELECT
                    COUNT(*) FILTER (WHERE expires_at > NOW())  AS active,
                    COUNT(*) FILTER (WHERE expires_at <= NOW()) AS expired,
                    MIN(login_at) AS oldest, MAX(login_at) AS newest
                FROM "AdminSession";
            `);
            const s = sess[0];
            console.log(`  Active sessions (not expired): ${parseInt(s.active||0)}`);
            console.log(`  Expired/stale sessions:        ${parseInt(s.expired||0)}`);
            console.log(`  Oldest session:                ${s.oldest ? new Date(s.oldest).toISOString().slice(0,16) : 'N/A'}`);
        } catch (e) { console.log('  AdminSession error: ' + e.message); }

        // 7. Large column check
        console.log('\n[7] LARGE TEXT COLUMNS (avg/max character length)\n' + sep());
        const textChecks = [
            ['AuditLog', 'details'], ['AuditLog', 'user_agent'],
            ['AdminSession', 'user_agent'], ['Ledger', 'note'],
            ['DailyBookItem', 'note'],
        ];
        for (const [tbl, col] of textChecks) {
            try {
                const { rows } = await client.query(
                    `SELECT ROUND(AVG(length(${col}::text))) AS avg_len,
                            MAX(length(${col}::text))        AS max_len,
                            COUNT(*) FILTER (WHERE ${col} IS NOT NULL) AS cnt
                     FROM "${tbl}"`
                );
                const r = rows[0];
                console.log(`  ${tbl}.${col.padEnd(22)} avg: ${(r.avg_len||0).toString().padStart(5)} chars   max: ${(r.max_len||0).toString().padStart(5)} chars   rows-with-value: ${r.cnt||0}`);
            } catch { console.log(`  ${tbl}.${col} — not found`); }
        }

        // 8. Final summary
        console.log('\n' + sep('='));
        console.log('  SUMMARY');
        console.log(sep('='));
        const FREE_PLAN_BYTES = 500 * 1024 * 1024;
        console.log(`  Measured DB size : ${fmt(grandTotal)}`);
        console.log(`  Free plan limit  : 500 MB`);
        console.log(`  Headroom         : ~${fmt(FREE_PLAN_BYTES - grandTotal)}`);
        console.log(`  Usage %          : ${((grandTotal / FREE_PLAN_BYTES) * 100).toFixed(1)}%`);
        console.log('\n  READ-ONLY AUDIT COMPLETE. No data was modified.\n');

    } catch (err) {
        console.error('Fatal query error:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
