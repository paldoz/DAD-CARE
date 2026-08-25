require('dotenv').config({ path: '.env' });
const { Pool } = require('pg');
const { format } = require('date-fns');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    const client = await pool.connect();
    try {
        const customerId = '96ee6785-ff35-4a40-9a06-a33186550004';
        const { rows: rawTxns } = await client.query(`
            SELECT id, customer_id, type, reference_date, kg, price_per_kg, amount, previous_debt, new_debt, note, receipt_id, edit_count, created_at
            FROM "Ledger"
            WHERE customer_id = $1 AND deleted_at IS NULL
            ORDER BY created_at DESC, id DESC;
        `, [customerId]);

        // This is what /api/ledger returns
        const allTxns = rawTxns.map(t => ({
            ...t,
            amount: Number(t.amount || 0),
            kg: t.kg != null ? Number(t.kg) : undefined,
            price_per_kg: t.price_per_kg != null ? Number(t.price_per_kg) : undefined,
            previous_debt: Number(t.previous_debt || 0),
            new_debt: Number(t.new_debt || 0)
        }));

        const { groupTransactionsInfoReceipts } = require('../app/utils/ledgerHelpers');
        const receipts = groupTransactionsInfoReceipts(allTxns);

        console.log(`Total receipts produced: ${receipts.length}`);
        const lastReceipt = receipts[receipts.length - 1]; // oldest receipt (MQ#1)

        console.log('\n=== OLDEST RECEIPT (MQ#1) IN BROWSER STATE ===');
        console.log('Title:', lastReceipt.titleString);
        console.log('totalMaqalka:', lastReceipt.totalMaqalka);
        console.log('totalPaid:', lastReceipt.totalPaid);
        console.log('totalAdjustment:', lastReceipt.totalAdjustment);
        console.log('openingBalance:', lastReceipt.openingBalance);
        console.log('closingBalance:', lastReceipt.closingBalance);
        console.log('Entries count:', lastReceipt.entries.length);

        console.log('\nEntries in oldest receipt:');
        lastReceipt.entries.forEach(e => {
            console.log(` - [${e.type}] ${e.reference_date} | ${e.kg}KG @ $${e.price_per_kg} = $${e.amount} | note: ${e.note} | ID: ${e.id}`);
        });

    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(console.error);
