import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    const client = await pool.connect();
    try {
        const customerId = '96ee6785-ff35-4a40-9a06-a33186550004';
        
        const { rows: txns } = await client.query(
            `SELECT id, customer_id, type, reference_date, kg, price_per_kg, amount, previous_debt, new_debt, note, receipt_id, edit_count, created_at, maqal_id FROM "Ledger"
             WHERE customer_id = $1 AND deleted_at IS NULL
             ORDER BY created_at ASC, id ASC
             LIMIT 10;`,
            [customerId]
        );

        console.log('=== OLDEST 10 TRANSACTIONS FOR HODAN ===');
        console.table(txns.map(t => ({
            id: t.id,
            type: t.type,
            amount: Number(t.amount),
            kg: t.kg,
            price: t.price_per_kg,
            reference_date: t.reference_date ? String(t.reference_date) : 'null',
            created_at: new Date(t.created_at).toISOString(),
            receipt_id: t.receipt_id,
            maqal_id: t.maqal_id,
            prev_debt: Number(t.previous_debt),
            new_debt: Number(t.new_debt)
        })));

    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(console.error);
