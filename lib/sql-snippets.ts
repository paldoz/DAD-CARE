export const SHARED_RELIABILITY_CTE = `
    receipt_groups AS (
        SELECT 
            customer_id,
            COALESCE(
                'maqal_' || maqal_id, 
                'receipt_' || receipt_id,
                CASE 
                    WHEN type = 'PAYMENT' THEN 'pay_' || id::text
                    ELSE 'batch_' || FLOOR(EXTRACT(EPOCH FROM COALESCE(reference_date, created_at)) / 15)::text 
                END
            ) as group_key,
            MIN(COALESCE(reference_date::timestamp, created_at::timestamp)) as sort_date,
            SUM(CASE WHEN type = 'PRODUCT' THEN amount ELSE 0 END) as product_amount,
            SUM(CASE WHEN type IN ('PRODUCT', 'ADJUSTMENT') THEN amount ELSE 0 END) as debt_amount,
            SUM(CASE WHEN type = 'PAYMENT' THEN amount ELSE 0 END) as group_paid
        FROM "Ledger"
        WHERE deleted_at IS NULL
        GROUP BY customer_id, group_key
    ),
    valid_maqals AS (
        SELECT * FROM receipt_groups
        WHERE group_key LIKE 'maqal_%' OR product_amount > 0
    ),
    ordered_groups AS (
        SELECT 
            *,
            SUM(GREATEST(0, debt_amount)) OVER (PARTITION BY customer_id ORDER BY sort_date ASC, group_key ASC) as running_owed,
            ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY sort_date DESC, group_key DESC) as maqal_rank
        FROM valid_maqals
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
