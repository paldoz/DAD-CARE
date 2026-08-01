import pool from './lib/db';
import { getAllCustomerStats } from './app/utils/rankHelpers';

async function main() {
    try {
        console.log("Fetching stats...");
        const stats = await getAllCustomerStats(pool);
        console.log(`Fetched ${stats.length} stats.`);
        
        const jsScoresCte = `
            js_scores (customer_id, reliability_score, perfect_maqals, last_completed_reesto) AS (
                VALUES 
                ${stats.length > 0 ? stats.map((s: any) => `('${s.id}'::uuid, ${s.pct}, ${s.perfect_maqals}, ${s.last_completed_reesto})`).join(',\n                ') : `(NULL::uuid, 0, 0, 0)`}
            ),
            reliability_scores AS (
                SELECT customer_id, reliability_score, last_completed_reesto FROM js_scores WHERE customer_id IS NOT NULL
            ),
            gs_scores AS (
                SELECT customer_id, perfect_maqals FROM js_scores WHERE customer_id IS NOT NULL
            )
        `;
        
        console.log("CTE generated successfully. Length:", jsScoresCte.length);
        
        // Execute dummy query to test syntax
        const query = `
            WITH ${jsScoresCte}
            SELECT * FROM reliability_scores LIMIT 5;
        `;
        
        const res = await pool.query(query);
        console.log("Query executed successfully. Rows:", res.rows.length);
    } catch (e: any) {
        console.error("ERROR:", e.message);
    } finally {
        pool.end();
    }
}

main();
