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
        return a.id.localeCompare(b.id);
    });

    // 2. Authoritative grouping key:
    // Every transaction belongs strictly to its receipt_id, or maqal_id if no receipt_id, or an isolated unassigned group.
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
    }) as (Transaction & { _groupKey: string })[];

    const groupedByKey = normalizedTxns.reduce((acc, t) => {
        const key = t._groupKey;
        if (!acc[key]) acc[key] = [];
        acc[key].push(t);
        return acc;
    }, {} as Record<string, Transaction[]>);

    const receiptGroups: Transaction[][] = Object.values(groupedByKey);

    // 3. Process groups and compute a stable sortDate from product reference dates
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

        const parseSafeDate = (dStr: any): Date => {
            if (!dStr) return new Date(0);
            if (typeof dStr === 'string' && dStr.includes('-') && !dStr.includes('T')) {
                return new Date(dStr.replace(/-/g, '/'));
            }
            return new Date(dStr);
        };

        const productDates = sorted.filter(t => t.type === 'PRODUCT').map(t => parseSafeDate(t.reference_date));
        let titleString = format(parseSafeDate(last.created_at || last.reference_date), 'EEEE, MMMM dd, yyyy');

        let sortDate: Date;
        if (productDates.length > 0) {
            productDates.sort((a, b) => a.getTime() - b.getTime());
            sortDate = productDates[0]; 
            const uniqueDates = Array.from(new Set(productDates.map(d => format(d, 'dd MMM'))));
            if (uniqueDates.length === 1) titleString = `Maqalka Taariikhda ${uniqueDates[0]}`;
            else if (uniqueDates.length === 2) titleString = `Maqalka Taariikhda ${uniqueDates[0]} iyo ${uniqueDates[1]}`;
            else titleString = `Maqalka Taariikhda ${uniqueDates[0]} ila ${uniqueDates[uniqueDates.length - 1]}`;
        } else {
            sortDate = parseSafeDate(first.created_at || first.reference_date);
        }

        const productReceiptId = sorted.find(t => t.type === 'PRODUCT' && t.receipt_id)?.receipt_id || sorted.find(t => t.receipt_id)?.receipt_id || null;
        const maqalId = sorted.find(t => t.maqal_id != null)?.maqal_id || null;

        // Authoritative display MQ#: maqal_id >= 9 maps to MQ#(maqal_id - 8), e.g. 9->MQ#1, 21->MQ#13, 28->MQ#20, 29->MQ#21
        let displayMaqalId: number | null = null;
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
            note: sorted.find(t => t.note)?.note,
            maqalId,
            displayMaqalId,
            percentage,
            _sortDate: sortDate,
        } as ReceiptGroup & { _sortDate: Date; receiptId: string | null };
    });

    // Sort chronologically newest-first
    const sortedReceipts = [...processedReceipts].sort((a, b) => b._sortDate.getTime() - a._sortDate.getTime());

    // Calculate sequential displayMaqalId fallback if maqalId was null
    let fallbackCounter = 1;
    for (let i = sortedReceipts.length - 1; i >= 0; i--) {
        const m = sortedReceipts[i];
        if (m.totalMaqalka > 0 && m.displayMaqalId == null) {
            m.displayMaqalId = fallbackCounter;
        }
        if (m.totalMaqalka > 0) {
            fallbackCounter++;
        }
    }

    // Propagate displayMaqalId to child entries
    for (const m of sortedReceipts) {
        for (const e of m.entries) {
            if (e.type === 'PAYMENT') {
                if (e.maqal_id != null) {
                    e.displayMaqalId = e.maqal_id >= 9 ? e.maqal_id - 8 : e.maqal_id;
                } else if (m.displayMaqalId != null) {
                    e.displayMaqalId = m.displayMaqalId;
                }
            }
        }
    }

    return sortedReceipts;
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
