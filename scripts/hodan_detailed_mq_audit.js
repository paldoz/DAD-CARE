require('dotenv').config({ path: '.env' });
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const MAQAL_PAIRS_CTE = `
    WITH past_dates AS (
        SELECT DISTINCT date::date AS db_date
        FROM "DailyBook"
        WHERE deleted_at IS NULL
    ),
    numbered_dates AS (
        SELECT db_date,
               ROW_NUMBER() OVER (ORDER BY db_date ASC) as rn
        FROM past_dates
    ),
    pairs AS (
        SELECT n1.db_date::date AS date1, n2.db_date::date AS date2,
               ((n1.rn + 1) / 2)::int AS mq_num
        FROM numbered_dates n1
        JOIN numbered_dates n2 ON n2.rn = n1.rn + 1
        WHERE n1.rn % 2 = 1
    )
`;

async function run() {
    const client = await pool.connect();
    try {
        const customerId = '96ee6785-ff35-4a40-9a06-a33186550004';

        // 1. Fetch authoritative DailyBook date pairs
        const { rows: allPairs } = await client.query(`
            ${MAQAL_PAIRS_CTE}
            SELECT mq_num, date1::text as date1, date2::text as date2
            FROM pairs ORDER BY mq_num ASC;
        `);

        // 2. Fetch all active ledger transactions for Hodan
        const { rows: txns } = await client.query(`
            SELECT id, type, amount, kg, price_per_kg, reference_date, created_at,
                   maqal_id, receipt_id, previous_debt, new_debt, note
            FROM "Ledger"
            WHERE customer_id = $1 AND deleted_at IS NULL
            ORDER BY created_at ASC, id ASC;
        `, [customerId]);

        // 3. Also fetch DailyBook records for Hodan directly to compare
        const { rows: dailyItems } = await client.query(`
            SELECT db.date::text as date, dbi.kg, dbi.note
            FROM "DailyBookItem" dbi
            JOIN "DailyBook" db ON dbi.daily_book_id = db.id
            WHERE dbi.customer_id = $1
              AND dbi.deleted_at IS NULL
              AND db.deleted_at IS NULL
            ORDER BY db.date ASC;
        `, [customerId]);

        console.log("==================================================================================================");
        console.log("                    HODAN — DETAILED READ-ONLY TRANSACTION & MAQAL AUDIT                          ");
        console.log("==================================================================================================\n");

        console.log("=== 1. DAILY BOOK ITEMS (GROUND TRUTH FOR PRODUCTS) ===");
        console.table(dailyItems.map(d => ({
            date: d.date.split('T')[0],
            kg: Number(d.kg),
            note: d.note || ''
        })));

        // Date -> mq_num lookup
        const dateToMq = new Map();
        for (const p of allPairs) {
            dateToMq.set(p.date1, p.mq_num);
            dateToMq.set(p.date2, p.mq_num);
        }

        console.log("\n=== 2. ALL ACTIVE LEDGER TRANSACTIONS GROUPED BY RECEIPT_ID & MAQAL_ID ===");
        const receiptMap = new Map();
        for (const t of txns) {
            const rKey = t.receipt_id || `NO_RECEIPT_${t.id}`;
            if (!receiptMap.has(rKey)) {
                receiptMap.set(rKey, []);
            }
            receiptMap.get(rKey).push(t);
        }

        let rIdx = 1;
        for (const [rKey, rTxns] of receiptMap.entries()) {
            const firstT = rTxns[0];
            const products = rTxns.filter(t => t.type === 'PRODUCT');
            const payments = rTxns.filter(t => t.type === 'PAYMENT');
            const adjustments = rTxns.filter(t => t.type === 'ADJUSTMENT');

            const prodSum = products.reduce((s, t) => s + Number(t.amount), 0);
            const paySum = payments.reduce((s, t) => s + Number(t.amount), 0);
            const adjSum = adjustments.reduce((s, t) => s + Number(t.amount), 0);

            const dates = Array.from(new Set(rTxns.map(t => t.reference_date ? String(t.reference_date).split('T')[0] : 'No Date')));
            const maqalIds = Array.from(new Set(rTxns.map(t => t.maqal_id)));

            console.log(`\n--------------------------------------------------------------------------------------------------`);
            console.log(`Receipt #${rIdx++} | ID: ${rKey.substring(0, 16)}... | Created: ${new Date(firstT.created_at).toISOString().replace('T', ' ').substring(0, 19)}`);
            console.log(`Dates: [${dates.join(', ')}] | DB maqal_id on rows: [${maqalIds.join(', ')}]`);
            console.log(`Products: $${prodSum} | Payments: $${paySum} | Adjustments: $${adjSum} | Ending Debt: $${Number(rTxns[rTxns.length - 1].new_debt)}`);
            console.log(`Transactions (${rTxns.length}):`);
            rTxns.forEach(t => {
                const dStr = t.reference_date ? String(t.reference_date).split('T')[0] : 'null';
                console.log(`   * [${t.type.padEnd(10)}] Amount: $${String(t.amount).padEnd(6)} | KG: ${String(t.kg || '-').padEnd(4)} @ $${String(t.price_per_kg || '-').padEnd(4)} | Date: ${dStr.padEnd(10)} | maqal_id: ${String(t.maqal_id).padEnd(4)} | Note: ${t.note || '-'} | ID: ${t.id}`);
            });
        }

    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(console.error);
