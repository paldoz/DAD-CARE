import { calculateCustomerReliability } from './ledgerHelpers';

export async function getAllCustomerStats(pool: any) {
    const customersQuery = `SELECT id, created_at FROM "Customer" WHERE deleted_at IS NULL`;
    const ledgerQuery = `SELECT id, customer_id, type, reference_date, kg, price_per_kg, amount, previous_debt, new_debt, note, receipt_id, edit_count, created_at FROM "Ledger" WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC`;
    
    const [customersRes, ledgerRes] = await Promise.all([
        pool.query(customersQuery),
        pool.query(ledgerQuery)
    ]);
    
    const customers = customersRes.rows;
    const allLedger = ledgerRes.rows;
    
    const ledgerByCustomer = new Map<string, any[]>();
    for (const txn of allLedger) {
        if (!ledgerByCustomer.has(txn.customer_id)) {
            ledgerByCustomer.set(txn.customer_id, []);
        }
        
        // STRICT PROFILE SYNC:
        // The Profile UI only fetches the first 200 transactions on load.
        // This limits the backward FIFO loop. We MUST apply the exact same 
        // 200 item limit here so the engine is just as "blind" to old debts as the UI.
        if (ledgerByCustomer.get(txn.customer_id)!.length < 200) {
            ledgerByCustomer.get(txn.customer_id)!.push(txn);
        }
    }
    
    const customerStats = customers.map((c: any) => {
        const txns = ledgerByCustomer.get(c.id) || [];
        
        let total_paid = 0;
        let total_ledger_maqal = 0;
        let total_ledger_debt = 0;
        
        txns.forEach(t => {
            if (t.type === 'PAYMENT') total_paid += Math.abs(Number(t.amount || 0));
            if (t.type === 'PRODUCT' || t.type === 'ADJUSTMENT') total_ledger_debt += Number(t.amount || 0);
            if (t.type === 'PRODUCT') total_ledger_maqal += Number(t.amount || 0);
        });
        
        const current_debt = total_ledger_debt - total_paid;
        
        const { score, perfect_maqals, last_completed_reesto } = calculateCustomerReliability(txns);
        
        return {
            id: c.id,
            customer_created_at: c.created_at,
            pct: score,
            current_debt,
            total_paid,
            last_completed_reesto,
            perfect_maqals
        };
    });
    
    const sortedByMaqal = [...customerStats].sort((a, b) => {
        if (b.pct !== a.pct) return b.pct - a.pct;
        
        if (b.perfect_maqals !== a.perfect_maqals) return b.perfect_maqals - a.perfect_maqals;
        
        if (a.current_debt !== b.current_debt) return a.current_debt - b.current_debt;
        
        const aTime = new Date(a.customer_created_at).getTime();
        const bTime = new Date(b.customer_created_at).getTime();
        if (aTime !== bTime) return aTime - bTime;
        
        return a.id.localeCompare(b.id);
    });
    
    sortedByMaqal.forEach((c, i) => {
        (c as any).rank_maqal = i + 1;
    });
    
    const sortedByLacag = [...customerStats].sort((a, b) => {
        if (a.current_debt !== b.current_debt) return a.current_debt - b.current_debt;
        if (b.total_paid !== a.total_paid) return b.total_paid - a.total_paid;
        return a.id.localeCompare(b.id);
    });
    
    sortedByLacag.forEach((c, i) => {
        const target = customerStats.find((cs: any) => cs.id === c.id)!;
        (target as any).rank_lacag = i + 1;
    });
    
    return customerStats;
}
