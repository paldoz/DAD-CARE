import { format } from 'date-fns';

export interface Transaction {
    id: string;
    type: 'PRODUCT' | 'PAYMENT' | 'ADJUSTMENT';
    reference_date: string;
    kg?: number;
    price_per_kg?: number;
    amount: number;
    previous_debt: number;
    new_debt: number;
    created_at: string | Date;
    note?: string;
    receipt_id: string | null;
    maqal_id: number | null;
    edit_count: number;
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
}

export const groupTransactionsInfoReceipts = (txns: Transaction[]): (ReceiptGroup & { _sortDate: Date })[] => {
    if (!txns || txns.length === 0) return [];

    // 1. Sort EVERYTHING deterministically by time and ID descending (Newest First)
    const sortedTxns = [...txns].sort((a, b) => {
        const timeA = new Date(a.created_at).getTime();
        const timeB = new Date(b.created_at).getTime();
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
                const diff = Math.abs(new Date(txn.created_at).getTime() - new Date(prev.created_at).getTime());
                
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
            const chronoGroup = [...group].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
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
            const ta = new Date(a.created_at).getTime();
            const tb = new Date(b.created_at).getTime();
            if (ta !== tb) return tb - ta;
            return a.id.localeCompare(b.id);
        });
        const last = sorted[0];
        const first = sorted[sorted.length - 1];

        const totalKilos = sorted.reduce((sum, t) => sum + (t.kg || 0), 0);
        const totalMaqalka = sorted.filter(t => t.type === 'PRODUCT').reduce((sum, t) => sum + (t.amount || 0), 0);
        const totalPaid = sorted.filter(t => t.type === 'PAYMENT').reduce((sum, t) => sum + (t.amount || 0), 0);
        const totalAdjustment = sorted.filter(t => t.type === 'ADJUSTMENT').reduce((sum, t) => sum + (t.amount || 0), 0);
        const isAdjustmentOnly = sorted.length === sorted.filter(t => t.type === 'ADJUSTMENT').length;

        const productDates = sorted.filter(t => t.type === 'PRODUCT' && t.reference_date).map(t => new Date(t.reference_date));
        let titleString = format(new Date(last.created_at), 'EEEE, MMMM dd, yyyy');

        let sortDate: Date;
        if (productDates.length > 0) {
            productDates.sort((a, b) => a.getTime() - b.getTime());
            sortDate = productDates[0]; // earliest product date = maqal anchor date
            const uniqueDates = Array.from(new Set(productDates.map(d => format(d, 'dd MMM'))));
            if (uniqueDates.length === 1) titleString = `Maqalka Taariikhda ${uniqueDates[0]}`;
            else if (uniqueDates.length === 2) titleString = `Maqalka Taariikhda ${uniqueDates[0]} iyo ${uniqueDates[1]}`;
            else titleString = `Maqalka Taariikhda ${uniqueDates[0]} ila ${uniqueDates[uniqueDates.length - 1]}`;
        } else {
            sortDate = new Date(first.created_at);
        }

        const productReceiptId = sorted.find(t => t.type === 'PRODUCT' && t.receipt_id)?.receipt_id || null;

        return {
            id: `group-${idx}-${last.id}`,
            mainDate: last.reference_date ? String(last.reference_date) : '',
            kind: isAdjustmentOnly ? 'ADJUSTMENT' : 'TRANSACTION',
            titleString: titleString,
            receiptId: productReceiptId,
            entries: [...sorted].reverse(), // Store internally as oldest-first for the breakdown rendering
            totalKilos,
            totalMaqalka,
            totalPaid,
            totalAdjustment,
            openingBalance: first.previous_debt,
            closingBalance: last.new_debt,
            note: sorted.find(t => t.note)?.note,
            maqalId: sorted.find(t => t.maqal_id != null)?.maqal_id || null,
            _sortDate: sortDate, // internal: stable anchor for ordering
        } as ReceiptGroup & { _sortDate: Date; receiptId: string | null };
    });

    // 6. MERGE STEP: fold payment-only receipts into the correct product receipt.
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
                    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
                );
                const latestEntry = mergedEntries[mergedEntries.length - 1];
                merged[targetIdx] = {
                    ...target,
                    entries: mergedEntries,
                    totalPaid: target.totalPaid + current.totalPaid,
                    closingBalance: latestEntry.new_debt,
                };
                continue; // payment absorbed — don't add it separately
            }
        }
        merged.push(current as ReceiptGroup & { _sortDate: Date });
    }

    // 6.5 Dynamically recalculate running balances chronologically.
    if (merged.length > 0) {
        let runningDebt = merged[0].openingBalance;
        for (const m of merged) {
            m.openingBalance = runningDebt;
            m.closingBalance = runningDebt + m.totalMaqalka + m.totalAdjustment - m.totalPaid;
            runningDebt = m.closingBalance;
        }
    }

    // 7. Calculate sequential display IDs
    let displayCounter = 1;
    const maqalIdMap = new Map<number, number>();
    for (const m of merged) {
        if (m.totalMaqalka > 0 || m.maqalId != null) {
            m.displayMaqalId = displayCounter++;
            if (m.maqalId != null) {
                maqalIdMap.set(m.maqalId, m.displayMaqalId);
            }
        }
    }

    for (const m of merged) {
        for (const e of m.entries) {
            if (e.maqal_id != null && maqalIdMap.has(e.maqal_id)) {
                e.displayMaqalId = maqalIdMap.get(e.maqal_id);
            }
        }
        if (m.maqalId == null && m.totalMaqalka === 0 && m.totalAdjustment === 0 && m.entries.length > 0) {
            const firstEntry = m.entries[0];
            if (firstEntry.maqal_id != null && maqalIdMap.has(firstEntry.maqal_id)) {
                m.displayMaqalId = maqalIdMap.get(firstEntry.maqal_id);
            }
        }
    }

    // 8. Return sorted newest-first for the UI
    return merged.sort((a, b) => b._sortDate.getTime() - a._sortDate.getTime());
};
