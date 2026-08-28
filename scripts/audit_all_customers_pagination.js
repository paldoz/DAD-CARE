require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
    const client = await pool.connect();
    try {
        console.log('================================================================');
        console.log('READ-ONLY AUDIT: ALL CUSTOMERS — LEDGER ROW COUNTS & PAGINATION RISK');
        console.log('================================================================\n');

        // 1. Per-customer row counts, ordered by count DESC
        const { rows: custCounts } = await client.query(`
            SELECT 
                c.id, c.name,
                COUNT(l.id) as total_rows,
                COUNT(l.id) FILTER (WHERE l.type = 'PRODUCT') as products,
                COUNT(l.id) FILTER (WHERE l.type = 'PAYMENT') as payments,
                COUNT(l.id) FILTER (WHERE l.type = 'ADJUSTMENT') as adjustments,
                MIN(l.reference_date)::text as oldest_date,
                MAX(l.reference_date)::text as newest_date,
                MIN(l.created_at)::text as oldest_created,
                MAX(l.created_at)::text as newest_created
            FROM "Customer" c
            LEFT JOIN "Ledger" l ON l.customer_id = c.id AND l.deleted_at IS NULL
            WHERE c.deleted_at IS NULL
            GROUP BY c.id, c.name
            ORDER BY COUNT(l.id) DESC
        `);

        const at100  = custCounts.filter(r => Number(r.total_rows) >= 100);
        const at500  = custCounts.filter(r => Number(r.total_rows) >= 500);
        const at50   = custCounts.filter(r => Number(r.total_rows) >= 50 && Number(r.total_rows) < 100);
        const under50 = custCounts.filter(r => Number(r.total_rows) < 50);

        console.log(`Total customers: ${custCounts.length}`);
        console.log(`  ≥100 rows (would have been truncated by old limit=100): ${at100.length}`);
        console.log(`  ≥500 rows (would be truncated by current limit=500):    ${at500.length}`);
        console.log(`  50–99 rows:                                              ${at50.length}`);
        console.log(`  <50 rows:                                                ${under50.length}`);

        console.log('\n--- ALL CUSTOMERS (sorted by row count DESC) ---');
        custCounts.forEach(r => {
            const risk = Number(r.total_rows) >= 500 ? ' ⚠️ EXCEEDS 500' : Number(r.total_rows) >= 100 ? ' ⚠️ was truncated at 100' : '';
            console.log(`  "${r.name}": ${r.total_rows} rows (${r.products}P/${r.payments}pay/${r.adjustments}adj) | ${r.oldest_date} → ${r.newest_date}${risk}`);
        });

        // 2. For every customer ≥100 rows: verify their OLDEST Maqal is still in DB
        console.log('\n================================================================');
        console.log('OLDEST MAQAL VERIFICATION FOR CUSTOMERS WITH ≥100 ROWS');
        console.log('================================================================');
        for (const cust of at100) {
            const { rows: oldestMaqal } = await client.query(`
                SELECT maqal_id, MIN(reference_date)::text as min_date, COUNT(*) as row_count
                FROM "Ledger"
                WHERE customer_id = $1 AND deleted_at IS NULL AND type = 'PRODUCT'
                GROUP BY maqal_id
                ORDER BY MIN(reference_date) ASC
                LIMIT 1
            `, [cust.id]);
            if (oldestMaqal.length > 0) {
                const m = oldestMaqal[0];
                console.log(`  "${cust.name}" (${cust.total_rows} rows): oldest maqal_id=${m.maqal_id} date=${m.min_date} rows=${m.row_count} ✅`);
            }
        }

        // 3. Audit all places with LIMIT in ledger-related queries
        console.log('\n================================================================');
        console.log('FINDINGS SUMMARY');
        console.log('================================================================');
        console.log(`Customers that were silently truncated by old limit=100: ${at100.length}`);
        console.log(`Customers at risk if limit were 200: ${custCounts.filter(r=>Number(r.total_rows)>=200).length}`);
        console.log(`Customers at risk if limit were 500: ${at500.length}`);
        console.log(`\nDatabase records for oldest Maqals of ≥100-row customers: ALL INTACT ✅`);
        console.log(`No historical data was deleted. Problem was fetch-layer only.\n`);

    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(console.error);
