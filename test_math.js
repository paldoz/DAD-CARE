const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dadcare'
});

async function run() {
  const query = `
        WITH past_dates AS (
            SELECT DISTINCT date::date AS db_date
            FROM "DailyBook"
            WHERE deleted_at IS NULL
        ),
        numbered_dates AS (
            SELECT db_date,
                   ROW_NUMBER() OVER (ORDER BY db_date DESC) as rn
            FROM past_dates
        ),
        numbered_pairs AS (
            SELECT date1, date2,
                   ROW_NUMBER() OVER (ORDER BY date2 ASC) as mq_num
            FROM (
                SELECT n2.db_date::date as date1, n1.db_date::date as date2
                FROM numbered_dates n1
                JOIN numbered_dates n2 ON n1.rn = n2.rn - 1
                WHERE n1.rn % 2 = 1
            ) all_pairs
        ),
        filtered_pairs AS (
            SELECT date1, date2, mq_num
            FROM numbered_pairs
        ),
        mq_dailybook_items AS (
            SELECT fp.mq_num, dbi.customer_id, c.name AS customer_name, c.customer_code, SUM(dbi.kg) AS db_kg
            FROM filtered_pairs fp
            JOIN "DailyBook" db ON db.date::date IN (fp.date1, fp.date2) AND db.deleted_at IS NULL
            JOIN "DailyBookItem" dbi ON dbi.daily_book_id = db.id AND dbi.deleted_at IS NULL
            JOIN "Customer" c ON c.id = dbi.customer_id
            GROUP BY fp.mq_num, dbi.customer_id, c.name, c.customer_code
        ),
        mq_product_details AS (
            SELECT 
                fp.mq_num, 
                l.customer_id, 
                SUM(l.amount) AS expected,
                MAX(l.price_per_kg) AS price_per_kg,
                COALESCE(SUM(CASE WHEN COALESCE(l.reference_date::date, l.created_at::date) = fp.date1 THEN l.kg ELSE 0 END), 0) AS kg_day1,
                COALESCE(SUM(CASE WHEN COALESCE(l.reference_date::date, l.created_at::date) = fp.date2 THEN l.kg ELSE 0 END), 0) AS kg_day2
            FROM filtered_pairs fp
            JOIN "Ledger" l ON l.type = 'PRODUCT'
                            AND l.deleted_at IS NULL
                            AND COALESCE(l.reference_date::date, l.created_at::date) IN (fp.date1, fp.date2)
            GROUP BY fp.mq_num, l.customer_id
        ),
        specific_payments AS (
            SELECT customer_id, maqal_id AS mq_num, SUM(ABS(amount)) AS amount
            FROM "Ledger" 
            WHERE type = 'PAYMENT' AND deleted_at IS NULL AND maqal_id IS NOT NULL
            GROUP BY customer_id, maqal_id
        )
        SELECT
            fp.mq_num,
            fp.date1::text,
            fp.date2::text,
            COUNT(DISTINCT dbi.customer_id)          AS total_customers,
            COALESCE(SUM(mpd.expected), 0)           AS expected,
            COALESCE(SUM(COALESCE(sp.amount, 0)), 0) AS paid,
            COALESCE(SUM(dbi.db_kg), 0)              AS kg,
            JSON_AGG(
                JSON_BUILD_OBJECT(
                    'customer_id',   dbi.customer_id,
                    'name',          dbi.customer_name,
                    'code',          dbi.customer_code,
                    'expected',      COALESCE(mpd.expected, 0),
                    'paid',          COALESCE(sp.amount, 0),
                    'kg',            COALESCE(dbi.db_kg, 0),
                    'price_per_kg',  COALESCE(mpd.price_per_kg, 0),
                    'kg_day1',       COALESCE(mpd.kg_day1, 0),
                    'kg_day2',       COALESCE(mpd.kg_day2, 0)
                )
            ) FILTER (WHERE dbi.customer_id IS NOT NULL) AS customer_data
        FROM filtered_pairs fp
        LEFT JOIN mq_dailybook_items dbi ON dbi.mq_num = fp.mq_num
        LEFT JOIN mq_product_details mpd ON mpd.mq_num = fp.mq_num AND mpd.customer_id = dbi.customer_id
        LEFT JOIN specific_payments sp ON sp.customer_id = dbi.customer_id AND sp.mq_num = fp.mq_num
        GROUP BY fp.mq_num, fp.date1, fp.date2
        ORDER BY fp.mq_num ASC
    `;

  const result = await pool.query(query);

  const untaggedResult = await pool.query(`
        SELECT customer_id, SUM(ABS(amount)) AS total_untagged
        FROM "Ledger"
        WHERE type = 'PAYMENT' AND deleted_at IS NULL AND maqal_id IS NULL
        GROUP BY customer_id
    `);
  const untaggedPool = new Map();
  for (const row of untaggedResult.rows) {
      untaggedPool.set(row.customer_id, Number(row.total_untagged || 0));
  }

  if (result.rows.length > 0) {
      const earliestDate = result.rows[0].date1;
      const preMqDebtResult = await pool.query(`
          SELECT customer_id, SUM(amount) AS pre_debt
          FROM "Ledger"
          WHERE type = 'PRODUCT' AND deleted_at IS NULL 
            AND COALESCE(reference_date::date, created_at::date) < $1
          GROUP BY customer_id
      `, [earliestDate]);
      for (const row of preMqDebtResult.rows) {
          const cId = row.customer_id;
          const preDebt = Number(row.pre_debt || 0);
          if (preDebt > 0 && untaggedPool.has(cId)) {
              const available = untaggedPool.get(cId);
              const drained = Math.min(available, preDebt);
              untaggedPool.set(cId, available - drained);
          }
      }
  }

  const rawMqs = result.rows.map(row => {
      const rawCustomers = typeof row.customer_data === 'string'
          ? JSON.parse(row.customer_data)
          : (row.customer_data || []);
      return {
          mq_num:    Number(row.mq_num),
          rawCustomers,
      };
  });

  const mqs = rawMqs.map(row => {
      const customers = row.rawCustomers.map(c => {
          const cId        = c.customer_id;
          const expected   = Number(c.expected    || 0);
          const specificPaid = Number(c.paid      || 0); 
          const remaining_after_specific = Math.max(0, expected - specificPaid);

          let waterfallApplied = 0;
          if (remaining_after_specific > 0 && (untaggedPool.get(cId) || 0) > 0) {
              const available = untaggedPool.get(cId);
              waterfallApplied = Math.min(available, remaining_after_specific);
              untaggedPool.set(cId, available - waterfallApplied);
          }
          const totalPaid  = specificPaid + waterfallApplied;

          return {
              name:       c.name,
              expected,
              paid:       totalPaid,
              specific:   specificPaid,
              waterfall:  waterfallApplied,
          };
      });

      return {
          mqNumber: row.mq_num,
          customers,
      };
  });

  const mq14 = mqs.find(m => m.mqNumber === 14);
  if (mq14) {
    const dahabo = mq14.customers.find(c => c.name.toLowerCase().includes('dahabo xasan'));
    console.log('MQ14 Dahabo:', dahabo);
  } else {
    console.log('No MQ14 found!');
  }
  process.exit(0);
}
run().catch(console.dir);
