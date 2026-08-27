require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function groupTransactionsInfoReceiptsOld(txns) {
    if (!txns || txns.length === 0) return [];

    const sortedTxns = [...txns].sort((a, b) => {
        const timeA = new Date(a.created_at || a.reference_date || 0).getTime();
        const timeB = new Date(b.created_at || b.reference_date || 0).getTime();
        if (timeA !== timeB) return timeB - timeA;
        return a.id.localeCompare(b.id);
    });

    const normalizedTxns = sortedTxns.map(t => {
        let key = null;
        if (t.receipt_id) {
            key = t.receipt_id;
        } else if (t.maqal_id != null) {
            key = `__MAQAL__${t.maqal_id}`;
        } else if (t.type === 'PAYMENT') {
            key = `__PAY__${t.id}`;
        } else {
            key = `__TX__${t.id}`;
        }
        return { ...t, _groupKey: key };
    });

    const groupedByKey = normalizedTxns.reduce((acc, t) => {
        const key = t._groupKey;
        if (!acc[key]) acc[key] = [];
        acc[key].push(t);
        return acc;
    }, {});

    const receiptGroups = Object.values(groupedByKey);

    const processedReceipts = receiptGroups.map((group, idx) => {
        const sorted = [...group].sort((a, b) => {
            const ta = new Date(a.created_at || a.reference_date || 0).getTime();
            const tb = new Date(b.created_at || b.reference_date || 0).getTime();
            if (ta !== tb) return tb - ta;
            return a.id.localeCompare(b.id);
        });
        const last = sorted[0];
        const first = sorted[sorted.length - 1];

        const totalKilos = sorted.reduce((sum, t) => sum + Number(t.kg || 0), 0);
        const totalMaqalka = sorted.filter(t => t.type === 'PRODUCT').reduce((sum, t) => sum + Number(t.amount || 0), 0);
        const totalPaid = sorted.filter(t => t.type === 'PAYMENT').reduce((sum, t) => sum + Math.abs(Number(t.amount || 0)), 0);
        const totalAdjustment = sorted.filter(t => t.type === 'ADJUSTMENT').reduce((sum, t) => sum + Number(t.amount || 0), 0);
        const isAdjustmentOnly = sorted.length === sorted.filter(t => t.type === 'ADJUSTMENT').length;

        const parseSafeDate = (dStr) => {
            if (!dStr) return new Date(0);
            if (typeof dStr === 'string' && dStr.includes('-') && !dStr.includes('T')) {
                return new Date(dStr.replace(/-/g, '/'));
            }
            return new Date(dStr);
        };

        const productDates = sorted.filter(t => t.type === 'PRODUCT').map(t => parseSafeDate(t.reference_date));
        let titleString = '';

        let sortDate;
        if (productDates.length > 0) {
            productDates.sort((a, b) => a.getTime() - b.getTime());
            sortDate = productDates[0]; 
            titleString = `Maqalka Taariikhda`;
        } else {
            sortDate = parseSafeDate(first.created_at || first.reference_date);
        }

        const productReceiptId = sorted.find(t => t.type === 'PRODUCT' && t.receipt_id)?.receipt_id || sorted.find(t => t.receipt_id)?.receipt_id || null;
        const maqalId = sorted.find(t => t.type === 'PRODUCT' && t.maqal_id != null)?.maqal_id
            ?? sorted.find(t => t.type === 'ADJUSTMENT' && t.maqal_id != null)?.maqal_id
            ?? sorted.find(t => t.maqal_id != null)?.maqal_id
            ?? null;

        let displayMaqalId = null;
        if (maqalId != null) {
            displayMaqalId = maqalId >= 9 ? maqalId - 8 : maqalId;
        }

        const debt = totalMaqalka + totalAdjustment;
        const percentage = debt === 0 ? 100 : Math.min(100, Math.round((totalPaid / debt) * 100));

        return {
            id: `group-${idx}-${last.id}`,
            mainDate: String(last.reference_date || ''),
            kind: isAdjustmentOnly ? 'ADJUSTMENT' : 'TRANSACTION',
            titleString: titleString,
            receiptId: productReceiptId,
            entries: [...sorted].reverse(),
            totalKilos,
            totalMaqalka,
            totalPaid,
            totalAdjustment,
            openingBalance: Number(first.previous_debt || 0),
            closingBalance: Number(last.new_debt || 0),
            maqalId,
            displayMaqalId,
            percentage,
            _sortDate: sortDate,
        };
    });

    const sortedReceipts = [...processedReceipts].sort((a, b) => b._sortDate.getTime() - a._sortDate.getTime());
    return sortedReceipts;
}

