require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function r() {
    const c = await pool.connect();
    try {
        const cust = await c.query('SELECT COUNT(*) as t, COUNT(*) FILTER(WHERE deleted_at IS NULL) as a, COUNT(*) FILTER(WHERE deleted_at IS NOT NULL) as d FROM "Customer"');
        const db = await c.query('SELECT COUNT(*) as t, COUNT(*) FILTER(WHERE deleted_at IS NULL) as a, COUNT(*) FILTER(WHERE deleted_at IS NOT NULL) as d FROM "DailyBook"');
        const dbi = await c.query('SELECT COUNT(*) as t, COUNT(*) FILTER(WHERE deleted_at IS NULL) as a, COUNT(*) FILTER(WHERE deleted_at IS NOT NULL) as d FROM "DailyBookItem"');
        const l = await c.query('SELECT type, COUNT(*) as t, COUNT(*) FILTER(WHERE deleted_at IS NULL) as a, COUNT(*) FILTER(WHERE deleted_at IS NOT NULL) as d FROM "Ledger" GROUP BY type');
        const r = await c.query('SELECT COUNT(DISTINCT receipt_id) as total_r, COUNT(DISTINCT receipt_id) FILTER (WHERE type = \'PRODUCT\' AND deleted_at IS NULL) as active_prod_r FROM "Ledger" WHERE receipt_id IS NOT NULL');
        const mq = await c.query('SELECT COUNT(DISTINCT maqal_id) as d_mq, MIN(maqal_id) as min_mq, MAX(maqal_id) as max_mq FROM "Ledger" WHERE maqal_id IS NOT NULL AND deleted_at IS NULL');
        const null_mq_p = await c.query('SELECT COUNT(*) as cnt, COUNT(*) FILTER(WHERE receipt_id IS NOT NULL) as has_r, COUNT(*) FILTER(WHERE receipt_id IS NULL) as no_r FROM "Ledger" WHERE type=\'PAYMENT\' AND deleted_at IS NULL AND maqal_id IS NULL');
        const secApprove = await c.query('SELECT COUNT(*) as cnt FROM "Ledger" WHERE type=\'PAYMENT\' AND deleted_at IS NULL AND previous_debt = 0 AND new_debt = 0');
        const totalPayments = await c.query('SELECT COUNT(*) as total_payments, COUNT(*) FILTER(WHERE deleted_at IS NULL) as active_payments FROM "Ledger" WHERE type=\'PAYMENT\'');
        
        console.log(JSON.stringify({ 
            cust: cust.rows[0], 
            db: db.rows[0], 
            dbi: dbi.rows[0], 
            l: l.rows, 
            r: r.rows[0], 
            mq: mq.rows[0], 
            null_mq_p: null_mq_p.rows[0],
            totalPayments: totalPayments.rows[0],
            secApprove: secApprove.rows[0]
        }, null, 2));
    } finally {
        c.release();
        await pool.end();
    }
}
r().catch(console.error);
