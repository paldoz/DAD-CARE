const { Client } = require('pg');

const NEW_DB = 'postgresql://postgres.cfepckoviapjbxpauldr:0frWmNafDE1JzS6E@aws-1-eu-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true';

async function test() {
    const client = new Client({ connectionString: NEW_DB, ssl: { rejectUnauthorized: false } });
    await client.connect();
    
    try {
        const query = `
                WITH prev_pair AS (
                    SELECT
                        ('2026-06-28'::date + (
                            GREATEST(0, ((NOW() AT TIME ZONE 'Africa/Mogadishu')::date - '2026-06-28'::date) - 2) / 2 * 2 - 2
                        )::int * '1 day'::interval)::date AS date1,
                        ('2026-06-28'::date + (
                            GREATEST(0, ((NOW() AT TIME ZONE 'Africa/Mogadishu')::date - '2026-06-28'::date) - 2) / 2 * 2 - 1
                        )::int * '1 day'::interval)::date AS date2
                )
                SELECT
                    c.id, c.name, c.customer_code,
                    CASE WHEN c.deleted_at IS NOT NULL THEN true ELSE false END as is_inactive,
                    COALESCE(dbk.total_books_count, 0) as total_books_count,
                    CASE WHEN COALESCE(dbk.total_daily_kg, 0) > COALESCE(lk.total_ledger_kg, 0) THEN 1 ELSE 0 END as unprocessed_books_count,
                    CASE
                        WHEN COALESCE(td.prev_pair_ledger_count, 0) >= 2 THEN true
                        WHEN (c.created_at AT TIME ZONE 'Africa/Mogadishu')::date > (SELECT date2 FROM prev_pair) THEN true
                        ELSE false
                    END as is_target_days_done
                FROM "Customer" c
                LEFT JOIN (
                    SELECT customer_id, COUNT(DISTINCT id) as total_books_count, SUM(kg) as total_daily_kg
                    FROM "DailyBookItem" WHERE kg > 0 AND deleted_at IS NULL GROUP BY customer_id
                ) dbk ON c.id = dbk.customer_id
                LEFT JOIN (
                    SELECT customer_id, SUM(kg) as total_ledger_kg
                    FROM "Ledger" WHERE type = 'PRODUCT' AND deleted_at IS NULL GROUP BY customer_id
                ) lk ON c.id = lk.customer_id
                LEFT JOIN (
                    SELECT customer_id,
                        COUNT(DISTINCT COALESCE((reference_date AT TIME ZONE 'Africa/Mogadishu')::date, (created_at AT TIME ZONE 'Africa/Mogadishu')::date)) as prev_pair_ledger_count
                    FROM "Ledger"
                    WHERE type = 'PRODUCT' AND deleted_at IS NULL
                      AND COALESCE((reference_date AT TIME ZONE 'Africa/Mogadishu')::date, (created_at AT TIME ZONE 'Africa/Mogadishu')::date)
                            IN (SELECT date1 FROM prev_pair UNION SELECT date2 FROM prev_pair)
                    GROUP BY customer_id
                ) td ON c.id = td.customer_id
                ORDER BY c.name ASC;
            `;
        const res = await client.query(query);
        console.log("SUCCESS! Rows returned:", res.rows.length);
    } catch (e) {
        console.error("SQL ERROR:", e.message);
    }
    
    await client.end();
}

test();
