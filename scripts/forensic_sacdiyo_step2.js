require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Sacdiyo primary ID
const SACDIYO_ID = '45c8377c-810f-40af-b50e-5319f2f3e9a3';

async function run() {
    const client = await pool.connect();
    try {
        // ============================================================
        // 1. ALL LEDGER ROWS (including soft-deleted) for Sacdiyo
        // ============================================================
        const { rows: allLedger } = await client.query(`
            SELECT 
                id, type, customer_id, maqal_id, receipt_id,
                reference_date::text, amount, kg, price_per_kg,
                previous_debt, new_debt,
                created_at::text, deleted_at::text, deleted_by
            FROM "Ledger"
            WHERE customer_id = $1
            ORDER BY reference_date ASC, created_at ASC
        `, [SACDIYO_ID]);

        const active = allLedger.filter(r => !r.deleted_at);
        const deleted = allLedger.filter(r => r.deleted_at);

        console.log('================================================================');
        console.log('SACDIYO (45c8377c) — ALL LEDGER ROWS (READ-ONLY FORENSIC DUMP)');
        console.log('================================================================');
        console.log(`Total rows: ${allLedger.length}  (active: ${active.length}, soft-deleted: ${deleted.length})\n`);

        // Group active rows by maqal_id
        const byMaqal = {};
        for (const r of active) {
            const key = r.maqal_id || 'NULL';
            if (!byMaqal[key]) byMaqal[key] = [];
            byMaqal[key].push(r);
        }

        const sortedMaqals = Object.keys(byMaqal).sort((a, b) => Number(a) - Number(b));
        for (const maqalKey of sortedMaqals) {
            const rows = byMaqal[maqalKey];
            const products = rows.filter(r => r.type === 'PRODUCT');
            const payments = rows.filter(r => r.type === 'PAYMENT');
            const adjustments = rows.filter(r => r.type === 'ADJUSTMENT');
            
            // Find date range from reference_dates
            const dates = rows.map(r => r.reference_date).sort();
            const productDates = products.map(r => r.reference_date).sort();
            
            console.log(`--- maqal_id=${maqalKey} ---`);
            console.log(`  reference_dates in maqal: ${[...new Set(dates)].join(', ')}`);
            console.log(`  PRODUCT reference_dates:  ${productDates.join(', ')}`);
            console.log(`  Products:    ${products.length}`);
            console.log(`  Payments:    ${payments.length}`);
            console.log(`  Adjustments: ${adjustments.length}`);
            for (const r of rows) {
                const shortId = r.id.substring(0, 8);
                console.log(`  [${r.type.padEnd(11)}] id=${shortId} date=${r.reference_date} amount=${r.amount} kg=${r.kg} receipt_id=${r.receipt_id ? r.receipt_id.substring(0, 20) : 'null'}`);
            }
            console.log();
        }

        // ============================================================
        // 2. SOFT-DELETED ROWS
        // ============================================================
        if (deleted.length > 0) {
            console.log('================================================================');
            console.log('SOFT-DELETED ROWS (still in database)');
            console.log('================================================================');
            for (const r of deleted) {
                console.log(`  [${r.type.padEnd(11)}] id=${r.id.substring(0,8)} maqal=${r.maqal_id} date=${r.reference_date} amount=${r.amount} deleted_at=${r.deleted_at} by=${r.deleted_by}`);
            }
            console.log();
        }

        // ============================================================
        // 3. CHECK DailyBook TABLE SCHEMA AND ROWS FOR SACDIYO
        // ============================================================
        try {
            const { rows: dbCols } = await client.query(
                `SELECT column_name FROM information_schema.columns WHERE table_name='DailyBook' ORDER BY ordinal_position`
            );
            console.log('================================================================');
            console.log('DailyBook TABLE COLUMNS');
            console.log('================================================================');
            console.log(dbCols.map(c => c.column_name).join(', '));

            const { rows: dailyBook } = await client.query(`
                SELECT * FROM "DailyBook"
                WHERE customer_id = $1
                ORDER BY date ASC
            `, [SACDIYO_ID]);
            console.log(`\nDailyBook rows for Sacdiyo: ${dailyBook.length}`);
            if (dailyBook.length > 0) {
                console.log(JSON.stringify(dailyBook, null, 2));
            }
        } catch (e) {
            console.log(`DailyBook table not found or error: ${e.message}`);
        }

        // ============================================================
        // 4. CHECK MaqalPair / Maqal table if it exists
        // ============================================================
        const { rows: tables } = await client.query(`
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema='public' ORDER BY table_name
        `);
        console.log('\n================================================================');
        console.log('ALL PUBLIC TABLES');
        console.log('================================================================');
        console.log(tables.map(t => t.table_name).join(', '));

        // Look for a Maqal-specific table
        const maqalTables = tables.filter(t => t.table_name.toLowerCase().includes('maqal'));
        for (const t of maqalTables) {
            console.log(`\n--- Table: ${t.table_name} ---`);
            const { rows: mcols } = await client.query(
                `SELECT column_name FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`,
                [t.table_name]
            );
            console.log('Columns:', mcols.map(c => c.column_name).join(', '));
            const { rows: mrows } = await client.query(
                `SELECT * FROM "${t.table_name}" WHERE customer_id = $1 ORDER BY 1 LIMIT 50`,
                [SACDIYO_ID]
            ).catch(() => ({ rows: [] }));
            if (mrows.length > 0) {
                console.log(JSON.stringify(mrows.slice(0, 20), null, 2));
            }
        }

    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(console.error);
