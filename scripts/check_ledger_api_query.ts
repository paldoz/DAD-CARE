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
        
        // This is the EXACT query in app/api/ledger/route.ts:
        const { rows: txns } = await client.query(
            `SELECT id, customer_id, type, reference_date, kg, price_per_kg, amount, previous_debt, new_debt, note, receipt_id, edit_count, created_at, maqal_id FROM "Ledger"
             WHERE customer_id = $1 AND deleted_at IS NULL
             ORDER BY created_at DESC, id DESC`,
            [customerId]
        );

        console.log(`Total rows returned by /api/ledger: ${txns.length}`);

        // Find all PRODUCT transactions on July 14, 15, 16, 17
        const julyTxns = txns.filter(t => {
            const d = t.reference_date ? String(t.reference_date) : '';
            return d.includes('2026-07-13') || d.includes('2026-07-14') || d.includes('2026-07-15') || d.includes('2026-07-16') || d.includes('2026-07-17');
        });

        console.log('\n=== JULY 14-17 TRANSACTIONS IN /api/ledger ===');
        console.table(julyTxns.map(t => ({
            id: t.id,
            type: t.type,
            amount: t.amount,
            kg: t.kg,
            price: t.price_per_kg,
            reference_date: t.reference_date,
            created_at: t.created_at,
            receipt_id: t.receipt_id,
            maqal_id: t.maqal_id,
            prev_debt: t.previous_debt,
            new_debt: t.new_debt
        })));

    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(console.error);
