const { Pool } = require('pg');
const pool = new Pool({ 
    connectionString: 'postgresql://postgres.omjmjihinxbtilnirsco:ki6pw8TKnb4bqrjC@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
    ssl: { rejectUnauthorized: false } 
});

async function run() {
    const customerId = '96ee6785-ff35-4a40-9a06-a33186550004';
    
    console.log('=== LATEST 25 TRANSACTIONS (INCLUDING DELETED) FOR HODAN ===');
    const { rows: txns } = await pool.query(`
        SELECT id, type, amount, kg, price_per_kg, reference_date, created_at, deleted_at,
               maqal_id, receipt_id, previous_debt, new_debt, note, edit_count
        FROM "Ledger"
        WHERE customer_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 25
    `, [customerId]);

    console.table(txns.map((t, idx) => ({
        idx,
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        kg: t.kg != null ? Number(t.kg) : '-',
        price: t.price_per_kg != null ? Number(t.price_per_kg) : '-',
        ref_date: t.reference_date ? String(t.reference_date).split('T')[0] : 'null',
        created_at: t.created_at ? new Date(t.created_at).toISOString() : null,
        maqal_id: t.maqal_id,
        receipt_id: t.receipt_id ? t.receipt_id.substring(0, 8) + '...' : null,
        prev_debt: Number(t.previous_debt),
        new_debt: Number(t.new_debt),
        deleted: t.deleted_at ? 'DELETED' : 'ACTIVE',
        note: t.note
    })));

    console.log('\n=== RECENT AUDIT LOGS FOR HODAN ===');
    const { rows: audits } = await pool.query(`
        SELECT id, action, details, created_at
        FROM "AuditLog"
        WHERE details LIKE '%' || $1 || '%' OR details LIKE '%Hodan%'
        ORDER BY created_at DESC
        LIMIT 20
    `, [customerId]);
    console.table(audits.map(a => ({
        action: a.action,
        details: a.details,
        created_at: new Date(a.created_at).toISOString()
    })));

    await pool.end();
}

run().catch(console.error);
