require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DIRECT_URL, ssl: { rejectUnauthorized: false } });

async function listAll() {
  const { rows } = await pool.query(`
    SELECT
        t.relname AS table_name,
        i.relname AS index_name,
        pg_size_pretty(pg_relation_size(i.oid)) AS size,
        pg_relation_size(i.oid) AS bytes,
        pg_get_indexdef(i.oid) AS def,
        s.idx_scan,
        s.idx_tup_read
    FROM pg_class t
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class i  ON i.oid = ix.indexrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    LEFT JOIN pg_stat_user_indexes s ON s.indexrelname = i.relname AND s.relname = t.relname
    WHERE n.nspname = 'public'
      AND t.relname IN ('Ledger', 'DailyBookItem')
    ORDER BY t.relname, pg_relation_size(i.oid) DESC;
  `);
  console.log(JSON.stringify(rows, null, 2));
  await pool.end();
}
listAll().catch(console.error);
