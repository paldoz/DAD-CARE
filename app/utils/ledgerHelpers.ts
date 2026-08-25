import { format } from 'date-fns';

/**
 * Authoritative Maqal Charge Calculation:
 * Keeps KG decimals (e.g. 4.5 KG), but drops/forgives the fractional dollar.
 * Formula: Math.floor(kg * price)
 * Examples:
 *   4.5 * 35 = 157.50 -> 157
 *   5.0 * 35 = 175.00 -> 175
 *   3.5 * 35 = 122.50 -> 122
 *   2.5 * 35 = 87.50  -> 87
 *   4.25 * 35 = 148.75 -> 148
 */
export function calculateMaqalCharge(kg: number | string, price: number | string): number {
    const k = typeof kg === 'number' ? kg : parseFloat(kg) || 0;
    const p = typeof price === 'number' ? price : parseFloat(price) || 0;
    return Math.floor(k * p);
}

export interface Transaction {
    id: string;
    type: 'PRODUCT' | 'PAYMENT' | 'ADJUSTMENT';
    reference_date: string;
    kg?: number;
    price_per_kg?: number;
    amount?: number;
    previous_debt?: number;
    new_debt?: number;
    created_at?: string | Date;
    note?: string;
    receipt_id?: string | null;
    maqal_id?: number | null;
    edit_count?: number;
    displayMaqalId?: number;
}

export interface ReceiptGroup {
    id: string;
    mainDate: string;
    kind: 'TRANSACTION' | 'ADJUSTMENT';
    entries: Transaction[];
    totalKilos: number;
    totalMaqalka: number;
    totalAdjustment: number;
    totalPaid: number;
    openingBalance: number;
    closingBalance: number;
    note?: string;
    titleString?: string;
    receiptId?: string | null;
    maqalId?: number | null;
    displayMaqalId?: number | null;
    percentage?: number;
    diff?: number;
}

