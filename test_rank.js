import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function testRank() {
  try {
    const query = `
      WITH customer_stats AS (
          SELECT 
              c.id,
              CASE 
                  WHEN COALESCE(lk.total_ledger_maqal, 0) = 0 THEN 0
                  ELSE LEAST(100, ROUND((COALESCE(p.total_paid, 0) / lk.total_ledger_maqal) * 100))::int
              END as pct,
              COALESCE(p.total_paid, 0) as total_paid,
              COALESCE(dbk.total_daily_kg, 0) as total_kg
          FROM "Customer" c
          LEFT JOIN (
              SELECT customer_id, SUM(amount) as total_paid
              FROM "Ledger"
              WHERE type = 'PAYMENT' AND deleted_at IS NULL
              GROUP BY customer_id
          ) p ON c.id = p.customer_id
          LEFT JOIN (
              SELECT customer_id, SUM(amount) as total_ledger_maqal
              FROM "Ledger"
              WHERE type = 'PRODUCT' AND deleted_at IS NULL
              GROUP BY customer_id
          ) lk ON c.id = lk.customer_id
          LEFT JOIN (
              SELECT customer_id, SUM(kg) as total_daily_kg
              FROM "DailyBookItem"
              WHERE kg > 0 AND deleted_at IS NULL
              GROUP BY customer_id
          ) dbk ON c.id = dbk.customer_id
          WHERE c.deleted_at IS NULL
      ),
      ranked_customers AS (
          SELECT 
              id,
              pct,
              total_paid,
              total_kg,
              RANK() OVER (ORDER BY pct DESC, total_paid DESC, total_kg DESC, id ASC) as rank,
              COUNT(*) OVER() as total_customers
          FROM customer_stats
      )
      SELECT * FROM ranked_customers ORDER BY rank ASC LIMIT 5;
    `;
    const res = await pool.query(query);
    console.log("SUCCESS! Top 5 customers:");
    console.table(res.rows);
  } catch (e) {
    console.error("ERROR:", e);
  } finally {
    pool.end();
  }
}

testRank();
