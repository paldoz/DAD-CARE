'use client';

// ─── SINGLE SOURCE OF TRUTH for balance labels ───────────────────────────────
// Change these two strings here and EVERY label in the UI updates automatically.
const LABEL_REESTO       = 'Reesto';       // Shown when a payment exists → remaining balance
const LABEL_LACAGTA_GUUD = 'Lacagta Guud'; // Shown when no payment made → total amount owed
const LABEL_HEYN         = 'Heyn';         // Shown when customer overpays (negative debt)
/** Returns the correct balance label based purely on whether a payment was made */
const getBalanceLabel = (totalPaid: number, closingBalance: number): string => {
    if (closingBalance < 0) return LABEL_HEYN;
    return totalPaid > 0 ? LABEL_REESTO : LABEL_LACAGTA_GUUD;
};
// ─────────────────────────────────────────────────────────────────────────────

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import useSWR, { mutate } from 'swr';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { AnimatedBackground } from '@/components/animated-background';
import {
    ArrowLeft,
    Trash2,
    DollarSign,
    TrendingUp,
    Package,
    History,
    Loader2,
    Phone,
    Scale,
    Receipt,
    Calendar,
    ArrowUpRight,
    ArrowDownRight,
    Filter,
    CheckCircle2,
    AlertCircle,
    User,
    ChevronRight,
    ChevronDown,
    ChevronUp,
    Pencil,
    Save,
    Share2,
    Printer,
    FileText,
    AlertTriangle,
    RefreshCw
} from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogTrigger,
    DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { toast } from 'sonner';
import { format } from 'date-fns';
import { downloadReceiptPDF, shareReceiptToWhatsApp } from '@/lib/generate-receipt-pdf';
import { MessageCircle, FileDown, Lock, Plus } from 'lucide-react';
import { SecurityVerificationDialog } from '@/components/security-verification-dialog';
import { useSession } from '@/hooks/useSession';

interface Customer {
    id: string;
    name: string;
    customer_code: string;
    gender?: string;
    phone?: string;
    is_inactive?: boolean;
}

interface Transaction {
    id: string;
    type: 'PRODUCT' | 'PAYMENT' | 'ADJUSTMENT';
    reference_date: string;
    kg?: number;
    price_per_kg?: number;
    amount: number;
    previous_debt: number;
    new_debt: number;
    created_at: string;
    note?: string;
    receipt_id: string | null;
    maqal_id: number | null;
    edit_count: number;
    displayMaqalId?: number;
}

interface Summary {
    totalKg: number;
    totalPaid: number;
    currentBalance: number;
    lastTransactionType?: string | null;
}

