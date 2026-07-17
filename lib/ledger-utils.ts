import pool from '@/lib/db';

/**
 * Recalculates the running debt for a customer's ledger from a specific point in time forward.
 * We fetch all active ledgers for the customer, ordered by created_at ASC, and recalculate
 * previous_debt and new_debt.
 */
export async function recalculateCustomerLedger(customerId: string, client: any = pool) {
    // We lock the customer rows if this is inside a transaction, but let's assume
    // client could be a transaction client or the main pool.
    
    await client.query(`
        WITH recalculated AS (
            SELECT 
                id,
                COALESCE(SUM(
                    CASE WHEN type IN ('PRODUCT', 'ADJUSTMENT') THEN amount
                         WHEN type = 'PAYMENT' THEN -amount
                         ELSE 0 END
                ) OVER (
                    PARTITION BY customer_id 
                    ORDER BY created_at ASC, id ASC 
                    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                ), 0) as prev,
                SUM(
                    CASE WHEN type IN ('PRODUCT', 'ADJUSTMENT') THEN amount
                         WHEN type = 'PAYMENT' THEN -amount
                         ELSE 0 END
                ) OVER (
                    PARTITION BY customer_id 
                    ORDER BY created_at ASC, id ASC
                ) as new_val
            FROM "Ledger"
            WHERE customer_id = $1::text AND deleted_at IS NULL
        )
        UPDATE "Ledger" l
        SET previous_debt = r.prev, new_debt = r.new_val
        FROM recalculated r
        WHERE l.id = r.id AND (l.previous_debt != r.prev OR l.new_debt != r.new_val)
    `, [customerId]);

    const { rows } = await client.query(`
        SELECT new_debt FROM "Ledger"
        WHERE customer_id = $1::text AND deleted_at IS NULL
        ORDER BY created_at DESC, id DESC LIMIT 1
    `, [customerId]);

    return rows.length > 0 ? parseFloat(rows[0].new_debt) : 0;
}
