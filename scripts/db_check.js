const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

async function main() {
  try {
    const counts = await pool.query(`
      SELECT 
        (SELECT count(*)::int FROM "Customer" WHERE deleted_at IS NULL AND is_kabarka = false) as total_customers,
        (SELECT count(*)::int FROM "Ledger" WHERE deleted_at IS NULL) as total_ledger,
        (SELECT count(*)::int FROM "Ledger" WHERE type='PAYMENT' AND deleted_at IS NULL) as total_payments,
        (SELECT count(*)::int FROM "Ledger" WHERE type='PRODUCT' AND deleted_at IS NULL) as total_products
    `);
    console.log('=== DB Counts ===');
    console.log(JSON.stringify(counts.rows[0], null, 2));

    const stats = await pool.query(`
      WITH valid_ledger AS (
        SELECT DISTINCT ON (l.customer_id) 
          l.customer_id, 
          l.new_debt,
          c.name,
          c.customer_code as code
        FROM "Ledger" l
        JOIN "Customer" c ON c.id = l.customer_id
        WHERE l.deleted_at IS NULL AND c.deleted_at IS NULL AND c.is_kabarka = false
        ORDER BY l.customer_id, l.created_at DESC, l.id DESC
      ),
      top_debtors AS (
        SELECT customer_id as id, name, code, new_debt as debt
        FROM valid_ledger
        WHERE new_debt > 0
        ORDER BY new_debt DESC
        LIMIT 5
      )
      SELECT 
        (SELECT count(*)::int FROM "Customer" WHERE deleted_at IS NULL AND is_kabarka = false) as total_customers,
        (SELECT COALESCE(SUM(CASE WHEN new_debt > 0 THEN new_debt ELSE 0 END), 0)::float FROM valid_ledger) as total_debt,
        (SELECT COALESCE(SUM(amount), 0)::float FROM "Ledger" WHERE type = 'PAYMENT' AND deleted_at IS NULL) as total_paid,
        (SELECT COALESCE(json_agg(td.*), '[]'::json) FROM top_debtors td) as top_debtors_json
    `);
    console.log('\n=== Dashboard Stats ===');
    console.log(JSON.stringify(stats.rows[0], null, 2));

    const payments = await pool.query(`
      SELECT l.id, l.amount, l.created_at, c.name as customer_name
      FROM "Ledger" l
      JOIN "Customer" c ON c.id = l.customer_id
      WHERE l.deleted_at IS NULL AND l.type = 'PAYMENT' AND COALESCE(l.amount, 0) > 0
      ORDER BY l.created_at DESC
      LIMIT 5
    `);
    console.log('\n=== Recent Payments ===');
    console.log(JSON.stringify(payments.rows, null, 2));

  } catch(e) {
    console.error('ERROR:', e.message);
  } finally {
    await pool.end();
  }
}

main();
