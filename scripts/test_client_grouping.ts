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

        // Oldest 3 receipts
        const oldestReceipts = receipts.slice(-3);
        oldestReceipts.forEach((r, idx) => {
            console.log(`\n=== Oldest Receipt [${idx}] (Display MQ: MQ#${r.displayMaqalId}) ===`);
            console.log('Title:', r.titleString);
            console.log('totalMaqalka:', r.totalMaqalka);
            console.log('totalPaid:', r.totalPaid);
            console.log('totalAdjustment:', r.totalAdjustment);
            console.log('openingBalance:', r.openingBalance);
            console.log('closingBalance:', r.closingBalance);
            console.log('Entries (' + r.entries.length + '):');
            r.entries.forEach(e => {
                console.log(`  * [${e.type}] ref_date: ${e.reference_date} | ${e.kg || '-'}KG @ $${e.price_per_kg || '-'} = $${e.amount} | note: ${e.note || '-'} | ID: ${e.id}`);
            });
        });

    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(console.error);
