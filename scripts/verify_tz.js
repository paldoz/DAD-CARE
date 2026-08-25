const fs = require('fs');
const envContent = fs.readFileSync('.env.local', 'utf8');
for (const line of envContent.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

pool.query(`
    SELECT 
        id,
        TO_CHAR(reference_date, 'YYYY-MM-DD') as utc_date,
        TO_CHAR(reference_date AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD') as local_date,
        reference_date as raw
    FROM "Ledger"
    WHERE customer_id = '96ee6785-ff35-4a40-9a06-a33186550004'
      AND deleted_at IS NULL
      AND id IN (
        'e34ce51a-ccb1-44cc-8dc8-c438c1621d82',
        '8a4c60ff-542a-4b30-a897-12cd7760b4da'
      )
`).then(r => {
    console.log('=== July 14 & 15 reference_date verification ===');
    r.rows.forEach(x => console.log(JSON.stringify({
        id: x.id.substring(0,8),
        utc_date: x.utc_date,
        local_date: x.local_date,
        raw: x.raw
    })));
    pool.end();
}).catch(e => { console.error(e.message); pool.end(); });
