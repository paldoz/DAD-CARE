require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SACDIYO_ID = '45c8377c-810f-40af-b50e-5319f2f3e9a3';

async function run() {
    const client = await pool.connect();
    try {
        // ============================================================
        // 1. Inspect DailyBook and DailyBookItem schema
        // ============================================================
        const { rows: dbCols } = await client.query(
            `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='DailyBook' ORDER BY ordinal_position`
        );
        console.log('=== DailyBook COLUMNS ===');
        console.log(dbCols.map(c => `${c.column_name}(${c.data_type})`).join(', '));

        const { rows: dbiCols } = await client.query(
            `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='DailyBookItem' ORDER BY ordinal_position`
        );
        console.log('\n=== DailyBookItem COLUMNS ===');
        console.log(dbiCols.map(c => `${c.column_name}(${c.data_type})`).join(', '));

        // ============================================================
        // 2. Find earliest Sacdiyo Maqals (maqal_id <= 5) to see July 14
        // ============================================================
        const { rows: earlyMaqals } = await client.query(`
            SELECT 
                id, type, customer_id, maqal_id, receipt_id,
                reference_date::text, amount, kg, price_per_kg,
                previous_debt, new_debt,
                created_at::text, deleted_at::text, deleted_by
            FROM "Ledger"
            WHERE customer_id = $1
            ORDER BY reference_date ASC, created_at ASC
            LIMIT 40
        `, [SACDIYO_ID]);

        console.log('\n=== EARLIEST 40 LEDGER ROWS FOR SACDIYO ===');
        for (const r of earlyMaqals) {
            const del = r.deleted_at ? ` [DELETED at ${r.deleted_at}]` : '';
            console.log(`  [${r.type.padEnd(11)}] maqal=${r.maqal_id} date=${r.reference_date} amount=${r.amount} kg=${r.kg}${del}`);
        }

        // Look specifically for July 14
        const { rows: july14rows } = await client.query(`
            SELECT * FROM "Ledger"
            WHERE customer_id = $1 AND reference_date = '2026-07-14'
        `, [SACDIYO_ID]);
        console.log(`\n=== July 14 ROWS (active + deleted) ===`);
        if (july14rows.length === 0) {
            console.log('  NONE FOUND — July 14 has NO rows in Ledger for Sacdiyo');
        } else {
            console.log(JSON.stringify(july14rows, null, 2));
        }

        // July 15
        const { rows: july15rows } = await client.query(`
            SELECT * FROM "Ledger"
            WHERE customer_id = $1 AND reference_date = '2026-07-15'
        `, [SACDIYO_ID]);
        console.log(`\n=== July 15 ROWS ===`);
        console.log(july15rows.length === 0 ? '  NONE FOUND' : JSON.stringify(july15rows, null, 2));

        // ============================================================
        // 3. DailyBook entries near July 14 period
        // ============================================================
        const { rows: dailyBooks } = await client.query(`
            SELECT * FROM "DailyBook"
            WHERE date BETWEEN '2026-07-01' AND '2026-07-31'
            ORDER BY date ASC
        `);
        console.log(`\n=== DailyBook rows for July 2026 ===`);
        console.log(`Total July DailyBook rows: ${dailyBooks.length}`);
        console.log(JSON.stringify(dailyBooks, null, 2));

        // ============================================================
        // 4. DailyBookItem near July 14 period — find Sacdiyo items
        // ============================================================
        // First find the DailyBook IDs for July
        const dailyBookIds = dailyBooks.map(db => db.id);
        if (dailyBookIds.length > 0) {
            const { rows: dbiRows } = await client.query(`
                SELECT dbi.*, db.date::text as book_date
                FROM "DailyBookItem" dbi
                JOIN "DailyBook" db ON db.id = dbi.daily_book_id
                WHERE dbi.customer_id = $1 AND db.date BETWEEN '2026-07-01' AND '2026-07-31'
                ORDER BY db.date ASC
            `, [SACDIYO_ID]);
            console.log(`\n=== DailyBookItem rows for Sacdiyo in July 2026 ===`);
            console.log(`Total: ${dbiRows.length}`);
            console.log(JSON.stringify(dbiRows, null, 2));
        }

        // ============================================================
        // 5. What is the VERY FIRST maqal for Sacdiyo?
        // ============================================================
        const { rows: firstMaqalRows } = await client.query(`
            SELECT id, type, maqal_id, receipt_id, reference_date::text, amount, kg, price_per_kg,
                   previous_debt, new_debt, created_at::text, deleted_at::text
            FROM "Ledger"
            WHERE customer_id = $1
            ORDER BY reference_date ASC, created_at ASC
            LIMIT 10
        `, [SACDIYO_ID]);
        
        console.log('\n=== FIRST 10 LEDGER ROWS FOR SACDIYO (all time) ===');
        for (const r of firstMaqalRows) {
            const del = r.deleted_at ? ` [DELETED]` : '';
            console.log(`  [${r.type.padEnd(11)}] maqal_id=${r.maqal_id} date=${r.reference_date} amount=${r.amount} receipt_id=${r.receipt_id ? r.receipt_id.substring(0,16) : 'null'}${del}`);
        }

        // ============================================================
        // 6. Find what maqal_id values exist for Sacdiyo (distinct)
        // ============================================================
        const { rows: distinctMaqals } = await client.query(`
            SELECT maqal_id, 
                   MIN(reference_date)::text as first_date, 
                   MAX(reference_date)::text as last_date,
                   COUNT(*) as total_rows,
                   COUNT(*) FILTER (WHERE type='PRODUCT') as products,
                   COUNT(*) FILTER (WHERE type='PAYMENT') as payments,
                   COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) as soft_deleted
            FROM "Ledger"
            WHERE customer_id = $1
            GROUP BY maqal_id
            ORDER BY MIN(reference_date) ASC
        `, [SACDIYO_ID]);
        
        console.log('\n=== DISTINCT MAQAL_IDs FOR SACDIYO ===');
        for (const m of distinctMaqals) {
            const delNote = m.soft_deleted > 0 ? ` (${m.soft_deleted} deleted)` : '';
            console.log(`  maqal_id=${m.maqal_id || 'NULL'}: ${m.first_date} → ${m.last_date} | products=${m.products} payments=${m.payments}${delNote}`);
        }

    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(console.error);
