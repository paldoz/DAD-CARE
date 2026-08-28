require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SACDIYO_ID = '45c8377c-810f-40af-b50e-5319f2f3e9a3';

async function run() {
    const client = await pool.connect();
    try {
        // Total active rows for Sacdiyo
        const { rows: [total] } = await client.query(
            `SELECT COUNT(*) as count FROM "Ledger" WHERE customer_id = $1 AND deleted_at IS NULL`,
            [SACDIYO_ID]
        );
        console.log(`Total active rows for Sacdiyo: ${total.count}`);

        // What does the API return with limit=100, offset=0 (ORDER BY created_at DESC)?
        const { rows: first100 } = await client.query(
            `SELECT id, type, maqal_id, reference_date::text, created_at::text
             FROM "Ledger"
             WHERE customer_id = $1 AND deleted_at IS NULL
             ORDER BY created_at DESC, id DESC
             LIMIT 100 OFFSET 0`,
            [SACDIYO_ID]
        );
        console.log(`\nRows returned with LIMIT 100 (newest first): ${first100.length}`);
        
        // What is the date range covered?
        const dates = first100.map(r => r.reference_date).sort();
        console.log(`Dates covered: ${dates[0]} to ${dates[dates.length-1]}`);
        
        // Are the MQ#1 rows (maqal_id=9) included in first 100?
        const mq1InFirst100 = first100.filter(r => r.maqal_id === 9);
        console.log(`MQ#1 (maqal_id=9) rows in first 100: ${mq1InFirst100.length}`);
        mq1InFirst100.forEach(r => console.log(`  [${r.type}] date=${r.reference_date} created=${r.created_at}`));

        // What are the OLDEST rows that get cut off (after limit=100)?
        const { rows: allRows } = await client.query(
            `SELECT id, type, maqal_id, reference_date::text, created_at::text
             FROM "Ledger"
             WHERE customer_id = $1 AND deleted_at IS NULL
             ORDER BY created_at DESC, id DESC`,
            [SACDIYO_ID]
        );
        console.log(`\nTotal rows ordered newest-first: ${allRows.length}`);
        
        // Rows 101+ that would be MISSED by limit=100
        if (allRows.length > 100) {
            const missed = allRows.slice(100);
            console.log(`\nRows MISSED by initial limit=100 (oldest, would need loadMore):`);
            missed.forEach(r => console.log(`  [${r.type}] maqal_id=${r.maqal_id} date=${r.reference_date} created=${r.created_at}`));
            
            const missedMQ1 = missed.filter(r => r.maqal_id === 9);
            if (missedMQ1.length > 0) {
                console.log(`\n⚠️  MQ#1 ROWS MISSED: ${missedMQ1.length} rows from maqal_id=9 are beyond limit=100!`);
            } else {
                console.log('\n✅ All MQ#1 rows ARE included in first 100');
            }
        }
        
        // Show the created_at timestamps for MQ#1 rows to understand ordering
        console.log('\n=== MQ#1 rows ordered by created_at ===');
        const { rows: mq1All } = await client.query(
            `SELECT id, type, maqal_id, reference_date::text, created_at::text
             FROM "Ledger"
             WHERE customer_id = $1 AND maqal_id = 9 AND deleted_at IS NULL
             ORDER BY created_at ASC`,
            [SACDIYO_ID]
        );
        mq1All.forEach(r => console.log(`  [${r.type}] date=${r.reference_date} created=${r.created_at}`));
        
        // The key insight: created_at of MQ#1 rows vs row #100 boundary
        if (allRows.length >= 100) {
            const row100 = allRows[99]; // 0-indexed
            console.log(`\nRow #100 (last row in limit=100): type=${row100.type} maqal_id=${row100.maqal_id} date=${row100.reference_date} created=${row100.created_at}`);
            const row101 = allRows[100];
            if (row101) {
                console.log(`Row #101 (first MISSED row): type=${row101.type} maqal_id=${row101.maqal_id} date=${row101.reference_date} created=${row101.created_at}`);
            }
        }

        // Was Sacdiyo's MQ#1 created BEFORE row#100 boundary (older created_at)?
        // The API orders by created_at DESC, so the oldest rows are at the end.
        // If MQ#1 has old created_at, it will be beyond limit=100.

    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(console.error);
