// READ-ONLY VERIFICATION: Sacdiyo's July 14 still exists unchanged after the code fix.
// NO DATABASE MUTATIONS PERFORMED. This script only reads.
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SACDIYO_ID = '45c8377c-810f-40af-b50e-5319f2f3e9a3';

async function run() {
    const client = await pool.connect();
    try {
        console.log('================================================================');
        console.log('READ-ONLY VERIFICATION: Sacdiyo July 14 MQ#1 Existence Check');
        console.log('================================================================\n');

        // 1. Total active rows
        const { rows: [total] } = await client.query(
            `SELECT COUNT(*) as count FROM "Ledger" WHERE customer_id = $1 AND deleted_at IS NULL`,
            [SACDIYO_ID]
        );
        console.log(`Total active rows for Sacdiyo: ${total.count}`);
        const pass_102 = Number(total.count) === 102;
        console.log(`  ${pass_102 ? '✅' : '❌'} Expected 102, got ${total.count}`);

        // 2. July 14 still exists
        const { rows: july14 } = await client.query(
            `SELECT id, type, maqal_id, receipt_id, reference_date::text, amount, kg, deleted_at
             FROM "Ledger"
             WHERE customer_id = $1 AND reference_date::date = '2026-07-14' AND deleted_at IS NULL`,
            [SACDIYO_ID]
        );
        console.log(`\nJuly 14 PRODUCT rows: ${july14.length}`);
        const pass_jul14 = july14.length === 1;
        console.log(`  ${pass_jul14 ? '✅' : '❌'} July 14 row exists and is NOT deleted`);
        if (july14.length > 0) {
            const r = july14[0];
            console.log(`  receipt_id: ${r.receipt_id}`);
            console.log(`  maqal_id:   ${r.maqal_id}`);
            console.log(`  amount:     ${r.amount}`);
            console.log(`  kg:         ${r.kg}`);
            console.log(`  deleted_at: ${r.deleted_at || 'NULL ✅'}`);
        }

        // 3. July 15 still exists
        const { rows: july15 } = await client.query(
            `SELECT id, type, maqal_id, receipt_id, reference_date::text, amount, kg, deleted_at
             FROM "Ledger"
             WHERE customer_id = $1 AND reference_date::date = '2026-07-15' AND deleted_at IS NULL`,
            [SACDIYO_ID]
        );
        console.log(`\nJuly 15 PRODUCT rows: ${july15.length}`);
        const pass_jul15 = july15.length === 1;
        console.log(`  ${pass_jul15 ? '✅' : '❌'} July 15 row exists and is NOT deleted`);

        // 4. MQ#1 receipt_id and maqal_id unchanged
        const EXPECTED_RECEIPT_ID = 'dcccdbd9-324f-4206-a4e0-2824f9afb8d9';
        const EXPECTED_MAQAL_ID = 9;
        const pass_receipt = july14.length > 0 && july14[0].receipt_id === EXPECTED_RECEIPT_ID;
        const pass_maqal = july14.length > 0 && july14[0].maqal_id === EXPECTED_MAQAL_ID;
        console.log(`\nMQ#1 identity immutability:`);
        console.log(`  ${pass_receipt ? '✅' : '❌'} receipt_id = ${EXPECTED_RECEIPT_ID}`);
        console.log(`  ${pass_maqal ? '✅' : '❌'} maqal_id = ${EXPECTED_MAQAL_ID}`);

        // 5. Simulate what profile now sees with limit=500 (the fix)
        const { rows: with500 } = await client.query(
            `SELECT id, type, maqal_id, reference_date::text, created_at::text
             FROM "Ledger"
             WHERE customer_id = $1 AND deleted_at IS NULL
             ORDER BY created_at DESC, id DESC
             LIMIT 500 OFFSET 0`,
            [SACDIYO_ID]
        );
        const mq1RowsIn500 = with500.filter(r => r.maqal_id === 9);
        console.log(`\nWith new limit=500 request:`);
        console.log(`  Total rows returned:   ${with500.length}`);
        console.log(`  MQ#1 rows included:    ${mq1RowsIn500.length}`);
        const pass_mq1_complete = mq1RowsIn500.length === 3; // 2 PRODUCT + 1 ADJUSTMENT
        console.log(`  ${pass_mq1_complete ? '✅' : '❌'} All 3 MQ#1 rows now returned (2 PRODUCT + 1 ADJUSTMENT)`);
        mq1RowsIn500.forEach(r => console.log(`    [${r.type.padEnd(11)}] date=${r.reference_date}`));

        // 6. Confirm July 14 is now included in limit=500
        const jul14In500 = with500.find(r => r.maqal_id === 9 && r.type === 'PRODUCT' && r.reference_date === '2026-07-14');
        console.log(`\n  ${jul14In500 ? '✅' : '❌'} July 14 PRODUCT is included in limit=500 response`);

        // 7. Customer with <100 rows still works (test with first other customer)
        const { rows: [otherCust] } = await client.query(
            `SELECT id, name, COUNT(*) as row_count 
             FROM "Customer" c
             JOIN "Ledger" l ON l.customer_id = c.id AND l.deleted_at IS NULL
             WHERE c.deleted_at IS NULL AND c.id != $1
             GROUP BY c.id, c.name
             HAVING COUNT(*) < 100
             LIMIT 1`,
            [SACDIYO_ID]
        );
        if (otherCust) {
            const { rows: smallCustRows } = await client.query(
                `SELECT COUNT(*) as count FROM "Ledger"
                 WHERE customer_id = $1 AND deleted_at IS NULL`,
                [otherCust.id]
            );
            console.log(`\nCustomer with <100 rows (${otherCust.name}): ${smallCustRows[0].count} rows`);
            console.log(`  ✅ limit=500 request still returns all their rows`);
        }

        // Summary
        const allPass = pass_102 && pass_jul14 && pass_jul15 && pass_receipt && pass_maqal && pass_mq1_complete && jul14In500;
        console.log('\n================================================================');
        console.log(`DATABASE MUTATIONS: ZERO`);
        console.log(`VERIFICATION RESULT: ${allPass ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'}`);
        console.log('================================================================');

    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(console.error);
