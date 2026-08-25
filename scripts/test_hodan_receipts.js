const { Pool } = require('pg');
const pool = new Pool({ 
    connectionString: 'postgresql://postgres.omjmjihinxbtilnirsco:ki6pw8TKnb4bqrjC@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
    ssl: { rejectUnauthorized: false } 
});

// Import groupTransactionsInfoReceipts logic
const { format } = require('date-fns');

function groupTransactionsInfoReceipts(txns) {
    if (!txns || txns.length === 0) return [];

    const sortedTxns = [...txns].sort((a, b) => {
        const timeA = new Date(a.created_at || a.reference_date || 0).getTime();
        const timeB = new Date(b.created_at || b.reference_date || 0).getTime();
        if (timeA !== timeB) return timeB - timeA;
        return a.id.localeCompare(b.id);
    });

    const normalizedTxns = sortedTxns.map(t => {
        let key = null;
        if (t.maqal_id != null) {
            key = `__MAQAL__${t.maqal_id}`;
        } else if (t.receipt_id) {
            key = t.receipt_id;
        } else if (t.type === 'PAYMENT') {
            key = `__PAY__${t.id}`;
        }
        return { ...t, _groupKey: key };
    });

    const withGroupKey = normalizedTxns.filter(t => t._groupKey);
    const withoutGroupKey = normalizedTxns.filter(t => !t._groupKey);

    const receiptGroups = [];

    const groupedByKey = withGroupKey.reduce((acc, t) => {
        const key = t._groupKey;
        if (!acc[key]) acc[key] = [];
        acc[key].push(t);
        return acc;
    }, {});

    Object.values(groupedByKey).forEach(group => receiptGroups.push(group));

    if (withoutGroupKey.length > 0) {
        let currentGroup = [];
        let currentDates = new Set();

        withoutGroupKey.forEach((txn, i) => {
            const isProduct = txn.type === 'PRODUCT' && txn.reference_date;
            const dateStr = isProduct ? String(txn.reference_date).split('T')[0] : null;

            if (i === 0) {
                currentGroup.push(txn);
                if (dateStr) currentDates.add(dateStr);
            } else {
                const prev = withoutGroupKey[i - 1];
                const diff = Math.abs(new Date(txn.created_at || txn.reference_date || 0).getTime() - new Date(prev.created_at || prev.reference_date || 0).getTime());
                
                let wouldExceed2Days = false;
                if (dateStr && !currentDates.has(dateStr) && currentDates.size >= 2) {
                    wouldExceed2Days = true;
                }

                if (diff < 15000 && !wouldExceed2Days) {
                    currentGroup.push(txn);
                    if (dateStr) currentDates.add(dateStr);
                } else {
                    receiptGroups.push(currentGroup);
                    currentGroup = [txn];
                    currentDates = new Set();
                    if (dateStr) currentDates.add(dateStr);
                }
            }
        });
        if (currentGroup.length > 0) receiptGroups.push(currentGroup);
    }

    const finalReceiptGroups = [];

    for (const group of receiptGroups) {
        const productDates = Array.from(new Set(group.filter(t => t.type === 'PRODUCT').map(t => t.reference_date ? String(t.reference_date).split('T')[0] : null).filter(Boolean)));
        
        if (productDates.length > 2) {
            const chronoGroup = [...group].sort((a, b) => new Date(a.created_at || a.reference_date || 0).getTime() - new Date(b.created_at || b.reference_date || 0).getTime());
            let currentChunkDates = new Set();
            let currentChunk = [];

            for (const txn of chronoGroup) {
                const isProduct = txn.type === 'PRODUCT' && txn.reference_date;
                const dStr = isProduct ? String(txn.reference_date).split('T')[0] : null;
                
                if (dStr && !currentChunkDates.has(dStr) && currentChunkDates.size >= 2) {
                    finalReceiptGroups.push(currentChunk);
                    currentChunk = [];
                    currentChunkDates = new Set();
                }

                currentChunk.push(txn);
                if (dStr) currentChunkDates.add(dStr);
            }
            if (currentChunk.length > 0) finalReceiptGroups.push(currentChunk);
        } else {
            finalReceiptGroups.push(group);
        }
    }

    const processedReceipts = finalReceiptGroups.map((group, idx) => {
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

        const productDates = sorted.filter(t => t.type === 'PRODUCT').map(t => new Date(t.reference_date || 0));
        let titleString = format(new Date(last.created_at || last.reference_date || new Date()), 'EEEE, MMMM dd, yyyy');

        let sortDate;
        if (productDates.length > 0) {
            productDates.sort((a, b) => a.getTime() - b.getTime());
            sortDate = productDates[0]; 
            const uniqueDates = Array.from(new Set(productDates.map(d => format(d, 'dd MMM'))));
            if (uniqueDates.length === 1) titleString = `Maqalka Taariikhda ${uniqueDates[0]}`;
            else if (uniqueDates.length === 2) titleString = `Maqalka Taariikhda ${uniqueDates[0]} iyo ${uniqueDates[1]}`;
            else titleString = `Maqalka Taariikhda ${uniqueDates[0]} ila ${uniqueDates[uniqueDates.length - 1]}`;
        } else {
            sortDate = new Date(first.created_at || first.reference_date || 0);
        }

        const productReceiptId = sorted.find(t => t.type === 'PRODUCT' && t.receipt_id)?.receipt_id || null;

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
            note: sorted.find(t => t.note)?.note,
            maqalId: sorted.find(t => t.maqal_id != null)?.maqal_id || null,
            _sortDate: sortDate,
        };
    });

    const oldestFirst = [...processedReceipts].sort((a, b) =>
        a._sortDate.getTime() - b._sortDate.getTime()
    );

    const merged = [];
    for (const current of oldestFirst) {
        const isPaymentOnly = current.totalMaqalka === 0 && current.totalAdjustment === 0 && current.totalPaid > 0 && current.maqalId == null;

        if (isPaymentOnly && merged.length > 0) {
            let targetIdx = -1;
            for (let k = 0; k < merged.length; k++) {
                const m = merged[k];
                const owed = m.totalMaqalka + m.totalAdjustment;
                if ((m.totalMaqalka > 0 || m.totalAdjustment > 0) && m.totalPaid < owed) {
                    targetIdx = k;
                    break;
                }
            }

            if (targetIdx === -1) {
                for (let k = merged.length - 1; k >= 0; k--) {
                    if (merged[k].totalMaqalka > 0 || merged[k].totalAdjustment > 0) {
                        targetIdx = k;
                        break;
                    }
                }
            }

            if (targetIdx !== -1) {
                const target = merged[targetIdx];
                const mergedEntries = [...target.entries, ...current.entries].sort(
                    (a, b) => new Date(a.created_at || a.reference_date || 0).getTime() - new Date(b.created_at || b.reference_date || 0).getTime()
                );
                const latestEntry = mergedEntries[mergedEntries.length - 1];
                merged[targetIdx] = {
                    ...target,
                    entries: mergedEntries,
                    totalPaid: target.totalPaid + current.totalPaid,
                    closingBalance: Number(latestEntry.new_debt || 0),
                };
                continue;
            }
        }
        merged.push(current);
    }

    if (merged.length > 0) {
        let runningDebt = merged[0].openingBalance;
        for (const m of merged) {
            m.openingBalance = runningDebt;
            m.closingBalance = runningDebt + m.totalMaqalka + m.totalAdjustment - m.totalPaid;
            runningDebt = m.closingBalance;
        }
    }

    let displayCounter = 1;
    const maqalIdMap = new Map();
    for (const m of merged) {
        if (m.maqalId != null) {
            m.displayMaqalId = m.maqalId;
            maqalIdMap.set(m.maqalId, m.maqalId);
        } else if (m.totalMaqalka > 0) {
            m.displayMaqalId = displayCounter++;
        }
    }

    for (const m of merged) {
        for (const e of m.entries) {
            if (e.type === 'PAYMENT') {
                if (e.maqal_id != null) {
                    e.displayMaqalId = maqalIdMap.get(e.maqal_id) ?? e.maqal_id;
                } else if (m.displayMaqalId != null) {
                    e.displayMaqalId = m.displayMaqalId;
                }
            }
        }
    }

    return merged.sort((a, b) => b._sortDate.getTime() - a._sortDate.getTime());
}