function groupTransactionsInfoReceiptsNew(txns) {
    const sortedReceipts = groupTransactionsInfoReceiptsOld(txns);
    
    // RECALCULATE RUNNING DEBT CHRONOLOGICALLY (Oldest to Newest)
    if (sortedReceipts.length > 0) {
        // Start with the earliest receipt's opening balance
        const earliest = sortedReceipts[sortedReceipts.length - 1];
        let runningDebt = Number(earliest.openingBalance || 0);
        
        for (let i = sortedReceipts.length - 1; i >= 0; i--) {
            const m = sortedReceipts[i];
            m.openingBalance = runningDebt;
            m.closingBalance = Number((runningDebt + m.totalMaqalka + m.totalAdjustment - m.totalPaid).toFixed(2));
            runningDebt = m.closingBalance;
        }
    }
    
    return sortedReceipts;
}

async function testScenario() {
    console.log('=== TESTING RUNNING DEBT RECALCULATION ===\n');

    // Simulate scenario:
    // Initial previous debt = $880
    // MQ#21 (Aug 23-24): $350 product. Paid $260 ($80 + $180).
    // MQ#22 (Aug 25-26): $360 product. Paid $100.
    // Late payment of $90 added to MQ#21.

    const mockTxns = [
        // MQ#21 Products
        { id: '1', type: 'PRODUCT', reference_date: '2026-08-23', amount: 175, receipt_id: 'r21', maqal_id: 29, created_at: '2026-08-23T10:00:00Z', previous_debt: 880, new_debt: 1055 },
        { id: '2', type: 'PRODUCT', reference_date: '2026-08-24', amount: 175, receipt_id: 'r21', maqal_id: 29, created_at: '2026-08-24T10:00:00Z', previous_debt: 1055, new_debt: 1230 },
        // MQ#21 Payments
        { id: '3', type: 'PAYMENT', reference_date: '2026-08-25', amount: 80, receipt_id: 'r21', maqal_id: 29, created_at: '2026-08-25T10:00:00Z', previous_debt: 1230, new_debt: 1150 },
        { id: '4', type: 'PAYMENT', reference_date: '2026-08-26', amount: 180, receipt_id: 'r21', maqal_id: 29, created_at: '2026-08-26T10:00:00Z', previous_debt: 1150, new_debt: 970 },
        
        // MQ#22 Products & Payment (Saved on Aug 26 when MQ#21 was only $260 paid)
        { id: '5', type: 'PRODUCT', reference_date: '2026-08-25', amount: 180, receipt_id: 'r22', maqal_id: 30, created_at: '2026-08-26T12:00:00Z', previous_debt: 970, new_debt: 1150 },
        { id: '6', type: 'PRODUCT', reference_date: '2026-08-26', amount: 180, receipt_id: 'r22', maqal_id: 30, created_at: '2026-08-26T12:01:00Z', previous_debt: 1150, new_debt: 1330 },
        { id: '7', type: 'PAYMENT', reference_date: '2026-08-26', amount: 100, receipt_id: 'r22', maqal_id: 30, created_at: '2026-08-26T12:02:00Z', previous_debt: 1330, new_debt: 1230 },

        // Late Payment of $90 on Aug 27 applied to MQ#21
        { id: '8', type: 'PAYMENT', reference_date: '2026-08-27', amount: 90, receipt_id: 'r21', maqal_id: 29, created_at: '2026-08-27T14:00:00Z', previous_debt: 1230, new_debt: 1140 },
    ];

    console.log('--- OLD UN-RECALCULATED OUTPUT ---');
    const oldRes = groupTransactionsInfoReceiptsOld(mockTxns);
    for (const r of oldRes) {
        console.log(`MQ#${r.displayMaqalId} (${r.receiptId}): Opening=$${r.openingBalance} | Maqalka=$${r.totalMaqalka} | Paid=$${r.totalPaid} | Closing=$${r.closingBalance}`);
    }

    console.log('\n--- NEW AUTHORITATIVELY RECALCULATED OUTPUT ---');
    const newRes = groupTransactionsInfoReceiptsNew(mockTxns);
    for (const r of newRes) {
        console.log(`MQ#${r.displayMaqalId} (${r.receiptId}): Opening=$${r.openingBalance} | Maqalka=$${r.totalMaqalka} | Paid=$${r.totalPaid} | Closing=$${r.closingBalance} | Maqal Reesto=$${r.totalMaqalka - r.totalPaid}`);
    }
}

testScenario().catch(console.error);
