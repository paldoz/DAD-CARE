const { Client } = require('pg');
const fs = require('fs');

const SHARED_RELIABILITY_CTE = `
    receipt_groups AS (
        SELECT 
            customer_id,
            COALESCE(
                'maqal_' || maqal_id, 
                'pair_' || FLOOR((COALESCE(reference_date::date, created_at::date) - '2026-06-28'::date) / 2)::text
            ) as group_key,
            MIN(COALESCE(reference_date::timestamp, created_at::timestamp)) as sort_date,
            SUM(CASE WHEN type = 'PRODUCT' THEN amount ELSE 0 END) as product_amount,
            SUM(CASE WHEN type IN ('PRODUCT', 'ADJUSTMENT') THEN amount ELSE 0 END) as debt_amount,
            SUM(CASE WHEN type = 'PAYMENT' THEN amount ELSE 0 END) as group_paid
        FROM "Ledger"
        WHERE deleted_at IS NULL
        GROUP BY customer_id, group_key
    ),
    ordered_groups AS (
        SELECT 
            *,
            SUM(GREATEST(0, debt_amount)) OVER (PARTITION BY customer_id ORDER BY sort_date ASC, group_key ASC) as running_owed,
            ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY sort_date DESC, group_key DESC) as maqal_rank
        FROM receipt_groups
    ),
    completed_maqals AS (
        SELECT 
            customer_id,
            debt_amount,
            product_amount,
            group_paid,
            CASE WHEN debt_amount = 0 THEN 100 ELSE LEAST(100, ROUND((group_paid::numeric / debt_amount::numeric) * 100))::int END as maqal_pct,
            ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY sort_date DESC, group_key DESC) as completed_rank
        FROM ordered_groups
        WHERE maqal_rank > 1
    ),
    reliability_scores AS (
        SELECT 
            customer_id,
            SUM(
                CASE 
                    WHEN completed_rank = 1 THEN maqal_pct * 35
                    WHEN completed_rank = 2 THEN maqal_pct * 25
                    WHEN completed_rank = 3 THEN maqal_pct * 20
                    WHEN completed_rank = 4 THEN maqal_pct * 12
                    WHEN completed_rank = 5 THEN maqal_pct * 8
                    ELSE 0
                END
            ) / NULLIF(SUM(
                CASE 
                    WHEN completed_rank = 1 THEN 35
                    WHEN completed_rank = 2 THEN 25
                    WHEN completed_rank = 3 THEN 20
                    WHEN completed_rank = 4 THEN 12
                    WHEN completed_rank = 5 THEN 8
                    ELSE 0
                END
            ), 0) as reliability_score,
            MAX(CASE WHEN completed_rank = 1 THEN GREATEST(0, debt_amount - group_paid) ELSE 0 END) as last_completed_reesto
        FROM completed_maqals
        WHERE completed_rank <= 5
        GROUP BY customer_id
    )
`;

const client = new Client({
    connectionString: "postgresql://postgres.omjmjihinxbtilnirsco:ki6pw8TKnb4bqrjC@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
});

async function run() {
    await client.connect();
    
    // First query: Dump ordered_groups for Nasra Cadow
    const query1 = `
        WITH ${SHARED_RELIABILITY_CTE}
        SELECT 
            c.name,
            o.group_key,
            o.sort_date,
            o.debt_amount,
            o.group_paid,
            o.maqal_rank,
            CASE WHEN o.debt_amount = 0 THEN 100 ELSE LEAST(100, ROUND((o.group_paid::numeric / o.debt_amount::numeric) * 100))::int END as maqal_pct,
            rs.reliability_score
        FROM ordered_groups o
        JOIN "Customer" c ON o.customer_id = c.id
        LEFT JOIN reliability_scores rs ON o.customer_id = rs.customer_id
        WHERE c.name ILIKE '%nasra cadow%'
        ORDER BY o.sort_date DESC, o.group_key DESC;
    `;
    
    const res1 = await client.query(query1);
    fs.writeFileSync('nasra_debug.json', JSON.stringify(res1.rows, null, 2));
    await client.end();
}

run().catch(console.error);
