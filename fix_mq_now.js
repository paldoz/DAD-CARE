require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function run() {
    try {
        console.log("Searching for the customer with payments of 350, 285, 280, 210...");
        
        const payRes = await pool.query(`
            SELECT l.customer_id, c.name, l.amount, l.reference_date, l.id, l.created_at, l.receipt_id
            FROM "Ledger" l
            JOIN "Customer" c ON l.customer_id = c.id
            WHERE l.type = 'PAYMENT' 
              AND l.amount IN (280, 210, 350, 285) 
              AND l.deleted_at IS NULL
            ORDER BY l.created_at DESC
            LIMIT 50
        `);
        
        // Group by customer
        const customers = {};
        for (const p of payRes.rows) {
            if (!customers[p.customer_id]) customers[p.customer_id] = { name: p.name, payments: [] };
            customers[p.customer_id].payments.push(p);
        }
        
        for (const [custId, data] of Object.entries(customers)) {
            console.log(`\nCustomer: ${data.name} (${custId})`);
            data.payments.forEach(p => console.log(`- Amount: ${p.amount}, Date: ${p.reference_date}, ID: ${p.id}, Receipt: ${p.receipt_id}`));
        }
        
    } catch (e) {
        console.error("Error:", e);
    } finally {
        pool.end();
    }
}
run();
