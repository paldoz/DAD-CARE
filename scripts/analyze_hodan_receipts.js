const { Pool } = require('pg');
const pool = new Pool({ 
    connectionString: 'postgresql://postgres.omjmjihinxbtilnirsco:ki6pw8TKnb4bqrjC@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
    ssl: { rejectUnauthorized: false } 
});

async function run() {
    const customerId = '96ee6785-ff35-4a40-9a06-a33186550004';
    
    // Find all distinct receipts
    const { rows: receipts } = await pool.query(`
        SELECT receipt_id, maqal_id, MIN(created_at) as created_at, COUNT(*) as txn_count,
               SUM(CASE WHEN type = 'PRODUCT' THEN amount ELSE 0 END) as total_products,
               SUM(CASE WHEN type = 'PAYMENT' THEN amount ELSE 0 END) as total_payments,
               SUM(CASE WHEN type = 'ADJUSTMENT' THEN amount ELSE 0 END) as total_adjustments
        FROM "Ledger"
        WHERE customer_id = $1 AND deleted_at IS NULL
        GROUP BY receipt_id, maqal_id
        ORDER BY MIN(created_at) ASC
    `, [customerId]);

    console.log('=== DISTINCT RECEIPT BLOCKS FOR HODAN ===');
    console.table(receipts.map((r, idx) => ({
        idx,
        receipt_id: r.receipt_id ? r.receipt_id.substring(0,8) + '...' : 'null',
        maqal_id: r.maqal_id,
        created_at: new Date(r.created_at).toISOString(),
        txns: r.txn_count,
        products: Number(r.total_products),
        payments: Number(r.total_payments),
        adjustments: Number(r.total_adjustments)
    })));

    // Let's also check if any transaction has amount = 240
    console.log('\n=== ALL TRANSACTIONS WITH AMOUNT 240 OR NEAR 240 FOR HODAN ===');
    const { rows: tx240 } = await pool.query(`
        SELECT id, type, amount, reference_date, created_at, maqal_id, receipt_id, previous_debt, new_debt, note
        FROM "Ledger"
        WHERE customer_id = $1 AND deleted_at IS NULL AND amount IN (240, 210, 1068, 1098, 1308, 1175, 1055)
        ORDER BY created_at ASC
    `, [customerId]);
    console.table(tx240.map(t => ({
        id: t.id.substring(0,8) + '...',
        type: t.type,
        amount: Number(t.amount),
        ref_date: t.reference_date ? String(t.reference_date).split('T')[0] : 'null',
        created_at: new Date(t.created_at).toISOString(),
        maqal_id: t.maqal_id,
        prev_debt: Number(t.previous_debt),
        new_debt: Number(t.new_debt),
        note: t.note
    })));

    await pool.end();
}

run().catch(console.error);
