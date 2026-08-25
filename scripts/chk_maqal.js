const fs = require('fs');
const envContent = fs.readFileSync('.env.local', 'utf8');
for (const line of envContent.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.query(
    "SELECT type, TO_CHAR(reference_date, 'YYYY-MM-DD') as rd, kg, amount, maqal_id, receipt_id FROM \"Ledger\" WHERE customer_id = '96ee6785-ff35-4a40-9a06-a33186550004' AND deleted_at IS NULL AND reference_date >= '2026-07-13' AND reference_date <= '2026-07-17' ORDER BY created_at ASC"
).then(r => {
    console.log('=== Hodan Jul 13-17 rows ===');
    r.rows.forEach(x => console.log(JSON.stringify(x)));
    pool.end();
}).catch(e => { console.error(e.message); pool.end(); });