export const groupTransactionsInfoReceipts = (txns: Transaction[]): (ReceiptGroup & { _sortDate: Date })[] => {
    if (!txns || txns.length === 0) return [];

    // 1. Sort EVERYTHING deterministically by time and ID descending (Newest First)
    const sortedTxns = [...txns].sort((a, b) => {
        const timeA = new Date(a.created_at || a.reference_date || 0).getTime();
        const timeB = new Date(b.created_at || b.reference_date || 0).getTime();
        if (timeA !== timeB) return timeB - timeA;
        return a.id.localeCompare(b.id); // Tie-breaker for batch entries
    });

    // 2. Group by `maqal_id` first. If present, it represents a strict pairing lock.
    // Fall back to `receipt_id` or isolated payment grouping.
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
    }) as (Transaction & { _groupKey: string | null })[];

    const withGroupKey = normalizedTxns.filter(t => t._groupKey);
    const withoutGroupKey = normalizedTxns.filter(t => !t._groupKey);

    const receiptGroups: Transaction[][] = [];

    // 3. Group by _groupKey
    const groupedByKey = withGroupKey.reduce((acc, t) => {
        const key = t._groupKey!;
        if (!acc[key]) acc[key] = [];
        acc[key].push(t);
        return acc;
    }, {} as Record<string, Transaction[]>);

    Object.values(groupedByKey).forEach(group => receiptGroups.push(group));

    // 4. For orphans (no receipt_id), use 15s batching
    if (withoutGroupKey.length > 0) {
        let currentGroup: Transaction[] = [];
        let currentDates = new Set<string>();

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
                    currentDates = new Set<string>();
                    if (dateStr) currentDates.add(dateStr);
                }
            }
        });
        if (currentGroup.length > 0) receiptGroups.push(currentGroup);
    }

    // 4.5 FORCE SPLIT corrupted groups that exceed 2 unique dates (historical bug fix)
    const finalReceiptGroups: Transaction[][] = [];

    for (const group of receiptGroups) {
        const productDates = Array.from(new Set(group.filter(t => t.type === 'PRODUCT').map(t => t.reference_date ? String(t.reference_date).split('T')[0] : null).filter(Boolean)));
        
        if (productDates.length > 2) {
            const chronoGroup = [...group].sort((a, b) => new Date(a.created_at || a.reference_date || 0).getTime() - new Date(b.created_at || b.reference_date || 0).getTime());
            let currentChunkDates = new Set<string>();
            let currentChunk: Transaction[] = [];

            for (const txn of chronoGroup) {
                const isProduct = txn.type === 'PRODUCT' && txn.reference_date;
                const dStr = isProduct ? String(txn.reference_date).split('T')[0] : null;
                
                if (dStr && !currentChunkDates.has(dStr) && currentChunkDates.size >= 2) {
                    finalReceiptGroups.push(currentChunk);
                    currentChunk = [];
                    currentChunkDates = new Set<string>();
                }

                currentChunk.push(txn);
                if (dStr) currentChunkDates.add(dStr);
            }
            if (currentChunk.length > 0) finalReceiptGroups.push(currentChunk);
        } else {
            finalReceiptGroups.push(group);
        }
    }

    // 5. Process groups and compute a stable sortDate from product reference dates
    const processedReceipts = finalReceiptGroups.map((group, idx) => {
        // Sort group newest-first for consistent processing
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

        let sortDate: Date;
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
        } as ReceiptGroup & { _sortDate: Date; receiptId: string | null };
    });

    const oldestFirst = [...processedReceipts].sort((a, b) =>
        (a as any)._sortDate.getTime() - (b as any)._sortDate.getTime()
    );

    const merged: (ReceiptGroup & { _sortDate: Date })[] = [];
    for (const current of oldestFirst as (ReceiptGroup & { _sortDate: Date })[]) {
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
        merged.push(current as ReceiptGroup & { _sortDate: Date });
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
    const maqalIdMap = new Map<number, number>();
    for (const m of merged) {
        if (m.maqalId != null) {
            m.displayMaqalId = m.maqalId;
            maqalIdMap.set(m.maqalId, m.maqalId);
        } else if (m.totalMaqalka > 0) {
            m.displayMaqalId = displayCounter++;
        }
        
        // STRICT RECEIPT ENGINE MATH: 
        // We calculate the percentage directly on the receipt to act as the Single Source of Truth
        const debt = m.totalMaqalka + m.totalAdjustment;
        const paid = Math.abs(m.totalPaid);
        m.percentage = debt === 0 ? 100 : Math.min(100, Math.round((paid / debt) * 100));
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
};

export const calculateCustomerReliability = (transactions: any[]): { score: number, debugMaqals: any[], perfect_maqals: number, last_completed_reesto: number } => {
    const groups = groupTransactionsInfoReceipts(transactions);
    // STRICT READ-ONLY CONSUMER: Use exactly the same filter as the Profile UI
    // The Profile displays Maqals if they have debt OR if they have payments (Late Payments)
    const validMaqals = groups.filter(g => g.totalMaqalka > 0 || g.totalAdjustment > 0 || g.totalPaid > 0);
    
    if (validMaqals.length <= 1) {
        return { score: 100, debugMaqals: [], perfect_maqals: 0, last_completed_reesto: 0 };
    }

    const completedMaqals = validMaqals.slice(1).slice(0, 5);
    
    let perfect_maqals = 0;
    let last_completed_reesto = 0;
    
    validMaqals.slice(1).forEach((m) => {
        const debt = m.totalMaqalka + m.totalAdjustment;
        if (debt > 0 && m.totalPaid >= debt) {
            perfect_maqals++;
        }
    });

    if (completedMaqals.length > 0) {
        const lastCompleted = completedMaqals[0];
        const debt = lastCompleted.totalMaqalka + lastCompleted.totalAdjustment;
        last_completed_reesto = lastCompleted.totalPaid - debt;
    }

    const weights = [0.35, 0.25, 0.20, 0.12, 0.08];
    let totalScore = 0;
    let totalWeight = 0;
    
    const debugMaqals = completedMaqals.map((m, index) => {
        // STRICT READ-ONLY CONSUMER:
        // The Reliability engine no longer does its own math. It consumes the exact percentage 
        // generated by the Receipt Engine Single Source of Truth.
        const pct = m.percentage ?? 0;
        
        const weight = weights[index] || 0;
        const contribution = pct * weight;
        
        totalScore += contribution;
        totalWeight += weight;
        
        // Tie-breaker metrics (based on actual UI math)
        // Reesto (Ka dhiman) = debt - paid
        // Heyn (Kaso hartay) = paid - debt
        const reesto = Math.max(0, (m.totalMaqalka + m.totalAdjustment) - Math.abs(m.totalPaid));
        const heyn = Math.max(0, Math.abs(m.totalPaid) - (m.totalMaqalka + m.totalAdjustment));
        
        return {
            id: m.id,
            title: m.titleString,
            debt: m.totalMaqalka + m.totalAdjustment,
            paid: m.totalPaid,
            percentage: pct,
            weight,
            contribution,
            reesto,
            heyn,
            closingBalance: m.closingBalance
        };
    });

    const finalScore = totalWeight > 0 ? Math.round(totalScore / totalWeight) : 100;

    return { 
        score: finalScore,
        debugMaqals,
        perfect_maqals,
        last_completed_reesto
    };
};
