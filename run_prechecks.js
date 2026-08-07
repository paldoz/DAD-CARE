const { Pool } = require('pg');
const fs = require('fs');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({ 
    connectionString: process.env.DIRECT_URL,
    ssl: { rejectUnauthorized: false }
});

async function runPrechecks() {
    try {
        console.log("--- MIGRATION PRECHECKS ---");
        
        // Check 1: Is it a Constraint?
        const constraintCheck = await pool.query(`
            SELECT conname
            FROM pg_constraint
            WHERE conname = 'Customer_customer_code_key';
        `);
        console.log("\\n1. Constraint Check:", constraintCheck.rows.length > 0 ? "YES, it is a constraint." : "NO, not a constraint.");

        // Check 2: Is it an Index?
        const indexCheck = await pool.query(`
            SELECT indexname
            FROM pg_indexes
            WHERE indexname = 'Customer_customer_code_key';
        `);
        console.log("2. Index Check:", indexCheck.rows.length > 0 ? "YES, it is an index." : "NO, not an index.");

        // Check 3: Any active duplicates?
        const duplicateCheck = await pool.query(`
            SELECT customer_code, COUNT(*) as count
            FROM "Customer"
            WHERE deleted_at IS NULL
            GROUP BY customer_code
            HAVING COUNT(*) > 1;
        `);
        console.log("\\n3. Active Duplicates Check:");
        if (duplicateCheck.rows.length === 0) {
            console.log("SUCCESS: No active duplicate customer codes found.");
        } else {
            console.log("FAILED: Duplicates found!", duplicateCheck.rows);
        }

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await pool.end();
    }
}

runPrechecks();
