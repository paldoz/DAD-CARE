import 'dotenv/config';
import { Pool } from 'pg';
import { groupTransactionsInfoReceipts, type Transaction } from '../app/utils/ledgerHelpers';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    const client = await pool.connect();
    try {
        const customerId = '96ee6785-ff35-4a40-9a06-a33186550004';
        const { rows: rawTxns } = await client.query(`
            SELECT id, customer_id, type, reference_date, kg, price_per_kg, amount, previous_debt, new_debt, note, receipt_id, edit_count, created_at, maqal_id
            FROM "Ledger"
            WHERE customer_id = $1 AND deleted_at IS NULL
            ORDER BY created_at DESC, id DESC;
        `, [customerId]);

        const allTxns: Transaction[] = rawTxns.map(t => ({
            ...t,
            amount: Number(t.amount || 0),
            kg: t.kg != null ? Number(t.kg) : undefined,
            price_per_kg: t.price_per_kg != null ? Number(t.price_per_kg) : undefined,
            previous_debt: Number(t.previous_debt || 0),
            new_debt: Number(t.new_debt || 0)
        }));

        const receipts = groupTransactionsInfoReceipts(allTxns);
        console.log(`Total receipts produced: ${receipts.length}`);

        receipts.forEach((r, idx) => {
            console.log(`\n[${idx}] Display: ⚡MQ#${r.displayMaqalId} (DB: ${r.maqalId}) | Title: ${r.titleString}`);
            console.log(`     Maqalka: $${r.totalMaqalka} | Paid: $${r.totalPaid} | Adj: $${r.totalAdjustment} | Close: $${r.closingBalance}`);
            console.log(`     Products (${r.entries.filter(e => e.type === 'PRODUCT').length}):`);
            r.entries.filter(e => e.type === 'PRODUCT').forEach(p => {
                console.log(`       - ${p.reference_date ? String(p.reference_date).split('T')[0] : 'no-date'}: ${p.kg}KG @ $${p.price_per_kg} = $${p.amount} (ID: ${p.id.substring(0,8)})`);
            });
        });

    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(console.error);