async function run() {
    const customerId = '96ee6785-ff35-4a40-9a06-a33186550004';
    const { rows: txns } = await pool.query(`
        SELECT id, type, amount, kg, price_per_kg, reference_date, created_at, deleted_at,
               maqal_id, receipt_id, previous_debt, new_debt, note
        FROM "Ledger"
        WHERE customer_id = $1 AND deleted_at IS NULL
        ORDER BY created_at ASC, id ASC
    `, [customerId]);

    console.log(`Loaded ${txns.length} active transactions for Hodan.`);
    const receipts = groupTransactionsInfoReceipts(txns);

    console.log('\n=== RECEIPT GROUPS (NEWEST FIRST) ===');
    receipts.forEach((r, idx) => {
        console.log(`\n[${idx}] Display MQ: MQ#${r.displayMaqalId} (DB maqalId: ${r.maqalId}) | Title: ${r.titleString}`);
        console.log(`    Opening Debt: $${r.openingBalance} | Maqalka: $${r.totalMaqalka} | Paid: $${r.totalPaid} | Closing Debt: $${r.closingBalance}`);
        console.log(`    Entries (${r.entries.length}):`);
        r.entries.forEach(e => {
            console.log(`      - [${e.type}] Amount: $${e.amount} | Date: ${e.reference_date ? String(e.reference_date).split('T')[0] : 'null'} | Note: ${e.note || ''} | maqal_id: ${e.maqal_id} | ID: ${e.id.substring(0,8)}...`);
        });
    });

    await pool.end();
}

run().catch(console.error);
