require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SACDIYO_ID = '45c8377c-810f-40af-b50e-5319f2f3e9a3';
const MAQAL_EPOCH = '2026-07-14';

async function run() {
    const client = await pool.connect();
    try {
        // ============================================================
        // 1. Run the actual MAQAL_PAIRS_CTE and verify MQ#1
        // ============================================================
        const { rows: pairs } = await client.query(`
            WITH pairs AS (
                SELECT
                    (1 + i)::int AS mq_num,
                    ('${MAQAL_EPOCH}'::date + (i * 2))::date AS date1,
                    ('${MAQAL_EPOCH}'::date + (i * 2 + 1))::date AS date2,
                    (9 + i)::int AS maqal_id
                FROM generate_series(0, GREATEST(
                    CEIL(((CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Mogadishu')::date - '${MAQAL_EPOCH}'::date) / 2.0)::int + 1,
                    COALESCE((SELECT CEIL((MAX(date) - '${MAQAL_EPOCH}'::date) / 2.0)::int FROM "DailyBook" WHERE deleted_at IS NULL), 0),
                    COALESCE((SELECT CEIL((MAX(reference_date) - '${MAQAL_EPOCH}'::date) / 2.0)::int FROM "Ledger" WHERE deleted_at IS NULL), 0)
                )) AS i
            )
            SELECT mq_num, date1::text, date2::text, maqal_id FROM pairs ORDER BY mq_num ASC LIMIT 10
        `);
        
        console.log('================================================================');
        console.log('AUTHORITATIVE MAQAL PAIRS (from CTE, first 10)');
        console.log('================================================================');
        for (const p of pairs) {
            console.log(`  MQ#${p.mq_num} (maqal_id=${p.maqal_id}): date1=${p.date1} date2=${p.date2}`);
        }

        // ============================================================
        // 2. Look at the ACTUAL database rows for MQ#1 (maqal_id=9)
        //    Focus: what reference_date values exist for maqal_id=9?
        // ============================================================
        const { rows: mq1rows } = await client.query(`
            SELECT id, type, customer_id, maqal_id, receipt_id,
                   reference_date, reference_date::text as ref_text,
                   amount, kg, price_per_kg,
                   previous_debt, new_debt,
                   created_at, created_at::text as created_text,
                   deleted_at
            FROM "Ledger"
            WHERE customer_id = $1 AND maqal_id = 9
            ORDER BY reference_date ASC, created_at ASC
        `, [SACDIYO_ID]);
        
        console.log('\n================================================================');
        console.log('RAW DB ROWS FOR SACDIYO MQ#1 (maqal_id=9) — INCLUDING TIMEZONE');
        console.log('================================================================');
        for (const r of mq1rows) {
            // Show the raw UTC timestamp vs the date-only string
            console.log(`  [${r.type}] id=${r.id.substring(0,8)}`);
            console.log(`    reference_date (raw):    ${r.reference_date}`);
            console.log(`    reference_date (::text): ${r.ref_text}`);
            console.log(`    created_at:              ${r.created_text}`);
            console.log(`    amount=${r.amount} kg=${r.kg} price=${r.price_per_kg}`);
            console.log(`    deleted_at: ${r.deleted_at || 'NULL (active)'}`);
            console.log(`    receipt_id: ${r.receipt_id}`);
            console.log();
        }
        
        // ============================================================
        // 3. Check: does the Ledger store dates in UTC causing timezone shift?
        //    E.g. 2026-07-14T00:00:00+03:00 stored as 2026-07-13T21:00:00Z?
        // ============================================================
        console.log('================================================================');
        console.log('TIMEZONE DIAGNOSIS FOR MQ#1 PRODUCT ROWS');
        console.log('================================================================');
        const { rows: tzRows } = await client.query(`
            SELECT 
                id,
                reference_date::text as date_text,
                reference_date AT TIME ZONE 'UTC' as utc_ts,
                reference_date AT TIME ZONE 'Africa/Mogadishu' as mogadishu_ts
            FROM "Ledger"
            WHERE customer_id = $1 AND maqal_id = 9 AND type = 'PRODUCT'
        `, [SACDIYO_ID]);
        for (const r of tzRows) {
            console.log(`  id=${r.id.substring(0,8)}`);
            console.log(`    reference_date (text):      ${r.date_text}`);
            console.log(`    AT TIME ZONE UTC:           ${r.utc_ts}`);
            console.log(`    AT TIME ZONE Mogadishu:     ${r.mogadishu_ts}`);
        }

        // ============================================================
        // 4. How does the API fetch data for the customer profile?
        //    Look at what /api/ledger returns for Sacdiyo
        // ============================================================
        console.log('\n================================================================');
        console.log('QUERY SIMULATION: What GET /api/ledger returns for Sacdiyo');
        console.log('(using same reference_date::text cast the API uses)');
        console.log('================================================================');
        const { rows: apiSim } = await client.query(`
            SELECT 
                id, type, maqal_id, receipt_id,
                reference_date::text as reference_date,
                amount, kg, price_per_kg,
                previous_debt, new_debt,
                created_at::text as created_at,
                customer_id,
                deleted_at IS NULL as is_active
            FROM "Ledger"
            WHERE customer_id = $1 AND deleted_at IS NULL
              AND maqal_id IN (9, 10)
            ORDER BY reference_date ASC, created_at ASC
        `, [SACDIYO_ID]);
        
        for (const r of apiSim) {
            console.log(`  [${r.type.padEnd(11)}] maqal=${r.maqal_id} reference_date="${r.reference_date}" amount=${r.amount}`);
        }

        // ============================================================
        // 5. Check the titleString logic for MQ#1 — what dates will it show?
        //    The groupTransactionsInfoReceipts uses:
        //    productDates from reference_date, then:
        //    uniqueDates = format(d, 'dd MMM')
        //    When reference_date = '2026-07-13' (because of UTC shift),
        //    it shows "13 Jul" not "14 Jul"
        // ============================================================
        console.log('\n================================================================');
        console.log('DATE PARSING SIMULATION');
        console.log('Simulating how JavaScript parses reference_date strings');
        console.log('================================================================');
        const { rows: prodRows } = await client.query(`
            SELECT reference_date::text as ref_text
            FROM "Ledger"
            WHERE customer_id = $1 AND maqal_id = 9 AND type = 'PRODUCT'
            ORDER BY reference_date ASC
        `, [SACDIYO_ID]);
        
        console.log('Raw reference_date strings from DB:');
        prodRows.forEach(r => console.log(`  "${r.ref_text}"`));
        
        console.log('\nThis is what the frontend parseSafeDate function does:');
        for (const r of prodRows) {
            const dStr = r.ref_text;
            // Simulate the parseSafeDate logic:
            // if (typeof dStr === 'string' && dStr.includes('-') && !dStr.includes('T'))
            //     return new Date(dStr.replace(/-/g, '/'))
            // else return new Date(dStr)
            let parsedDate;
            if (typeof dStr === 'string' && dStr.includes('-') && !dStr.includes('T')) {
                // YYYY-MM-DD format: replace - with / avoids UTC interpretation
                parsedDate = new Date(dStr.replace(/-/g, '/'));
            } else {
                // ISO format: interpreted as UTC
                parsedDate = new Date(dStr);
            }
            console.log(`  "${dStr}" -> parsed as: ${parsedDate.toISOString()} -> toLocaleDateString: ${parsedDate.toLocaleDateString()}`);
            
            // Format as 'dd MMM' (what format() does in date-fns)
            const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            const day = String(parsedDate.getDate()).padStart(2, '0');
            const mon = months[parsedDate.getMonth()];
            console.log(`  -> format(d, 'dd MMM') would give: "${day} ${mon}"`);
        }

    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(console.error);