interface ReceiptGroup {
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

const fetcher = async (url: string) => {
    // Cookie-only auth (credentials: include) — NO x-session-token header.
    // Custom headers prevent Vercel CDN caching; cookies allow it.
    const res = await fetch(url, { credentials: 'include' });
    if (res.status === 401) {
        if (typeof window !== 'undefined') {
            localStorage.removeItem('dadwork_session_token');
            window.location.href = '/';
        }
        const error: any = new Error('Unauthorized');
        error.status = 401;
        throw error;
    }
    if (!res.ok) throw new Error('Fetch error');
    return res.json();
};

export default function CustomerDetailPage() {
    const params = useParams();
    const router = useRouter();
    const customerId = params.id as string;

    const [customer, setCustomer] = useState<Customer | null>(null);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [receipts, setReceipts] = useState<ReceiptGroup[]>([]);
    const [summary, setSummary] = useState<Summary>({ totalKg: 0, totalPaid: 0, currentBalance: 0 });
    const [loading, setLoading] = useState(true);
    const [expandedReceipts, setExpandedReceipts] = useState<Set<string>>(new Set());

    const { session } = useSession();
    const isAtLeastAdmin = session?.role === 'SUPER_ADMIN' || session?.role === 'ADMIN';
    const isSuperAdmin = session?.role === 'SUPER_ADMIN';

    // Priority customer IDs for the current admin (used to restrict Undo visibility)
    const [priorityCustomerIds, setPriorityCustomerIds] = useState<string[]>([]);

    useEffect(() => {
        // Fetch this admin's assigned/priority customer IDs once on mount
        fetch('/api/customer-priority', { credentials: 'include' })
            .then(r => r.json())
            .then(data => {
                if (data?.priorityIds) setPriorityCustomerIds(data.priorityIds);
            })
            .catch(() => {});
    }, []);

    // canUndo:
    //   SUPER_ADMIN → always true (can undo any customer, any time)
    //   ADMIN       → only true if this customer is in their priority list
    const canUndo = isSuperAdmin || (isAtLeastAdmin && priorityCustomerIds.includes(customerId));

    // Latest maqal pair status for this customer
    const [maqalStatus, setMaqalStatus] = useState<{ date1: string; date2: string; has_payment: boolean } | null>(null);

    useEffect(() => {
        // Use credentials:include (cookie auth) — NOT x-session-token header,
        // so Vercel CDN can cache this response and reduce egress.
        fetch('/api/maqal-latest', { credentials: 'include' })
            .then(r => r.json())
            .then(data => {
                if (data?.customers && customerId) {
                    const match = data.customers.find((c: any) => c.id === customerId);
                    if (match) {
                        setMaqalStatus({ date1: data.date1, date2: data.date2, has_payment: match.has_payment });
                    }
                }
            })
            .catch(() => {});
    }, [customerId]);

    // Pagination & Filter State
    const [hasMore, setHasMore] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [searchTitle, setSearchTitle] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [filterActive, setFilterActive] = useState(false);

    // Edit State
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [editName, setEditName] = useState('');
    const [editPhone, setEditPhone] = useState('');
    const [editCode, setEditCode] = useState('');
    const [editGender, setEditGender] = useState('');
    const [updating, setUpdating] = useState(false);
    const [undoingTxId, setUndoingTxId] = useState<string | null>(null);
    const [deletingReceiptId, setDeletingReceiptId] = useState<string | null>(null);
    const [pendingSecurityAction, setPendingSecurityAction] = useState<'clear_history' | 'delete_customer' | 'delete_receipt' | 'restore_customer' | null>(null);
    const [receiptToDelete, setReceiptToDelete] = useState<ReceiptGroup | null>(null);
    const [isRecovering, setIsRecovering] = useState(false);

    const [transactionToEdit, setTransactionToEdit] = useState<Transaction | null>(null);
    const [editTxAmount, setEditTxAmount] = useState('');
    const [editTxKg, setEditTxKg] = useState('');
    const [editTxPrice, setEditTxPrice] = useState('');
    const [editTxDate, setEditTxDate] = useState('');

    // Add Late Payment State
    const [latePaymentMaqal, setLatePaymentMaqal] = useState<ReceiptGroup | null>(null);
    const [latePaymentAmount, setLatePaymentAmount] = useState('');
    const [latePaymentDate, setLatePaymentDate] = useState('');

    const openEditModal = (tx: Transaction) => {
        setTransactionToEdit(tx);
        setEditTxAmount(tx.amount.toString());
        setEditTxKg(tx.kg ? tx.kg.toString() : '');
        setEditTxPrice(tx.price_per_kg ? tx.price_per_kg.toString() : '');
        setEditTxDate(tx.reference_date ? new Date(tx.reference_date).toISOString().split('T')[0] : '');
    };

    const handleEditTransaction = async () => {
        if (!transactionToEdit) return;
        setUpdating(true);
        try {
            const res = await fetch(`/api/ledger/${transactionToEdit.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'x-session-token': localStorage.getItem('dadwork_session_token') || '' },
                body: JSON.stringify({
                    amount: editTxAmount ? parseFloat(editTxAmount) : undefined,
                    kg: editTxKg ? parseFloat(editTxKg) : undefined,
                    price_per_kg: editTxPrice ? parseFloat(editTxPrice) : undefined,
                    reference_date: editTxDate || undefined
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to update');
            toast.success(data.message || 'Updated successfully!');
            setTransactionToEdit(null);
            localStorage.setItem('dadwork_customers_stale', Date.now().toString());
            await loadCustomerData(true);
        } catch (err: any) {
            toast.error(err.message);
        } finally {
            setUpdating(false);
        }
    };

    const handleAddLatePayment = async () => {
        if (!latePaymentMaqal || !latePaymentAmount) return;
        setUpdating(true);
        try {
            const res = await fetch(`/api/ledger`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-session-token': localStorage.getItem('dadwork_session_token') || '' },
                body: JSON.stringify({
                    customerId,
                    type: 'PAYMENT',
                    amount: parseFloat(latePaymentAmount),
                    reference_date: latePaymentDate || (latePaymentMaqal.mainDate ? latePaymentMaqal.mainDate : new Date().toISOString().split('T')[0]),
                    maqal_id: latePaymentMaqal.maqalId || null,
                    receipt_id: latePaymentMaqal.receiptId || null
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to add payment');
            toast.success(data.message || 'Late payment added securely!');
            setLatePaymentMaqal(null);
            setLatePaymentAmount('');
            setLatePaymentDate('');
            localStorage.setItem('dadwork_customers_stale', Date.now().toString());
            await loadCustomerData(true);
        } catch (err: any) {
            toast.error(err.message);
        } finally {
            setUpdating(false);
        }
    };

    const handleUndoTransaction = async (txId: string) => {
        if (!confirm('Are you sure you want to undo this entry? This will recalculate all subsequent balances.')) return;
        setUndoingTxId(txId);
        setUpdating(true);
        try {
            const res = await fetch(`/api/ledger/${txId}`, {
                method: 'DELETE',
                headers: { 'x-session-token': localStorage.getItem('dadwork_session_token') || '' }
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to undo');
            toast.success(data.message || 'Entry successfully undone.');
            localStorage.setItem('dadwork_customers_stale', Date.now().toString());
            // Small delay to let Vercel edge cache propagate the revalidateTag bust
            await new Promise(resolve => setTimeout(resolve, 800));
            await loadCustomerData(false);
        } catch (err: any) {
            toast.error(err.message);
        } finally {
            setUndoingTxId(null);
            setUpdating(false);
        }
    };

    const handleDeleteReceiptGroup = async (receipt: ReceiptGroup) => {
        setPendingSecurityAction(null);
        setReceiptToDelete(null);
        setDeletingReceiptId(receipt.receiptId ?? null);
        setUpdating(true);
        try {
            const transactionIds = receipt.entries.map(e => e.id);
            const res = await fetch(`/api/ledger/batch`, {
                method: 'DELETE',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-session-token': localStorage.getItem('dadwork_session_token') || '' 
                },
                body: JSON.stringify({ transactionIds, customerId })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to delete receipt');
            toast.success('Receipt successfully deleted and balance recalculated.');
            localStorage.setItem('dadwork_customers_stale', Date.now().toString());
            // Small delay to let Vercel edge cache propagate the revalidateTag bust
            await new Promise(resolve => setTimeout(resolve, 800));
            await loadCustomerData(false);
        } catch (err: any) {
            toast.error(err.message);
        } finally {
            setDeletingReceiptId(null);
            setUpdating(false);
        }
    };

    const toggleReceipt = (id: string) => {
        setExpandedReceipts(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const groupTransactionsInfoReceipts = (txns: Transaction[]) => {
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
            withoutGroupKey.forEach((txn, i) => {
                if (i === 0) {
                    currentGroup.push(txn);
                } else {
                    const prev = withoutGroupKey[i - 1];
                    const diff = Math.abs(new Date(txn.created_at).getTime() - new Date(prev.created_at).getTime());
                    if (diff < 15000) {
                        currentGroup.push(txn);
                    } else {
                        receiptGroups.push(currentGroup);
                        currentGroup = [txn];
                    }
                }
            });
            if (currentGroup.length > 0) receiptGroups.push(currentGroup);
        }

        // 5. Process groups and compute a stable sortDate from product reference dates
        const processedReceipts = receiptGroups.map((group, idx) => {
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

            const productDates = sorted.filter(t => t.type === 'PRODUCT').map(t => new Date(t.reference_date));
            let titleString = format(new Date(last.created_at), 'EEEE, MMMM dd, yyyy');

            // sortDate: use the EARLIEST product reference_date so ordering is by maqal date, not payment date
            // Fall back to created_at only for pure payment/adjustment groups
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

            // Canonical receipt_id: prefer shared product receipt_id, else first entry id
            const productReceiptId = sorted.find(t => t.type === 'PRODUCT' && t.receipt_id)?.receipt_id || null;

            return {
                id: `group-${idx}-${last.id}`,
                mainDate: last.reference_date,
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
        // FIFO = payments go to the OLDEST unpaid product receipt first (standard ledger behavior).
        // If a payment is meant for a specific pair, it will share that pair's receipt_id and never reach this step.
        // Sort oldest-first by product anchor date so we process chronologically.
        const oldestFirst = [...processedReceipts].sort((a, b) =>
            (a as any)._sortDate.getTime() - (b as any)._sortDate.getTime()
        );

        const merged: (ReceiptGroup & { _sortDate: Date })[] = [];
        for (const current of oldestFirst as (ReceiptGroup & { _sortDate: Date })[]) {
            // NEVER merge a group that has a strict maqalId lock
            const isPaymentOnly = current.totalMaqalka === 0 && current.totalAdjustment === 0 && current.totalPaid > 0 && current.maqalId == null;

            if (isPaymentOnly && merged.length > 0) {
                // FIFO: find the OLDEST product/adjustment receipt that is not yet fully paid
                let targetIdx = -1;
                for (let k = 0; k < merged.length; k++) {
                    const m = merged[k];
                    const owed = m.totalMaqalka + m.totalAdjustment;
                    if ((m.totalMaqalka > 0 || m.totalAdjustment > 0) && m.totalPaid < owed) {
                        targetIdx = k;
                        break;
                    }
                }

                // Fallback: if all previous receipts are fully paid, attach to most recent product receipt
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
                    // Combine entries sorted oldest-first
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

        // 7. Calculate sequential display IDs for this customer (count EVERY product maqal)
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

        // Apply it to all payment entries using their own maqal_id
        for (const m of merged) {
            for (const e of m.entries) {
                if (e.type === 'PAYMENT' && e.maqal_id != null) {
                    e.displayMaqalId = maqalIdMap.get(e.maqal_id);
                }
            }
        }

        // Re-sort newest-first for display using the stable product-anchor date
        // (Using _sortDate = product reference_date ensures 04 Jul always sits between 02 Jul and 06 Jul
        //  regardless of when payments were added)
        return merged
            .sort((a, b) => b._sortDate.getTime() - a._sortDate.getTime())
            .map(({ _sortDate, ...r }) => r as ReceiptGroup);
    };

    const { data: allCustomers } = useSWR<Customer[]>('/api/customers?lite=true', fetcher, {
        revalidateOnFocus: false,
        dedupingInterval: 300000,
        keepPreviousData: true,
        revalidateIfStale: false,
        revalidateOnReconnect: false,
    });
    
    // Construct the base URL for the first page of ledger data
    let baseLedgerUrl = `/api/ledger?customerId=${customerId}&limit=200&offset=0`;
    if (startDate) baseLedgerUrl += `&startDate=${startDate}`;
    if (endDate) baseLedgerUrl += `&endDate=${endDate}`;
    
    const { data: initialLedgerData, mutate: mutateLedger } = useSWR(baseLedgerUrl, fetcher, {
        revalidateOnFocus: false,
        dedupingInterval: 0,   // always re-fetch on demand (we control when via mutate)
        revalidateIfStale: false,
        revalidateOnReconnect: false,
    });

    // Sync SWR cache instantly to local state
    useEffect(() => {
        if (allCustomers) {
            setCustomer(allCustomers.find((c: Customer) => c.id === customerId) || null);
        }
    }, [allCustomers, customerId]);

    useEffect(() => {
        if (initialLedgerData) {
            const allTxns = (initialLedgerData.transactions || []).map((t: any) => ({
                ...t,
                amount: Number(t.amount || 0),
                kg: t.kg != null ? Number(t.kg) : undefined,
                price_per_kg: t.price_per_kg != null ? Number(t.price_per_kg) : undefined,
                previous_debt: Number(t.previous_debt || 0),
                new_debt: Number(t.new_debt || 0)
            }));
            setTransactions(allTxns);
            setReceipts(groupTransactionsInfoReceipts(allTxns));
            setSummary({
                totalKg: Number(initialLedgerData.summary?.totalKg || 0),
                totalPaid: Number(initialLedgerData.summary?.totalPaid || 0),
                currentBalance: Number(initialLedgerData.summary?.currentBalance || 0),
                lastTransactionType: initialLedgerData.summary?.lastTransactionType
            });
            setHasMore(allTxns.length === 200);
            setLoading(false);
        }
    }, [initialLedgerData]);

    const loadCustomerData = async (reset = false) => {
        if (reset) {
            setTransactions([]);
            setReceipts([]);
            setHasMore(true);
            setLoading(true);
        }
        // Tell SWR: "forget your local cache, go fetch fresh from the server"
        // The server-side revalidateTag('ledger') has already been called by the API
        // before this function runs, so the server cache is already busted.
        // We just need SWR to go re-request from the server.
        await mutateLedger(undefined, { revalidate: true });
    };

    const loadMore = async () => {
        setLoadingMore(true);
        try {
            const nextOffset = transactions.length;
            let url = `/api/ledger?customerId=${customerId}&limit=200&offset=${nextOffset}`;
            if (startDate) url += `&startDate=${startDate}`;
            if (endDate) url += `&endDate=${endDate}`;

            const ledgerRes = await fetch(url);
            const ledgerData = await ledgerRes.json();

            if (ledgerData.transactions && ledgerData.transactions.length > 0) {
                const fetchedTxns = ledgerData.transactions.map((t: any) => ({
                    ...t,
                    amount: Number(t.amount || 0),
                    kg: t.kg != null ? Number(t.kg) : undefined,
                    price_per_kg: t.price_per_kg != null ? Number(t.price_per_kg) : undefined,
                    previous_debt: Number(t.previous_debt || 0),
                    new_debt: Number(t.new_debt || 0)
                }));
                const newTxns = [...transactions, ...fetchedTxns];
                setTransactions(newTxns);
                setReceipts(groupTransactionsInfoReceipts(newTxns));
                setHasMore(fetchedTxns.length === 200);
            } else {
                setHasMore(false);
            }
        } catch (error) {
            toast.error('Failed to load more history');
        } finally {
            setLoadingMore(false);
        }
    };



    const handleOpenEdit = () => {
        if (!customer) return;
        setEditName(customer.name);
        setEditPhone(customer.phone || '');
        setEditCode(customer.customer_code);
        setEditGender(customer.gender || 'Other');
        setIsEditDialogOpen(true);
    };

    const handleUpdateCustomer = async () => {
        if (!customer) return;
        setUpdating(true);
        try {
            const res = await fetch(`/api/customers?id=${customerId}`, {
                method: 'PATCH',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-session-token': localStorage.getItem('dadwork_session_token') || ''
                },
                body: JSON.stringify({
                    name: editName,
                    phone: editPhone,
                    customer_code: editCode,
                    gender: editGender
                })
            });

            if (!res.ok) throw new Error('Update failed');

            toast.success('Customer updated successfully');
            setIsEditDialogOpen(false);
            localStorage.setItem('dadwork_customers_stale', Date.now().toString());
            loadCustomerData(); // Refresh info
        } catch (err) {
            toast.error('Failed to update customer');
        } finally {
            setUpdating(false);
        }
    };

    const handleClearAllHistory = () => {
        setPendingSecurityAction('clear_history');
    };

    const executeClearAllHistory = async () => {
        setPendingSecurityAction(null);
        setUpdating(true);
        try {
            const res = await fetch(`/api/ledger?customerId=${customerId}`, {
                method: 'DELETE',
                headers: { 'x-session-token': localStorage.getItem('dadwork_session_token') || '' }
            });
            if (!res.ok) throw new Error('Failed to clear history');
            toast.success('All history cleared. Balance is now $0.');
            localStorage.setItem('dadwork_customers_stale', Date.now().toString());
            loadCustomerData();
        } catch (e) {
            toast.error('Failed to clear history');
        } finally {
            setUpdating(false);
        }
    };

    const handleDeleteCustomer = () => {
        setPendingSecurityAction('delete_customer');
    };

    const executeDeleteCustomer = async () => {
        setPendingSecurityAction(null);
        if (!customer) return;
        try {
            const token = localStorage.getItem('dadwork_session_token') || '';
            const res = await fetch(`/api/customers?id=${customerId}`, {
                method: 'DELETE',
                headers: { 'x-session-token': token }
            });
            if (res.ok) {
                toast.success(`${customer.name} moved to Inactive. Their history is preserved.`);
                localStorage.setItem('dadwork_customers_stale', Date.now().toString());
                mutate('/api/dashboard');
                mutate('/api/customers?lite=true');
                router.push('/customers');
            } else {
                const data = await res.json();
                toast.error(data.error || 'Failed to deactivate customer');
            }
        } catch {
            toast.error('Network error');
        }
    };

    const handleRestoreCustomerRequest = () => {
        setPendingSecurityAction('restore_customer');
    };

    const executeRestoreCustomer = async () => {
        setPendingSecurityAction(null);
        if (!customer) return;
        setIsRecovering(true);
        try {
            const token = localStorage.getItem('dadwork_session_token') || '';
            const res = await fetch(`/api/customers?id=${customerId}&restore=true`, {
                method: 'DELETE',
                headers: { 'x-session-token': token }
            });
            if (!res.ok) throw new Error((await res.json()).error || 'Failed');

            toast.success(`${customer.name} restored to Active!`);
            localStorage.setItem('dadwork_customers_stale', Date.now().toString());
            window.dispatchEvent(new Event('dadwork_customers_stale'));
            mutate('/api/dashboard');
            mutate('/api/customers?lite=true');
            loadCustomerData(true);
        } catch (err: any) {
            toast.error(err.message || 'Failed to restore customer');
        } finally {
            setIsRecovering(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground font-medium">Loading history...</p>
                </div>
            </div>
        );
    }

    if (!customer) return null;

    const filteredReceipts = receipts.filter(r => {
        // Show receipts that have either Maqalka (products), payments, or adjustments
        return r.totalMaqalka > 0 || r.totalPaid > 0 || r.totalAdjustment > 0;
    });

    const finalReceipts = filteredReceipts.filter(r => {
        if (!searchTitle) return true;
        const title = r.titleString || format(new Date(r.mainDate), 'MMM dd, yyyy');
        return title.toLowerCase().includes(searchTitle.toLowerCase());
    });

    // The card label must match the final line of the most recent receipt:
    // "Reesto" = latest receipt HAS a payment (remaining balance after payment)
    // "Lacagta Guud" = latest receipt has NO payment (full amount still owed)
    const latestReceiptHasPayment = filteredReceipts.length > 0 ? filteredReceipts[0].totalPaid > 0 : false;

    return (
        <div className="max-w-2xl mx-auto space-y-3 pb-20">
            <SecurityVerificationDialog
                isOpen={!!pendingSecurityAction}
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingSecurityAction(null);
                        setReceiptToDelete(null);
                    }
                }}
                onConfirm={() => {
                    if (pendingSecurityAction === 'clear_history') executeClearAllHistory();
                    if (pendingSecurityAction === 'delete_customer') executeDeleteCustomer();
                    if (pendingSecurityAction === 'restore_customer') executeRestoreCustomer();
                    if (pendingSecurityAction === 'delete_receipt' && receiptToDelete) handleDeleteReceiptGroup(receiptToDelete);
                }}
                title={
                    pendingSecurityAction === 'clear_history' ? 'Clear History' : 
                    pendingSecurityAction === 'delete_receipt' ? 'Delete Receipt Block' : 
                    pendingSecurityAction === 'restore_customer' ? 'Restore Customer' :
                    'Delete Customer'
                }
                description={
                    pendingSecurityAction === 'clear_history' ? 'Permanently clear all ledger history for this customer?' : 
                    pendingSecurityAction === 'delete_receipt' ? `Permanently delete ${receiptToDelete?.entries.length} transactions from "${receiptToDelete?.titleString}"?` :
                    pendingSecurityAction === 'restore_customer' ? `Restore "${customer?.name}" to Active status? They will be given a new valid ID and appear in all active lists.` :
                    `Move "${customer?.name}" to Inactive? Their full history (daily book, ledger) will be preserved. You can recover them from the Inactive tab.`
                }
                isProcessing={updating}
            />

            {/* Transaction Edit Modal */}
            <Dialog open={!!transactionToEdit} onOpenChange={(open) => !open && setTransactionToEdit(null)}>
                <DialogContent className="w-[90vw] sm:max-w-[260px] bg-background/80 backdrop-blur-3xl border-border/50 shadow-2xl rounded-[20px] p-4 gap-3">
                    <DialogHeader className="mb-0">
                        <DialogTitle className="text-sm font-black uppercase tracking-tight text-blue-600 dark:text-blue-400">Edit Payment</DialogTitle>
                        <DialogDescription className="text-[9px] opacity-70">
                            {(3 - (transactionToEdit?.edit_count || 0))} edits remaining.
                        </DialogDescription>
                        {transactionToEdit?.type === 'PRODUCT' && (
                            <div className="bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500 p-3 mt-2 rounded-md">
                                <p className="text-xs text-blue-800 dark:text-blue-200 font-medium flex items-center gap-1.5">
                                    <Lock className="w-3.5 h-3.5 shrink-0" />
                                    KG amounts are locked to ensure perfect synchronization. To edit the KG, please edit the Buuga Maalinlaha (Daily Book).
                                </p>
                            </div>
                        )}
                    </DialogHeader>
                    <div className="grid gap-6 py-4">
                        {transactionToEdit?.type === 'PRODUCT' && (
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2 opacity-60">
                                    <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1">KG <Lock className="w-2.5 h-2.5" /></Label>
                                    <Input
                                        type="number"
                                        value={editTxKg}
                                        disabled
                                        className="h-12 font-bold bg-muted"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Price/KG</Label>
                                    <Input
                                        type="number"
                                        value={editTxPrice}
                                        onChange={e => {
                                            setEditTxPrice(e.target.value);
                                            if (editTxKg && e.target.value) {
                                                setEditTxAmount((parseFloat(editTxKg) * parseFloat(e.target.value)).toString());
                                            }
                                        }}
                                        className="h-12 font-bold"
                                    />
                                </div>
                            </div>
                        )}
                        
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Amount ($)</Label>
                                <Input
                                    type="number"
                                    value={editTxAmount}
                                    onChange={e => setEditTxAmount(e.target.value)}
                                    className="h-10 font-bold text-sm"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Date (Opt)</Label>
                                <Input
                                    type="date"
                                    value={editTxDate}
                                    onChange={e => setEditTxDate(e.target.value)}
                                    className="h-10 font-bold text-[10px]"
                                    disabled={transactionToEdit?.type === 'PRODUCT'}
                                />
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            className="w-full h-12 font-black uppercase tracking-widest"
                            onClick={handleEditTransaction}
                            disabled={updating || (transactionToEdit?.edit_count || 0) >= 3}
                        >
                            {updating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                            {(transactionToEdit?.edit_count || 0) >= 3 ? 'Edit Limit Reached' : 'Save Changes'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Late Payment Modal */}
            <Dialog open={!!latePaymentMaqal} onOpenChange={(open) => !open && setLatePaymentMaqal(null)}>
                <DialogContent className="w-[90vw] sm:max-w-[280px] bg-background/80 backdrop-blur-3xl border-border/50 shadow-2xl rounded-[24px] overflow-hidden p-0">
                    <div className="p-4 bg-gradient-to-br from-emerald-500/10 to-transparent">
                        <DialogHeader className="mb-4">
                            <DialogTitle className="text-sm font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                                <Plus className="w-4 h-4" /> Add Late Payment
                            </DialogTitle>
                            <DialogDescription className="text-[10px] opacity-70 font-medium">
                                This payment will be securely attached to <strong className="text-foreground">{latePaymentMaqal?.titleString}</strong>
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                            <div className="space-y-1.5">
                                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-1">Amount ($)</Label>
                                <Input
                                    type="number"
                                    value={latePaymentAmount}
                                    onChange={e => setLatePaymentAmount(e.target.value)}
                                    className="h-10 font-bold bg-background/50 border-border/50 focus-visible:ring-emerald-500/30 transition-all rounded-xl shadow-inner"
                                    placeholder="Enter amount..."
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-1">Date</Label>
                                <Input
                                    type="date"
                                    value={latePaymentDate || (latePaymentMaqal?.receiptId ? latePaymentMaqal.receiptId.substring(0, 10) : '')}
                                    onChange={e => setLatePaymentDate(e.target.value)}
                                    className="h-10 font-bold text-xs bg-background/50 border-border/50 rounded-xl shadow-inner"
                                />
                            </div>
                        </div>
                        <div className="mt-5">
                            <Button
                                className="w-full h-10 font-black uppercase tracking-widest rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/20 transition-all"
                                onClick={handleAddLatePayment}
                                disabled={updating || !latePaymentAmount}
                            >
                                {updating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                                {updating ? 'Saving...' : 'Add Payment'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* 1. Header Navigation */}
            <div className="flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={() => router.push('/customers')} className="rounded-full gap-1.5 text-muted-foreground hover:text-foreground text-xs h-8 px-2">
                    <ArrowLeft className="w-3.5 h-3.5" /> Back
                </Button>
                <div className="flex gap-2">
                    {customer?.is_inactive && (
                        <Button 
                            variant="default" 
                            size="sm" 
                            className="rounded-full gap-1 text-xs h-8 px-3 bg-emerald-500 hover:bg-emerald-600 text-white font-black tracking-widest shadow-lg animate-pulse" 
                            onClick={handleRestoreCustomerRequest}
                            disabled={isRecovering}
                        >
                            {isRecovering ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                            {isRecovering ? 'RECOVERING...' : 'RECOVER'}
                        </Button>
                    )}
                    {isSuperAdmin && (
                        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                            <DialogTrigger asChild>
                                <Button variant="outline" size="sm" className="rounded-full gap-1 text-xs h-8 px-2.5" onClick={handleOpenEdit}>
                                    <Pencil className="w-3 h-3" /> Edit
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[425px] border-border shadow-2xl">
                                <DialogHeader>
                                    <DialogTitle className="text-xl font-black uppercase tracking-tight">Edit Customer Details</DialogTitle>
                                </DialogHeader>
                                <div className="grid gap-6 py-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="name" className="text-xs font-black uppercase tracking-widest text-muted-foreground">Name</Label>
                                        <Input
                                            id="name"
                                            value={editName}
                                            onChange={e => setEditName(e.target.value)}
                                            className="h-12 font-bold"
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="code" className="text-xs font-black uppercase tracking-widest text-muted-foreground">Customer Code</Label>
                                            <Input
                                                id="code"
                                                value={editCode}
                                                onChange={e => setEditCode(e.target.value)}
                                                className="h-12 font-mono font-bold"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="gender" className="text-xs font-black uppercase tracking-widest text-muted-foreground">Gender</Label>
                                            <Select value={editGender} onValueChange={setEditGender}>
                                                <SelectTrigger className="h-12 font-bold">
                                                    <SelectValue placeholder="Gender" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="Male">Male</SelectItem>
                                                    <SelectItem value="Female">Female</SelectItem>
                                                    <SelectItem value="Other">Other</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="phone" className="text-xs font-black uppercase tracking-widest text-muted-foreground">Phone Number</Label>
                                        <Input
                                            id="phone"
                                            value={editPhone}
                                            onChange={e => setEditPhone(e.target.value)}
                                            className="h-12 font-bold"
                                            placeholder="+252..."
                                        />
                                    </div>
                                    <div className="flex gap-2 pt-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={handleOpenEdit}
                                            className="h-8 rounded-lg font-bold text-[10px] uppercase tracking-widest border-border/60 hover:bg-muted"
                                        >
                                            <Pencil className="w-3 h-3 mr-1.5 text-muted-foreground" />
                                            Edit Info
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={handleClearAllHistory}
                                            className="h-8 rounded-lg font-bold text-[10px] uppercase tracking-widest border-destructive/20 text-destructive hover:bg-destructive/5 hover:border-destructive/40"
                                        >
                                            <RefreshCw className="w-3 h-3 mr-1.5" />
                                            Clear All History
                                        </Button>
                                    </div>
                                </div>
                                <DialogFooter>
                                    <Button
                                        className="w-full h-12 font-black uppercase tracking-widest"
                                        onClick={handleUpdateCustomer}
                                        disabled={updating}
                                    >
                                        {updating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                                        Save Changes
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    )}

                </div>
            </div>

            {/* 2. COMPACT PROFILE CARD */}
            <Card className="glass-card overflow-hidden border relative">
                <AnimatedBackground />
                {/* Non-clickable maqal status corner badge */}
                {maqalStatus && (
                    <div className={`absolute top-2 right-2 z-20 flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-black border pointer-events-none select-none ${
                        maqalStatus.has_payment
                            ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                            : 'bg-amber-500/15 border-amber-500/30 text-amber-600 dark:text-amber-400'
                    }`}>
                        {!maqalStatus.has_payment && (
                            <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500" />
                            </span>
                        )}
                        {maqalStatus.has_payment ? '✓' : '!'} Maqal
                    </div>
                )}
                <CardContent className="p-2.5 sm:p-3 relative z-10">
                    <div className="flex items-center gap-2.5">
                        <Avatar className="h-10 w-10 border-2 border-background shadow shrink-0">
                            <AvatarFallback className="text-sm bg-primary text-primary-foreground font-black">
                                {customer.name.substring(0, 1).toUpperCase()}
                            </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                                <h1 className="text-sm sm:text-base font-black tracking-tight text-foreground uppercase truncate">{customer.name}</h1>
                                <span className="bg-primary/10 text-primary text-[8px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-tighter border border-primary/20 shrink-0">
                                    {customer.customer_code}
                                </span>
                            </div>
                            {customer.phone && (
                                <p className="text-[11px] text-muted-foreground font-medium mt-0.5">
                                    {customer.phone}
                                </p>
                            )}
                        </div>
                        <div className="text-right shrink-0">
                            <p className={`text-lg sm:text-xl font-black leading-none ${summary.currentBalance > 0 ? 'text-destructive' : 'text-emerald-500'}`}>
                                ${Math.abs(Math.round(summary.currentBalance)).toLocaleString()}
                            </p>
                            <span className={`text-[8px] uppercase font-bold ${summary.currentBalance > 0 ? 'text-destructive/70' : 'text-emerald-500/70'}`}>
                                {/* Driven by getBalanceLabel — single source of truth */}
                                {getBalanceLabel(filteredReceipts[0]?.totalPaid ?? 0, summary.currentBalance)}
                            </span>
                            {/* All-Time % — Skips latest 0% paid maqal */}
                            {(() => {
                                let allTimeMaqalka = 0;
                                let allTimePaid = 0;
                                
                                filteredReceipts.forEach((r, idx) => {
                                    // Skip the most recent maqal IF it has exactly 0 payments (so a fresh maqal doesn't ruin the all-time score)
                                    if (idx === 0 && r.totalPaid === 0) return;
                                    allTimeMaqalka += r.totalMaqalka;
                                    allTimePaid += r.totalPaid;
                                });

                                if (allTimeMaqalka === 0) return null;
                                const pct = Math.min(100, Math.round((allTimePaid / allTimeMaqalka) * 100));
                                
                                let label = '';
                                let colorClass = '';
                                
                                if (pct >= 100) { label = 'PERFECT'; colorClass = 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/30'; }
                                else if (pct >= 95) { label = 'EXCELLENT'; colorClass = 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'; }
                                else if (pct >= 85) { label = 'GOOD'; colorClass = 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30'; }
                                else if (pct >= 70) { label = 'BAD'; colorClass = 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'; }
                                else { label = 'WORST'; colorClass = 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30'; }

                                return (
                                    <div className="mt-1 flex flex-col items-end gap-0.5">
                                        <span className={`text-[9px] uppercase tracking-wider font-black px-2 py-0.5 rounded-full inline-flex items-center gap-1.5 ${colorClass}`}>
                                            ⚡ {pct}% All-Time <span className="opacity-40">|</span> {label}
                                        </span>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Header for History */}
            <div className="flex items-center justify-between border-b border-border/50 pb-2">
                <h2 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                    <History className="w-3 h-3 text-primary" />
                    Buuga Maqalka History
                </h2>
                <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setFilterActive(!filterActive)} className="h-7 px-3 text-[10px] font-black uppercase tracking-widest gap-1.5 rounded-full hover:bg-muted shadow-sm border border-transparent hover:border-border">
                        <Filter className="w-3 h-3" /> Filter
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-[10px] font-black uppercase tracking-widest gap-1.5 rounded-full border-blue-500/20 bg-background hover:bg-blue-500 hover:text-white transition-all shadow-sm"
                        onClick={() => {
                            import('@/lib/export-pdf').then(m => m.downloadCustomerHistoryPDF(customer, transactions));
                        }}
                    >
                        <FileDown className="w-3 h-3" />
                        Export PDF
                    </Button>
                </div>
            </div>

            {/* Filter Section */}
            {filterActive && (
                <div className="bg-card border border-border p-4 rounded-xl flex flex-col md:flex-row gap-4 shadow-sm animate-in fade-in slide-in-from-top-2">
                    <div className="flex-1 space-y-1.5">
                        <Label className="text-[9px] uppercase font-black tracking-widest text-muted-foreground">Quick Search</Label>
                        <Input 
                            placeholder="e.g. 07 Jun" 
                            className="h-10 text-xs font-bold bg-background shadow-inner" 
                            value={searchTitle} 
                            onChange={(e) => setSearchTitle(e.target.value)} 
                        />
                    </div>
                    <div className="flex-1 space-y-1.5">
                        <Label className="text-[9px] uppercase font-black tracking-widest text-muted-foreground">DB Start Date</Label>
                        <Input type="date" className="h-10 text-xs font-bold bg-background shadow-inner" value={startDate} onChange={e => setStartDate(e.target.value)} />
                    </div>
                    <div className="flex-1 space-y-1.5">
                        <Label className="text-[9px] uppercase font-black tracking-widest text-muted-foreground">DB End Date</Label>
                        <Input type="date" className="h-10 text-xs font-bold bg-background shadow-inner" value={endDate} onChange={e => setEndDate(e.target.value)} />
                    </div>
                    <div className="flex items-end">
                        <Button size="sm" className="h-10 w-full md:w-auto font-black uppercase tracking-widest text-[10px] px-6 shadow-md" onClick={() => loadCustomerData(true)}>Search</Button>
                    </div>
                </div>
            )}

            {/* 4. RECEIPT HISTORY LIST */}
            <div className="space-y-3">
                {finalReceipts.length === 0 ? (
                    <div className="py-20 text-center space-y-4">
                        <div className="w-20 h-20 bg-muted/30 rounded-full flex items-center justify-center mx-auto border-4 border-dashed border-border/50">
                            <History className="w-8 h-8 text-muted-foreground/30" />
                        </div>
                        <div>
                            <p className="text-lg font-black text-muted-foreground uppercase tracking-widest">No Records Found</p>
                            <p className="text-xs text-muted-foreground/60">Change your filter or add a new transaction.</p>
                        </div>
                    </div>
                ) : (
                    finalReceipts.map((receipt, receiptIdx) => {
                        const isExpanded = expandedReceipts.has(receipt.id);

                        let pct = 0;
                        let paymentsInReceipt = 0;
                        let statusColorClass = 'bg-primary'; 
                        let textStatusColorClass = 'text-primary';
                        let gradientBorderClass = 'border-primary/40 bg-gradient-to-r from-primary/5 via-transparent to-primary/5';

                        if (receipt.totalMaqalka > 0) {
                            paymentsInReceipt = receipt.entries.filter(e => e.type === 'PAYMENT').reduce((sum, e) => sum + Math.abs(e.amount), 0);
                            pct = Math.min(100, Math.round((paymentsInReceipt / receipt.totalMaqalka) * 100));

                            if (pct >= 100) {
                                statusColorClass = 'bg-emerald-500';
                                textStatusColorClass = 'text-emerald-600 dark:text-emerald-400';
                                gradientBorderClass = 'border-emerald-400/40 dark:border-emerald-500/30 bg-gradient-to-r from-emerald-500/5 via-transparent to-emerald-500/5 shadow-[0_0_8px_rgba(16,185,129,0.15)]';
                            } else if (pct >= 80) {
                                statusColorClass = 'bg-orange-500';
                                textStatusColorClass = 'text-orange-600 dark:text-orange-400';
                                gradientBorderClass = 'border-orange-400/40 dark:border-orange-500/30 bg-gradient-to-r from-orange-500/5 via-transparent to-orange-500/5 shadow-[0_0_8px_rgba(249,115,22,0.15)]';
                            } else if (pct >= 50) {
                                statusColorClass = 'bg-red-500';
                                textStatusColorClass = 'text-red-600 dark:text-red-400';
                                gradientBorderClass = 'border-red-400/40 dark:border-red-500/30 bg-gradient-to-r from-red-500/5 via-transparent to-red-500/5 shadow-[0_0_8px_rgba(239,68,68,0.15)]';
                            } else {
                                statusColorClass = 'bg-rose-800 dark:bg-rose-900';
                                textStatusColorClass = 'text-rose-800 dark:text-rose-500';
                                gradientBorderClass = 'border-rose-400/40 dark:border-rose-500/30 bg-gradient-to-r from-rose-800/5 via-transparent to-rose-800/5 shadow-[0_0_8px_rgba(190,18,60,0.15)]';
                            }
                        } else if (receipt.kind === 'ADJUSTMENT') {
                            statusColorClass = 'bg-amber-500';
                        }

                        return (
                            <div key={receipt.id} className="rounded-lg border border-border/60 overflow-hidden bg-card">
                            <button
                                    onClick={() => toggleReceipt(receipt.id)}
                                    className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-muted/30 transition-colors"
                                >
                                    <div className={`w-1 h-8 rounded-full shrink-0 transition-colors duration-300 ${statusColorClass}`} />
                                    <div className="flex-1 text-left min-w-0">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <p className="text-[11px] font-bold text-foreground leading-tight flex items-center gap-1.5 flex-wrap min-w-0">
                                                <span className="truncate">{receipt.titleString || format(new Date(receipt.mainDate), 'MMM dd, yyyy')}</span>
                                                {receipt.displayMaqalId != null && (
                                                    <span className="inline-flex items-center gap-0.5 text-[9px] font-black px-1.5 py-0.5 rounded-md bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/40 shrink-0 tracking-wider uppercase animate-mq-pulse shadow-[0_0_8px_rgba(59,130,246,0.25)]">
                                                        ⚡MQ#{receipt.displayMaqalId}
                                                    </span>
                                                )}
                                            </p>
                                            {(() => {
                                                // We want to target ONLY the Maqal that immediately precedes the newest one.
                                                // Find all Maqal indices first.
                                                const maqalIndices = finalReceipts
                                                    .map((r, i) => (r.totalMaqalka > 0 || r.totalAdjustment > 0) ? i : -1)
                                                    .filter(i => i !== -1);
                                                
                                                // The active Maqal is maqalIndices[0]
                                                // The target Maqal for late payments is maqalIndices[1]
                                                const isTargetMaqal = maqalIndices.length > 1 && receiptIdx === maqalIndices[1];
                                                
                                                const paymentsCount = receipt.entries.filter(e => e.type === 'PAYMENT').length;
                                                const latePaymentsLeft = Math.max(0, 3 - paymentsCount);
                                                const showLatePayment = isTargetMaqal && (isSuperAdmin || (canUndo && latePaymentsLeft > 0));
                                                
                                                return showLatePayment ? (
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="h-6 text-[8px] font-black uppercase tracking-widest text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 hover:bg-emerald-500/10 px-2 rounded-full border border-emerald-500/20 backdrop-blur-md transition-all shadow-sm shrink-0"
                                                        onClick={(e) => { e.stopPropagation(); setLatePaymentMaqal(receipt); }}
                                                    >
                                                        <Plus className="w-2.5 h-2.5 mr-1" /> Late Payment
                                                        {!isSuperAdmin && <span className="ml-1 px-1 rounded-sm bg-emerald-500/20 text-[7px] text-emerald-700 dark:text-emerald-300 tracking-wider">({latePaymentsLeft} left)</span>}
                                                    </Button>
                                                ) : null;
                                            })()}
                                        </div>
                                        {/* Inline badges: % paid + diff amount */}
                                        {receipt.totalMaqalka > 0 && paymentsInReceipt > 0 && (() => {
                                            const diff = paymentsInReceipt - receipt.totalMaqalka;
                                            const isOverpaid = diff > 0;
                                            const isExact = diff === 0;

                                            return (
                                                <div className={`mt-1.5 w-full h-[18px] overflow-hidden relative border-l-2 border-r-2 rounded transition-colors duration-300 ${gradientBorderClass}`}>
                                                    <div className="inline-flex gap-4 w-max animate-kinetic px-2">
                                                        {/* % Paid badge */}
                                                        <span className={`text-[8px] font-black tracking-widest uppercase flex items-center gap-1 animate-lightning transition-colors duration-300 ${textStatusColorClass}`}>
                                                            ⚡ {pct}% Paid
                                                        </span>
                                                        {/* Diff badge */}
                                                        {!isExact && (
                                                            <span className={`text-[8px] font-black tracking-widest uppercase flex items-center gap-1 animate-lightning transition-colors duration-300 ${
                                                                isOverpaid
                                                                    ? 'text-emerald-600 dark:text-emerald-400'
                                                                    : textStatusColorClass
                                                            }`}>
                                                                ⚡ {isOverpaid
                                                                    ? `Kaso hartay -$${Math.abs(Math.round(diff))}`
                                                                    : `Ka dhiman +$${Math.abs(Math.round(diff))}`}
                                                            </span>
                                                        )}
                                                        {isExact && pct >= 100 && (
                                                            <span className="text-[8px] font-black tracking-widest uppercase flex items-center gap-1 animate-lightning text-emerald-600 dark:text-emerald-400">
                                                                ⚡ ✓ Exact
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                    <span className={`text-sm font-black shrink-0 ${receipt.closingBalance > 0 ? 'text-destructive' : 'text-emerald-500'}`}>
                                        {receipt.closingBalance < 0 ? '-' : ''}${Math.abs(Math.round(receipt.closingBalance)).toLocaleString()}
                                    </span>
                                    {isSuperAdmin && (
                                        <div 
                                            role="button" 
                                            tabIndex={0}
                                            onClick={(e) => { 
                                                e.stopPropagation(); 
                                                setReceiptToDelete(receipt);
                                                setPendingSecurityAction('delete_receipt');
                                            }} 
                                            className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-red-500/10 text-red-500/70 hover:text-red-600 transition-colors shrink-0 ml-1"
                                        >
                                            {deletingReceiptId === receipt.receiptId ? <Loader2 className="w-4 h-4 animate-spin text-red-500" /> : <Trash2 className="w-4 h-4" />}
                                        </div>
                                    )}
                                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                                </button>

                                {isExpanded && (
                                    <div className="border-t border-border/40 animate-in slide-in-from-top-1 duration-150">
                                        {/* PRINT PROOF HEADER (Visible only during print) */}
                                        <div className="hidden print:block p-6 text-center border-b-2 border-primary mb-4">
                                            <h1 className="text-2xl font-black uppercase tracking-widest">Dadcare Ledger Proof</h1>
                                            <p className="text-sm font-bold text-muted-foreground mt-1">{customer.name} · ID: {customer.customer_code}</p>
                                            <p className="text-[10px] uppercase mt-2">{receipt.titleString}</p>
                                        </div>

                                        <div className="px-3 py-2 flex justify-end gap-2 bg-muted/10 border-b border-border/30 print:hidden flex-wrap">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-7 text-[10px] font-black uppercase tracking-widest gap-1.5 rounded-full border-emerald-500/20 bg-background hover:bg-emerald-500 hover:text-white transition-all shadow-sm"
                                                onClick={() => {
                                                    downloadReceiptPDF({
                                                        customerName: customer.name,
                                                        customerCode: customer.customer_code,
                                                        titleString: receipt.titleString || '',
                                                        entries: receipt.entries,
                                                        totalMaqalka: receipt.totalMaqalka,
                                                        totalPaid: receipt.totalPaid,
                                                        totalAdjustment: receipt.totalAdjustment,
                                                        openingBalance: receipt.openingBalance,
                                                        closingBalance: receipt.closingBalance,
                                                    });
                                                    toast.success('PDF Downloaded!');
                                                }}
                                            >
                                                <FileDown className="w-3 h-3" />
                                                PDF
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-7 text-[10px] font-black uppercase tracking-widest gap-1.5 rounded-full border-green-500/20 bg-background hover:bg-green-500 hover:text-white transition-all shadow-sm"
                                                onClick={() => {
                                                    shareReceiptToWhatsApp({
                                                        customerName: customer.name,
                                                        customerCode: customer.customer_code,
                                                        titleString: receipt.titleString || '',
                                                        entries: receipt.entries,
                                                        totalMaqalka: receipt.totalMaqalka,
                                                        totalPaid: receipt.totalPaid,
                                                        totalAdjustment: receipt.totalAdjustment,
                                                        openingBalance: receipt.openingBalance,
                                                        closingBalance: receipt.closingBalance,
                                                    }, customer.phone);
                                                }}
                                            >
                                                <MessageCircle className="w-3 h-3" />
                                                WhatsApp
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-7 text-[10px] font-black uppercase tracking-widest gap-1.5 rounded-full border-primary/20 bg-background hover:bg-primary hover:text-white transition-all shadow-sm"
                                                onClick={() => window.print()}
                                            >
                                                <Printer className="w-3 h-3" />
                                                Print
                                            </Button>
                                        </div>
                                        {receipt.kind === 'ADJUSTMENT' ? (
                                            <div>
                                            </div>
                                        ) : (
                                            <div className="relative overflow-hidden bg-[#fdfbf7] dark:bg-[#1e1c18] font-mono text-[11px] pb-4 rounded-b-lg border-t border-border/40 shadow-inner">
                                                {/* Vertical Notebook Lines (Margin) */}
                                                <div className="absolute left-8 top-0 bottom-0 w-px bg-[#C19A6B]/60 dark:bg-[#C19A6B]/40 z-0"></div>
                                                <div className="absolute left-9 top-0 bottom-0 w-px bg-[#C19A6B]/60 dark:bg-[#C19A6B]/40 z-0"></div>

                                                <div className="relative z-10 pl-12 pr-4 pt-3 space-y-0 text-slate-800 dark:text-slate-300">
                                                    {receipt.titleString && (() => {
                                                        const paymentsInReceipt = receipt.entries.filter(e => e.type === 'PAYMENT').reduce((sum, e) => sum + Math.abs(e.amount), 0);
                                                        const pct = receipt.totalMaqalka > 0 ? Math.min(100, Math.round((paymentsInReceipt / receipt.totalMaqalka) * 100)) : 100;
                                                        return (
                                                            <div className="flex flex-col items-center justify-center gap-1 mb-3">
                                                                <p className="text-[9px] font-bold text-muted-foreground text-center">
                                                                    {receipt.titleString}
                                                                </p>
                                                                {receipt.totalMaqalka > 0 && (
                                                                    <span className={`text-[8px] px-1.5 py-0.5 rounded-sm font-bold tracking-wider ${pct >= 100 ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400' : pct >= 50 ? 'bg-amber-500/20 text-amber-700 dark:text-amber-500' : 'bg-red-500/20 text-red-700 dark:text-red-400'}`}>
                                                                        {pct}% Paid
                                                                    </span>
                                                                )}
                                                            </div>
                                                        );
                                                    })()}

                                                    {/* 1. Maqalka entries (products) */}
                                                    {receipt.entries.filter(e => e.type === 'PRODUCT').filter((e, idx, arr) => {
                                                        if (Math.round(e.kg || 0) > 0) return true;
                                                        const hasOther = arr.some(other => other.reference_date === e.reference_date && other.id !== e.id && Math.round(other.kg || 0) > 0);
                                                        return !hasOther;
                                                    }).map((e, idx, arr) => {
                                                        const isAbsent = Math.round(e.kg || 0) === 0;
                                                        const hasMain = arr.some(other => other.reference_date === e.reference_date && !other.note && Math.round(other.kg || 0) > 0);
                                                        return (
                                                            <div key={e.id} className={`flex justify-between items-start py-1.5 border-b border-blue-200 dark:border-blue-900/40 font-medium ${isAbsent ? 'opacity-60 line-through-none' : ''}`}>
                                                                <div className="flex flex-col flex-1">
                                                                    <span>
                                                                        {(e.note && hasMain) ? '↳ ' : ''}
                                                                        {format(new Date(e.reference_date), 'MMM dd')} · {isAbsent ? '❌ Baaqatay' : `${Math.round(e.kg || 0)}KG @ $${e.price_per_kg}`}
                                                                        {e.note ? ` (${e.note})` : ''}
                                                                    </span>
                                                                    {/* Edit/Undo completely removed for PRODUCT entries as requested */}
                                                                </div>
                                                                <span className="font-bold shrink-0">{isAbsent ? '$0' : `$${Math.round(e.amount).toLocaleString()}`}</span>
                                                            </div>
                                                        );
                                                    })}

                                                    {/* 2. Maqalka Total (products subtotal only) */}
                                                    {receipt.entries.some(e => e.type === 'PRODUCT') && (() => {
                                                        const paymentsInReceipt = receipt.entries.filter(e => e.type === 'PAYMENT').reduce((sum, e) => sum + Math.abs(e.amount), 0);
                                                        const pct = receipt.totalMaqalka > 0 ? Math.min(100, Math.round((paymentsInReceipt / receipt.totalMaqalka) * 100)) : 100;
                                                        return (
                                                            <div className="flex justify-between py-1.5 border-b border-blue-300 dark:border-blue-800/60 font-bold text-slate-900 dark:text-slate-100">
                                                                <span className="flex items-center gap-2">
                                                                    Maqalka
                                                                    <span className={`text-[8px] px-1.5 py-0.5 rounded-sm ${pct >= 100 ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400' : pct >= 50 ? 'bg-amber-500/20 text-amber-700 dark:text-amber-500' : 'bg-red-500/20 text-red-700 dark:text-red-400'}`}>
                                                                        {pct}% Paid
                                                                    </span>
                                                                </span>
                                                                <span>${Math.round(receipt.totalMaqalka).toLocaleString()}</span>
                                                            </div>
                                                        );
                                                    })()}

                                                    {/* 3. Reesto (Previous/Opening Balance) */}
                                                    {receipt.openingBalance !== 0 && (
                                                        <div className={`flex justify-between py-1.5 border-b border-blue-200 dark:border-blue-900/40 font-bold px-1 -ml-1 rounded-sm mt-1 ${
                                                            receipt.openingBalance < 0
                                                                ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/5'
                                                                : 'text-amber-700 dark:text-amber-500 bg-amber-500/5'
                                                        }`}>
                                                            <span>{receipt.openingBalance < 0 ? LABEL_HEYN : LABEL_REESTO}</span>
                                                            <span>
                                                                {receipt.openingBalance < 0 ? '-' : '+'}
                                                                ${Math.abs(Math.round(receipt.openingBalance)).toLocaleString()}
                                                            </span>
                                                        </div>
                                                    )}

                                                    {/* 3b. Adjustment entries (also Reesto — carried-over debt) */}
                                                    {receipt.entries.filter(e => e.type === 'ADJUSTMENT').map(e => (
                                                        <div key={e.id} className="flex justify-between py-1.5 border-b border-blue-200 dark:border-blue-900/40 text-amber-700 dark:text-amber-500 font-bold bg-amber-500/5 px-1 -ml-1 rounded-sm mt-1">
                                                            <span>{e.amount < 0 ? LABEL_HEYN : LABEL_REESTO}</span>
                                                            <span>{e.amount > 0 ? '+' : ''}${Math.abs(Math.round(e.amount)).toLocaleString()}</span>
                                                        </div>
                                                    ))}

                                                    {/* 4. Lacagta Guud — total owed (Maqalka + Heyn) */}
                                                    {(receipt.totalMaqalka > 0 || receipt.totalAdjustment > 0) && (() => {
                                                        const totalOwed = Math.round(receipt.totalMaqalka + receipt.totalAdjustment + receipt.openingBalance);
                                                        return (
                                                            <div className="flex justify-between py-1.5 border-b-2 border-red-300 dark:border-red-900/50 font-black text-slate-900 dark:text-slate-100">
                                                                <span>{totalOwed < 0 ? LABEL_HEYN : LABEL_LACAGTA_GUUD}</span>
                                                                <span>${Math.abs(totalOwed).toLocaleString()}</span>
                                                            </div>
                                                        );
                                                    })()}

                                                    {/* 5. Lacagaha (Payments list) */}
                                                    {receipt.entries.some(e => e.type === 'PAYMENT') && (
                                                        <>
                                                            <p className="text-[9px] font-black uppercase tracking-[0.15em] text-emerald-700/80 dark:text-emerald-500/80 pt-2.5 pb-0.5">Lacagaha</p>
                                                            {receipt.entries.filter(e => e.type === 'PAYMENT').map(e => (
                                                                <div key={e.id} className="flex justify-between items-start py-1.5 border-b border-blue-200 dark:border-blue-900/40 text-emerald-700 dark:text-emerald-500 font-bold">
                                                                    <div className="flex flex-col flex-1">
                                                                        <span className="flex items-center gap-1.5">
                                                                            {format(new Date(e.reference_date), 'MMM dd')} Payment
                                                                            {e.displayMaqalId != null ? (
                                                                                <span className="inline-flex items-center gap-0.5 text-[8px] font-black px-1.5 py-0.5 rounded-md bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30 shrink-0 tracking-wider uppercase animate-mq-pulse shadow-[0_0_5px_rgba(59,130,246,0.2)]">
                                                                                    ⚡MQ#{e.displayMaqalId}
                                                                                </span>
                                                                            ) : null}
                                                                        </span>
                                                                        {(() => {
                                                                            const txTime = new Date(e.created_at || e.reference_date).getTime();
                                                                            const isRecent = (Date.now() - txTime) < 24 * 60 * 60 * 1000;
                                                                            // Everyone has a 24h time limit (including Super Admin). 
                                                                            // Regular admins ALSO require it to be their priority customer (canUndo).
                                                                            const showUndo = canUndo && isRecent;
                                                                            
                                                                            const offset = (finalReceipts[0]?.totalPaid === 0 && finalReceipts[0]?.totalMaqalka > 0) ? 1 : 0;
                                                                            const isEditable = receiptIdx === offset;
                                                                            const editsLeft = Math.max(0, 3 - (e.edit_count || 0));
                                                                            const showEdit = canUndo && isEditable && (isSuperAdmin || editsLeft > 0);

                                                                            if (showUndo || showEdit) {
                                                                                return (
                                                                                    <div className="flex gap-3 mt-1 opacity-60 hover:opacity-100 transition-opacity print:hidden">
                                                                                        {showEdit && (
                                                                                            <button onClick={(ev) => { ev.stopPropagation(); openEditModal(e); }} className="text-[10px] uppercase font-bold flex items-center gap-1 hover:underline text-amber-600 dark:text-amber-500">
                                                                                                <Pencil className="w-3 h-3"/> Edit
                                                                                                {!isSuperAdmin && <span className="px-1 rounded-sm bg-amber-500/20 text-[7px] text-amber-700 dark:text-amber-300 tracking-wider font-black">({editsLeft} left)</span>}
                                                                                            </button>
                                                                                        )}
                                                                                        {showUndo && (
                                                                                            <button onClick={(ev) => { ev.stopPropagation(); handleUndoTransaction(e.id); }} disabled={undoingTxId === e.id} className="text-[10px] uppercase font-bold text-red-600 dark:text-red-400 flex items-center gap-1 hover:underline disabled:opacity-50 disabled:cursor-not-allowed">{undoingTxId === e.id ? <Loader2 className="w-3 h-3 animate-spin"/> : <Trash2 className="w-3 h-3"/>}{undoingTxId === e.id ? 'Undoing...' : 'Undo'}</button>
                                                                                        )}
                                                                                    </div>
                                                                                );
                                                                            }
                                                                            return null;
                                                                        })()}
                                                                    </div>
                                                                    <span className="shrink-0">-${Math.round(e.amount).toLocaleString()}</span>
                                                                </div>
                                                            ))}
                                                        </>
                                                    )}

                                                    {/* 6. Final Balance — shown when payment was made */}
                                                    {receipt.totalPaid > 0 && (
                                                        <div className="flex justify-between items-center pt-2 mt-2 border-t-2 border-double border-amber-400/50 dark:border-amber-600/50 px-1 py-1">
                                                            <span className={`font-black text-sm ${
                                                                receipt.closingBalance < 0
                                                                    ? 'text-emerald-600 dark:text-emerald-400'
                                                                    : 'text-[#C19A6B] dark:text-[#D4B087]'
                                                            }`}>
                                                                {receipt.closingBalance < 0 ? LABEL_HEYN : LABEL_REESTO}
                                                            </span>
                                                            <span className={`text-lg font-black ${
                                                                receipt.closingBalance > 0
                                                                    ? 'text-destructive'
                                                                    : receipt.closingBalance < 0
                                                                        ? 'text-emerald-600 dark:text-emerald-400'
                                                                        : 'text-slate-500'
                                                            }`}>
                                                                {receipt.closingBalance < 0 ? '-' : ''}${Math.abs(Math.round(receipt.closingBalance)).toLocaleString()}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {/* Pagination Load More Button */}
            {hasMore && finalReceipts.length > 0 && !searchTitle && (
                <Button 
                    variant="outline" 
                    onClick={loadMore} 
                    disabled={loadingMore} 
                    className="w-full mt-6 h-12 font-black uppercase tracking-widest text-xs border-dashed border-2 hover:bg-muted shadow-sm text-muted-foreground hover:text-foreground"
                >
                    {loadingMore ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ChevronDown className="w-4 h-4 mr-2" />}
                    Load Older History
                </Button>
            )}
        </div>
    );
}
