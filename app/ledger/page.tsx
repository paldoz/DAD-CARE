'use client';

import { useState, useEffect, useMemo, useDeferredValue } from 'react';
import { format, parseISO } from 'date-fns';
import { groupTransactionsInfoReceipts, type Transaction } from '@/app/utils/ledgerHelpers';
import { smartCustomerSearch } from '@/lib/search-utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { DollarSign, Plus, Loader2, Trash2, Package, ArrowRight, Receipt, Lock, User, Scale, CalendarIcon, TrendingUp, TrendingDown, Info, BookOpen, RefreshCw, ChevronDown, ChevronUp, CheckCircle2, Star } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import useSWR from 'swr';
import { AnimatedBackground } from '@/components/animated-background';
import { useSession } from '@/hooks/useSession';

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

const dailyEntriesFetcher = async (url: string) => {
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
    const data = await res.json();
    console.log('[DEBUG-TRACE] SWR API Response Data:', data);
    
    return {
        dailyData: data,
        allUnprocessedDates: JSON.parse(res.headers.get('x-all-unprocessed-dates') || '[]'),
        maqalId: res.headers.get('x-maqal-id') ? parseInt(res.headers.get('x-maqal-id')!, 10) : null
    };
};

interface DateEntry {
    id: string;
    date: string;
    kg: string;
    pricePerKg: string;
    extraKg?: string;
    extraPricePerKg?: string;
    extraNote?: string;
    mainNote?: string;
    isReady?: boolean;
}

interface PaymentEntry {
    id: string;
    date: string;
    amount: string;
    note?: string;
}



interface CustomerSummary {
    totalKg: number;
    totalPaid: number;
    currentBalance: number;
}

interface DailyBookRecord {
    date: string;
    kg: number;
    processed: boolean;
    note?: string | null;
    isReady?: boolean;
}

/**
 * Generic note entry parser.
 * Supports any pattern: "{count} {label} {price}"
 * Examples:
 *   "5 vip 36"      → { kg: 5, label: 'vip', price: 36 }
 *   "5 heshiish 30" → { kg: 5, label: 'heshiish', price: 30 }
 *   "5 lafaha 30"   → { kg: 5, label: 'lafaha', price: 30 }
 *   "10 vip"        → { kg: 10, label: 'vip', price: null }
 * The label word is used as the display badge. Any Somali/custom word works.
 */
const parseNoteEntries = (note: string): { kg: number; label: string; price: number | null }[] => {
    if (!note) return [];
    const n = note.trim();
    const results: { kg: number; label: string; price: number | null }[] = [];

    // Pattern: {count} {word(s)} {price} — e.g. "5 vip 36", "10 heshiish 30", "7 lafaha 25"
    // Also handles comma-separated: "5 vip 36, 3 notebook 32"
    const fullPattern = /(\d+(?:\.\d+)?)\s+([a-zA-Z][a-zA-Z\s]{0,20}?)\s+(\d+(?:\.\d+)?)/g;
    let match;
    while ((match = fullPattern.exec(n)) !== null) {
        const kg = parseFloat(match[1]);
        const label = match[2].trim();
        const price = parseFloat(match[3]);
        // Skip if the label is just 'vip' captured with trailing spaces — handled anyway
        if (kg > 0 && price > 0) {
            results.push({ kg, label, price });
        }
    }

    // If no full matches, try {count} {word} without a price (e.g. "5 vip")
    if (results.length === 0) {
        const simplePattern = /(\d+(?:\.\d+)?)\s+([a-zA-Z][a-zA-Z]{1,20})/g;
        while ((match = simplePattern.exec(n)) !== null) {
            const kg = parseFloat(match[1]);
            const label = match[2].trim();
            if (kg > 0) {
                results.push({ kg, label, price: null });
            }
        }
    }

    return results;
};

const buildEntryFromDailyRecord = (
    id: string,
    record: DailyBookRecord,
    defaultPrice: string,
    dateSpecificPrices?: Record<string, string>,
    dateSpecificOverrides?: Record<string, Record<string, string>>,
    customerId?: string
): { entry: DateEntry; shouldExpandExtra: boolean } => {
    let kg = record.kg ? record.kg.toString() : '0';
    
    // Apply date-specific price if available, otherwise fallback to global default
    const entryDateKey = record.date ? record.date.substring(0, 10) : '';
    
    let pricePerKg = defaultPrice;
    
    // 1. Check for customer-specific override
    if (customerId && dateSpecificOverrides && dateSpecificOverrides[entryDateKey] && dateSpecificOverrides[entryDateKey][customerId]) {
        pricePerKg = dateSpecificOverrides[entryDateKey][customerId];
    } 
    // 2. Check for global date price
    else if (dateSpecificPrices && dateSpecificPrices[entryDateKey]) {
        pricePerKg = dateSpecificPrices[entryDateKey];
    }
    
    let extraKg = '';
    let extraPricePerKg = pricePerKg;
    let extraNote = 'Notebook';
    let mainNote = '';
    let shouldExpandExtra = false;

    if (record.note) {
        const noteText = record.note.trim();
        const noteEntries = parseNoteEntries(noteText);

        // Notebook Pricing Override — ONLY apply if there is NO date-specific price for this date
        // AND no specific entries were found.
        // This ensures date-specific prices set in Settings always win.
        const hasDateSpecificPrice = dateSpecificPrices && dateSpecificPrices[entryDateKey];
        if (!hasDateSpecificPrice && noteEntries.length === 0) {
            const priceMatch = noteText.match(/(?:^|\s)\$?(\d+(?:\.\d+)?)(?:\s|$)/);
            if (priceMatch) {
                pricePerKg = priceMatch[1];
                extraPricePerKg = priceMatch[1];
            }
        }

        if (noteEntries.length > 0) {
            const firstEntry = noteEntries[0];
            const labelUpper = firstEntry.label.charAt(0).toUpperCase() + firstEntry.label.slice(1);

            if (noteEntries.length > 1) {
                // Two entries: e.g. "10 vip 38, 5 notebook 32" → extraKg=10@38, mainKg=5@32
                const secondEntry = noteEntries[1];
                extraKg = firstEntry.kg.toString();
                if (firstEntry.price !== null) extraPricePerKg = firstEntry.price.toString();
                extraNote = labelUpper;
                shouldExpandExtra = true;

                kg = secondEntry.kg.toString();
                if (secondEntry.price !== null) pricePerKg = secondEntry.price.toString();
                const secondLabel = secondEntry.label.charAt(0).toUpperCase() + secondEntry.label.slice(1);
                mainNote = secondLabel;
            } else {
                // Single entry: e.g. "5 vip 36" → extraKg=5@36, mainKg=rest at default
                extraKg = firstEntry.kg.toString();
                if (firstEntry.price !== null) extraPricePerKg = firstEntry.price.toString();
                extraNote = labelUpper;
                shouldExpandExtra = true;

                // Subtract special KG from main KG and cap at 0
                const mainKgNum = Math.max(0, (record.kg || 0) - firstEntry.kg);
                kg = mainKgNum.toString();
            }
        }
    }

    return {
        entry: {
            id,
            date: record.date || '',
            kg,
            pricePerKg,
            extraKg,
            extraPricePerKg,
            extraNote,
            mainNote,
            isReady: record.isReady !== false
        },
        shouldExpandExtra
    };
};



export default function LedgerPage() {
    const { session } = useSession();
    const isSuperAdmin = session?.role === 'SUPER_ADMIN';
    const isAdmin = session?.role === 'ADMIN';
    const [loading, setLoading] = useState(false);
    const [fetchingDetails, setFetchingDetails] = useState(false);
    const [defaultPrice, setDefaultPrice] = useState('35');
    const [dateSpecificPrices, setDateSpecificPrices] = useState<Record<string, string>>(() => {
        if (typeof window !== 'undefined') {
            const cached = localStorage.getItem('dadwork_date_specific_prices');
            if (cached) { try { return JSON.parse(cached); } catch(e) {} }
        }
        return {};
    });
    const [isRestored, setIsRestored] = useState(false);
    const LOCAL_STORAGE_KEY = 'dadwork_ledger_draft';
    const SESSION_KEY = 'dadwork_ledger_session_active';

    // Data state
    const { data: rawCustomers, isLoading: fetchingCustomers, mutate: mutateCustomers } = useSWR<{ id: string, name: string, customer_code: string, unprocessed_books_count?: number, total_books_count?: number, is_target_days_done?: boolean }[]>('/api/customers?mode=ledger', fetcher, {
        revalidateOnFocus: false,     // ⚡ don't re-fetch on every tab-switch
        dedupingInterval: 60000,      // ⚡ 1 req per min max
        keepPreviousData: true,
        revalidateIfStale: false      // ⚡ CRITICAL: Do NOT re-fetch on page navigation if cache exists
    });
    const allCustomers = (rawCustomers || []).filter((c: any) => !c.is_inactive && !c.is_unassignable);
    
    // Form state
    const [selectedCustomerId, setSelectedCustomerId] = useState('');
    
    const ledgerUrl = selectedCustomerId ? `/api/ledger?customerId=${selectedCustomerId}&limit=1000` : null;
    const { data: ledgerData, isLoading: fetchingLedger, mutate: mutateLedger } = useSWR(ledgerUrl, fetcher, {
        revalidateOnFocus: false,     // ⚡ don't re-fetch on every tab-switch
        dedupingInterval: 30000,      // ⚡ 1 req per 30s — was 2s (saves ~93% of calls)
        keepPreviousData: true,
        revalidateIfStale: false,
        revalidateOnReconnect: false
    });
    
    const history: Transaction[] = (ledgerData?.transactions || []).map((t: any) => ({
        ...t,
        amount: Number(t.amount || 0),
        kg: t.kg != null ? Number(t.kg) : undefined,
        price_per_kg: t.price_per_kg != null ? Number(t.price_per_kg) : undefined,
        previous_debt: Number(t.previous_debt || 0),
        new_debt: Number(t.new_debt || 0)
    }));
    const summary: CustomerSummary = ledgerData?.summary ? {
        totalKg: Number(ledgerData.summary.totalKg || 0),
        totalPaid: Number(ledgerData.summary.totalPaid || 0),
        currentBalance: Number(ledgerData.summary.currentBalance || 0)
    } : { totalKg: 0, totalPaid: 0, currentBalance: 0 };

    // SWR fetch for customer daily entries to cache the results
    const [startDate, setStartDate] = useState<string>('');
    const dailyEntriesUrl = selectedCustomerId ? `/api/customer-daily-entries?customerId=${selectedCustomerId}${startDate ? `&startDate=${startDate}` : ''}` : null;
    const { data: dailyEntriesRaw, isLoading: fetchingDaily, mutate: mutateDailyEntries } = useSWR(dailyEntriesUrl, dailyEntriesFetcher, {
        revalidateOnFocus: false,     // ⚡ don't re-fetch on every tab-switch
        dedupingInterval: 30000,      // ⚡ 1 req per 30s — was 2s (saves ~93% of calls)
        keepPreviousData: true,
        revalidateIfStale: false,
        revalidateOnReconnect: false
    });

    const [currentUser, setCurrentUser] = useState<any>(null);
    const [showLastMaqal, setShowLastMaqal] = useState(false);
    const [updateLastMaqal, setUpdateLastMaqal] = useState(false);
    const [isVoiding, setIsVoiding] = useState(false);
    // Holds the actual post-save balance returned by the API so the new maqal
    // reesto preview is correct before SWR re-fetches the ledger.
    const [freshBalance, setFreshBalance] = useState<number | null>(null);
    // Once the user saves payments on the old maqal, hide the toggle button so
    // the new maqal form stays clean and uninterrupted.
    const [oldMaqalDone, setOldMaqalDone] = useState(false);
    
    // Custom select state
    const [customerSearch, setCustomerSearch] = useState('');
    const deferredCustomerSearch = useDeferredValue(customerSearch);
    const [customerPopoverOpen, setCustomerPopoverOpen] = useState(false);
    const [showUnprocessedOnly, setShowUnprocessedOnly] = useState(false);
    const [showPriorityOnly, setShowPriorityOnly] = useState(false);
    const [lastSavedCustomerId, setLastSavedCustomerId] = useState('');

    // Persist processed customer IDs in localStorage so the blue checkmark
    // appears INSTANTLY and PERMANENTLY — even after page refresh.
    const DONE_CUSTOMERS_KEY = 'dadwork_done_customer_ids';
    const [doneCustomerIds, setDoneCustomerIds] = useState<Set<string>>(() => {
        if (typeof window !== 'undefined') {
            try {
                const saved = localStorage.getItem(DONE_CUSTOMERS_KEY);
                if (saved) return new Set<string>(JSON.parse(saved));
            } catch (e) {}
        }
        return new Set<string>();
    });

    // ── Admin priority stars (personal per-admin, DB-backed) ──
    const { data: priorityData, mutate: mutatePriority } = useSWR(
        '/api/customer-priority',
        fetcher,
        { revalidateOnFocus: false, dedupingInterval: 120000 } // ⚡ 2min cache — priority rarely changes
    );
    const priorityIds: Set<string> = useMemo(() =>
        new Set<string>((priorityData?.priorityIds || currentUser?.assigned_customer_ids || []) as string[]),
        [priorityData, currentUser]
    );

    const toggleStar = async (e: React.MouseEvent, customerId: string) => {
        e.stopPropagation();
        // Optimistic update
        const wasStarred = priorityIds.has(customerId);
        mutatePriority(
            { priorityIds: wasStarred
                ? (priorityData?.priorityIds || []).filter((id: string) => id !== customerId)
                : [...(priorityData?.priorityIds || []), customerId] },
            false
        );
        try {
            await fetch('/api/customer-priority', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ customerId }),
            });
        } catch (e) {
            mutatePriority(); // revert on error
        }
    };

    const markCustomerDone = (customerId: string) => {
        setDoneCustomerIds(prev => {
            const next = new Set(prev);
            next.add(customerId);
            try { localStorage.setItem(DONE_CUSTOMERS_KEY, JSON.stringify(Array.from(next))); } catch (e) {}
            return next;
        });
    };

    const unprocessedCustomersCount = useMemo(() => {
        return allCustomers.filter(c => !c.is_target_days_done && (c.unprocessed_books_count || c.total_books_count)).length;
    }, [allCustomers]);

        const [dateSpecificOverrides, setDateSpecificOverrides] = useState<Record<string, Record<string, string>>>(() => {
        if (typeof window !== 'undefined') {
            const cached = localStorage.getItem('dadwork_date_specific_overrides');
            if (cached) { try { return JSON.parse(cached); } catch(e) {} }
        }
        return {};
    });

    // Form state (continued)
    const [customerDailyDates, setCustomerDailyDates] = useState<DailyBookRecord[]>([]);
    const [dateEntries, setDateEntries] = useState<DateEntry[]>([]);
    const [paymentEntries, setPaymentEntries] = useState<PaymentEntry[]>([{ id: Date.now().toString(), date: '', amount: '' }]);
    const [adjustmentAmount, setAdjustmentAmount] = useState('');
    const [adjustmentNote, setAdjustmentNote] = useState('');
    const [expandedExtraEntryIds, setExpandedExtraEntryIds] = useState<Set<string>>(new Set());
    const [expandedPaymentIds, setExpandedPaymentIds] = useState<Set<string>>(new Set());
    const [allUnprocessedDates, setAllUnprocessedDates] = useState<string[]>([]);
    const [currentMaqalId, setCurrentMaqalId] = useState<number | null>(null);

    useEffect(() => {
        const loadSettings = async () => {
            try {
                const res = await fetch(`/api/settings?_t=${Date.now()}`, { cache: 'no-store' });
                const data = await res.json();
                if (data && data.dadwork_price_per_kg) {
                    setDefaultPrice(data.dadwork_price_per_kg);
                } else {
                    const savedPrice = localStorage.getItem('dadwork_price_per_kg');
                    if (savedPrice) setDefaultPrice(savedPrice);
                }
                if (data && data.dadwork_date_specific_prices) {
                    try {
                        const parsed = JSON.parse(data.dadwork_date_specific_prices);
                        setDateSpecificPrices(parsed);
                    } catch(e) {}
                }
                if (data && data.dadwork_date_specific_overrides) {
                    try {
                        const parsed = typeof data.dadwork_date_specific_overrides === 'string' 
                            ? JSON.parse(data.dadwork_date_specific_overrides) 
                            : data.dadwork_date_specific_overrides;
                        setDateSpecificOverrides(parsed);
                        localStorage.setItem('dadwork_date_specific_overrides', JSON.stringify(parsed));
                    } catch(e) {}
                }
            } catch (e) {
                const savedPrice = localStorage.getItem('dadwork_price_per_kg');
                if (savedPrice) setDefaultPrice(savedPrice);
            }
        };
        loadSettings();

        const storedUser = localStorage.getItem('currentUser');
        if (storedUser) {
            setCurrentUser(JSON.parse(storedUser));
        }

        // sessionStorage disappears when browser/tab closes but survives navigation.
        // If there's NO session flag, this is a fresh open → clear old draft.
        // If session flag exists, user is just navigating back → restore draft.
        const isExistingSession = sessionStorage.getItem(SESSION_KEY);

        if (!isExistingSession) {
            // Fresh browser open or refresh → clear old data, mark session as active
            localStorage.removeItem(LOCAL_STORAGE_KEY);
            sessionStorage.setItem(SESSION_KEY, 'true');
        } else {
            // Navigating back from another page → restore draft
            const draft = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (draft) {
                try {
                    const parsed = JSON.parse(draft);
                    if (parsed.selectedCustomerId) setSelectedCustomerId(parsed.selectedCustomerId);
                    if (parsed.dateEntries && parsed.dateEntries.length > 0) {
                        console.log('[DEBUG-TRACE] localStorage Restoring dateEntries:', parsed.dateEntries);
                        setDateEntries(parsed.dateEntries);
                        const expandedIds = new Set<string>();
                        parsed.dateEntries.forEach((entry: DateEntry) => {
                            if (entry.extraKg && parseFloat(entry.extraKg) > 0) {
                                expandedIds.add(entry.id);
                            }
                        });
                        setExpandedExtraEntryIds(expandedIds);
                    }
                    if (parsed.paymentEntries && parsed.paymentEntries.length > 0) setPaymentEntries(parsed.paymentEntries);
                } catch (e) {
                    console.error('Failed to parse draft', e);
                }
            }
        }
        setIsRestored(true);

        const handleStorage = (e: StorageEvent) => {
            if (e.key === 'dadwork_customers_stale' || e.key === 'dadwork_ledger_stale') {
                mutateCustomers(undefined, { revalidate: true });
                mutateDailyEntries();
                mutateLedger();
            }
        };

        const checkStale = () => {
            const staleSignal = localStorage.getItem('dadwork_ledger_stale');
            const lastCheck = sessionStorage.getItem('ledger_last_check');
            if (staleSignal && staleSignal !== lastCheck) {
                sessionStorage.setItem('ledger_last_check', staleSignal);
                mutateCustomers(undefined, { revalidate: true });
                mutateDailyEntries();
                mutateLedger();
            }
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                checkStale();
            }
        };

        window.addEventListener('storage', handleStorage);
        window.addEventListener('focus', checkStale);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        
        // Initial check in case it mounted after signal
        checkStale();

        return () => {
            window.removeEventListener('storage', handleStorage);
            window.removeEventListener('focus', checkStale);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
        // Customer fetching is now handled seamlessly by SWR!
    }, [mutateCustomers, mutateDailyEntries, mutateLedger]);

    // Ensure new customers without history don't get stuck in 'Read Last Maqal' mode
    useEffect(() => {
        if (ledgerData && (!history || history.length === 0)) {
            setShowLastMaqal(false);
        }
    }, [ledgerData, history]);

    // Save draft to localStorage on every change (survives navigation)
    useEffect(() => {
        if (!isRestored) return;
        const draft = { selectedCustomerId, dateEntries, paymentEntries };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(draft));
    }, [selectedCustomerId, dateEntries, paymentEntries, isRestored]);

    // On browser close or refresh → clear the session flag so next open starts fresh
    useEffect(() => {
        const handleBeforeUnload = () => {
            localStorage.removeItem(LOCAL_STORAGE_KEY);
            sessionStorage.removeItem(SESSION_KEY);
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, []);


    useEffect(() => {
        if (!dailyEntriesRaw) return;

        setFetchingDetails(true);
        try {
            const { dailyData, allUnprocessedDates, maqalId } = dailyEntriesRaw;
            setAllUnprocessedDates(allUnprocessedDates);
            setCurrentMaqalId(maqalId);
            setCustomerDailyDates(dailyData || []);
            
            setDateEntries(prev => {
                const newExpandedIds = new Set<string>();
                let newEntries;

                // If no dates, or just 1 empty row, initialize sequentially with all unprocessed records
                if (prev.length === 0 || (prev.length === 1 && !prev[0].date)) {
                    if (dailyData && dailyData.length > 0) {
                        newEntries = dailyData.map((d: any, idx: number) => {
                            const entryId = (Date.now() + idx).toString();
                            const { entry, shouldExpandExtra } = buildEntryFromDailyRecord(entryId, d, defaultPrice, dateSpecificPrices, dateSpecificOverrides, selectedCustomerId);
                            if (shouldExpandExtra) {
                                newExpandedIds.add(entryId);
                            }
                            return entry;
                        });
                    } else {
                        newEntries = [{ id: Date.now().toString(), date: '', kg: '0', pricePerKg: defaultPrice, extraKg: '', extraPricePerKg: defaultPrice, extraNote: 'Notebook' }];
                    }
                } else {
                    // Re-sequence existing rows to strictly match unprocessed dates
                    newEntries = prev.map((entry, idx) => {
                        const d = dailyData[idx];
                        if (!d) return { ...entry, date: '' };
                        const { entry: parsedEntry, shouldExpandExtra } = buildEntryFromDailyRecord(entry.id, d, defaultPrice, dateSpecificPrices, dateSpecificOverrides, selectedCustomerId);
                        if (shouldExpandExtra) {
                            newExpandedIds.add(entry.id);
                        }
                        return parsedEntry;
                    }).filter(e => e.date !== '');
                }

                if (newExpandedIds.size > 0) {
                    setTimeout(() => {
                        setExpandedExtraEntryIds(prevExpanded => {
                            const combined = new Set(prevExpanded);
                            newExpandedIds.forEach(id => combined.add(id));
                            return combined;
                        });
                    }, 0);
                }
                console.log('[DEBUG-TRACE] setDateEntries from dailyEntriesRaw (API SWR Data):', newEntries);
                return newEntries;
            });
        } finally {
            setFetchingDetails(false);
        }
    }, [dailyEntriesRaw, defaultPrice, dateSpecificPrices]);

    const handleCustomerChange = (customerId: string) => {
        setSelectedCustomerId(customerId);
        setDateEntries([{ id: Date.now().toString(), date: '', kg: '', pricePerKg: defaultPrice, extraKg: '', extraPricePerKg: defaultPrice, extraNote: 'Notebook' }]);
        setPaymentEntries([{ id: Date.now().toString(), date: '', amount: '' }]);
        setCustomerDailyDates([]);
        setShowLastMaqal(true);
        setUpdateLastMaqal(false);
        setExpandedExtraEntryIds(new Set());
        setStartDate('');
        setAllUnprocessedDates([]);
        setFreshBalance(null);
        setOldMaqalDone(false);

        // (Removed auto-unstar logic that was dropping priority on selection)
    };

    const sortedCustomers = useMemo(() => {
        if (!allCustomers) return [];
        return [...allCustomers].sort((a, b) => {
            // Starred customers always float to the top
            const aStarred = priorityIds.has(a.id) ? 1 : 0;
            const bStarred = priorityIds.has(b.id) ? 1 : 0;
            if (aStarred !== bStarred) return bStarred - aStarred;
            // Within each group, sort by numeric customer code
            const numA = parseInt(a.customer_code.replace(/[^0-9]/g, '')) || 0;
            const numB = parseInt(b.customer_code.replace(/[^0-9]/g, '')) || 0;
            return numA - numB;
        });
    }, [allCustomers, priorityIds]);

    // For regular Admins: only show their own Priority customers.
    // This is driven by the SWR-cached priorityIds which auto-updates when
    // the Super Admin adds/removes customers from an Admin's priority list.
    const adminVisibleCustomers = useMemo(() => {
        if (isSuperAdmin) return sortedCustomers; // Super Admin sees everyone
        if (isAdmin) return sortedCustomers.filter(c => priorityIds.has(c.id)); // Admin sees priority only
        return sortedCustomers;
    }, [isSuperAdmin, isAdmin, sortedCustomers, priorityIds]);

    const lastReceiptGroup = useMemo(() => {
        if (!history || history.length === 0) return null;
        
        // Use the shared, bug-free utility
        const merged = groupTransactionsInfoReceipts(history);
        if (merged.length === 0) return null;

        // The shared utility returns newest-first. We need the newest PRODUCT maqal.
        // It already has displayMaqalId assigned.
        for (let i = 0; i < merged.length; i++) {
            if (merged[i].totalMaqalka > 0 || merged[i].totalAdjustment > 0) {
                return merged[i];
            }
        }
        
        return merged[0];
    }, [history]);

    const timelineOptions = useMemo(() => {
        const options: string[] = [];

        // 1. Processed dates from history
        if (history && history.length > 0) {
            const productDates = history
                .filter(t => t.type === 'PRODUCT' && t.reference_date)
                .map(t => t.reference_date)
                .sort();
            
            // Get up to last 4 processed dates (2 pairs)
            const recentDates = Array.from(new Set(productDates)).slice(-4);
            for (let i = 0; i < recentDates.length; i += 2) {
                const d1 = recentDates[i];
                const d2 = recentDates[i+1];
                if (d1 && d2) {
                    options.push(`☑️ ${format(parseISO(d1), "MMM dd")} & ${format(parseISO(d2), "MMM dd")} (Done)`);
                } else if (d1) {
                    options.push(`☑️ ${format(parseISO(d1), "MMM dd")} (Done)`);
                }
            }
        }

        // 2. Unprocessed dates (from API — always includes waiting pair as last item)
        if (allUnprocessedDates && allUnprocessedDates.length > 0) {
            const totalPairs = Math.ceil(allUnprocessedDates.length / 2);
            for (let i = 0; i < allUnprocessedDates.length; i += 2) {
                const d1 = allUnprocessedDates[i];
                const d2 = allUnprocessedDates[i + 1];
                const pairIndex = i / 2;
                const isWaitingPair = pairIndex === totalPairs - 1; // Last pair is always the waiting/locked pair
                const isCurrentReady = pairIndex === 0 && totalPairs > 1; // First pair, not the only one
                
                let prefix: string;
                let suffix: string;
                if (isWaitingPair) {
                    prefix = '⏳';
                    suffix = '(Waiting)';
                } else if (isCurrentReady) {
                    prefix = '📌';
                    suffix = '(Current)';
                } else {
                    prefix = '❌';
                    suffix = '(Pending)';
                }

                if (d1 && d2) {
                    options.push(`${prefix} ${format(parseISO(d1), "MMM dd")} & ${format(parseISO(d2), "MMM dd")} ${suffix}`);
                } else if (d1) {
                    options.push(`${prefix} ${format(parseISO(d1), "MMM dd")} ${suffix}`);
                }
            }
        } else {
            if (options.length > 0) {
                options.push(`🎉 All Caught Up!`);
            } else {
                options.push(`No data available`);
            }
        }

        return options;
    }, [history, allUnprocessedDates]);

    const addDateEntry = () => {
        const nextIndex = dateEntries.length;
        // Maximum 6 date rows at a time
        if (nextIndex >= 6) {
            toast.error("Maximum 6 date rows allowed at once!");
            return;
        }
        if (nextIndex >= customerDailyDates.length) {
            toast.error("No more unprocessed dates available!");
            return;
        }
        const nextUnprocessed = customerDailyDates[nextIndex];
        const newEntryId = Date.now().toString();
        const { entry, shouldExpandExtra } = buildEntryFromDailyRecord(newEntryId, nextUnprocessed, defaultPrice, dateSpecificPrices, dateSpecificOverrides, selectedCustomerId);
        if (shouldExpandExtra) {
            setExpandedExtraEntryIds(prev => {
                const next = new Set(prev);
                next.add(newEntryId);
                return next;
            });
        }
        setDateEntries([...dateEntries, entry]);
    };

    const updateDateEntry = (id: string, field: keyof DateEntry, value: string) => {
        setDateEntries(entries => entries.map(entry => {
            if (entry.id !== id) return entry;
            
            const newEntry = { ...entry, [field]: value };
            
            if (field === 'date') {
                const dateKey = value;
                if (dateSpecificPrices && dateSpecificPrices[dateKey]) {
                    newEntry.pricePerKg = dateSpecificPrices[dateKey];
                    newEntry.extraPricePerKg = dateSpecificPrices[dateKey];
                } else if (dateSpecificPrices) {
                    newEntry.pricePerKg = defaultPrice;
                    newEntry.extraPricePerKg = defaultPrice;
                }
            }
            
            return newEntry;
        }));
    };

    const updatePaymentEntry = (id: string, field: keyof PaymentEntry, value: string) => {
        setPaymentEntries(entries => entries.map(entry => entry.id === id ? { ...entry, [field]: value } : entry));
    };

    const removeDateEntry = (id: string) => {
        setDateEntries(entries => {
            const filtered = entries.filter(entry => entry.id !== id);
            const nextExpandedIds = new Set<string>();
            const mapped = filtered.map((entry, idx) => {
                const d = customerDailyDates[idx];
                if (!d) return { ...entry, date: '' };
                const { entry: parsedEntry, shouldExpandExtra } = buildEntryFromDailyRecord(entry.id, d, defaultPrice, dateSpecificPrices, dateSpecificOverrides, selectedCustomerId);
                if (shouldExpandExtra) {
                    nextExpandedIds.add(entry.id);
                }
                return parsedEntry;
            });
            setExpandedExtraEntryIds(nextExpandedIds);
            return mapped;
        });
    };

    const productGrandTotal = useMemo(() => {
        const total = dateEntries.reduce((sum, p) => {
            const kg = parseFloat(p.kg) || 0;
            const price = parseFloat(p.pricePerKg) || 0;
            const pExtra = parseFloat(p.extraKg || '0') * parseFloat(p.extraPricePerKg || '0');
            const pMain = kg * price;
            return sum + Math.round(pMain + pExtra);
        }, 0);
        console.log('[DEBUG-TRACE] Render productGrandTotal:', total, 'from dateEntries:', dateEntries);
        return total;
    }, [dateEntries]);

    const activePaymentAmount = paymentEntries.reduce((sum, pay) => {
        const lowerNote = (pay.note || '').toLowerCase();
        if (lowerNote.includes('heyn') || lowerNote.includes('cafis')) return sum;
        const amount = parseFloat(pay.amount);
        return sum + (isNaN(amount) ? 0 : amount);
    }, 0);

    const activeAdjustmentsAmount = paymentEntries.reduce((sum, pay) => {
        const lowerNote = (pay.note || '').toLowerCase();
        if (lowerNote.includes('heyn') || lowerNote.includes('cafis')) {
            const amount = parseFloat(pay.amount);
            return sum + (isNaN(amount) ? 0 : amount);
        }
        return sum;
    }, 0);

    // Use freshBalance (post-save API response) when available so the new maqal
    // reesto is correct before SWR finishes re-fetching the ledger.
    const effectiveBalance = freshBalance !== null ? freshBalance : summary.currentBalance;
    const currentReesto = effectiveBalance === 0 ? (parseFloat(adjustmentAmount) || 0) : effectiveBalance;
    const subtotal = productGrandTotal - activeAdjustmentsAmount + currentReesto;
    const finalLacagtaGuud = subtotal - activePaymentAmount;

    const activeDatesForHeader = dateEntries
        .filter(e => e.date && (parseFloat(e.kg) >= 0 || parseFloat(e.extraKg || '0') > 0))
        .map(e => format(new Date(e.date), 'dd MMM'));

    const dynamicMaqalLabel = 'Maqalka';

    const handleSubmit = async (e: React.FormEvent) => {
        if (e) e.preventDefault();

        if (!selectedCustomerId) {
            toast.error('Please select a customer');
            return;
        }

        // Regular admins can only save transactions for their priority customers
        if (isAdmin && !priorityIds.has(selectedCustomerId)) {
            toast.error('Access Denied: You can only save transactions for your Priority customers.');
            return;
        }

        // When reading last maqal (no editing), only payments are allowed.
        // BUT: if the last maqal is already fully paid (closingBalance <= 0), 
        // skip read-only mode so user can save new Reesto for the current pair.
        const lastMaqalHasDebt = lastReceiptGroup && lastReceiptGroup.closingBalance > 0;
        const isReadOnlyMode = showLastMaqal && !updateLastMaqal && !!lastMaqalHasDebt;

        const validEntries = isReadOnlyMode ? [] : dateEntries.filter(e => 
            e.date && e.isReady !== false && (
                (parseFloat(e.kg) >= 0 && parseFloat(e.pricePerKg) > 0) || 
                (parseFloat(e.extraKg || '0') > 0 && parseFloat(e.extraPricePerKg || '0') > 0)
            )
        );
        const validPayments = paymentEntries.filter(p => {
            return parseFloat(p.amount) > 0;
        });

        const hasAdjustment = !isReadOnlyMode && effectiveBalance === 0 && parseFloat(adjustmentAmount) > 0;

        if (validEntries.length === 0 && validPayments.length === 0 && !hasAdjustment) {
            toast.error(isReadOnlyMode ? 'Add a payment amount first' : 'No valid data to save');
            return;
        }

        setLoading(true);
        const isEditingOldMaqal = showLastMaqal && (isReadOnlyMode || updateLastMaqal);

        const receiptId = (isEditingOldMaqal && lastReceiptGroup?.receiptId)
            ? lastReceiptGroup.receiptId
            : crypto.randomUUID();

        // If editing/paying the last maqal, USE ITS MAQAL ID. Otherwise use the current unprocessed one.
        const targetMaqalId = (isEditingOldMaqal && lastReceiptGroup?.maqalId != null) 
            ? lastReceiptGroup.maqalId 
            : currentMaqalId;

        // 1. Gather all items for the batch
        const items = [];

        // Initial setup if first time (only in normal mode)
        if (hasAdjustment) {
            items.push({
                type: 'ADJUSTMENT',
                date: format(new Date(), 'yyyy-MM-dd'),
                amount: adjustmentAmount,
                note: "Reesto"
            });
        }

        // Product entries (skipped in read-only mode)
        if (!isReadOnlyMode) {
            for (const entry of validEntries) {
                if (parseFloat(entry.kg) >= 0 && parseFloat(entry.pricePerKg) > 0) {
                    items.push({
                        type: 'PRODUCT',
                        date: entry.date,
                        kg: entry.kg,
                        price: entry.pricePerKg,
                        note: entry.mainNote
                    });
                }
                if (entry.extraKg && parseFloat(entry.extraKg) > 0 && entry.extraPricePerKg && parseFloat(entry.extraPricePerKg) > 0) {
                    items.push({
                        type: 'PRODUCT',
                        date: entry.date,
                        kg: entry.extraKg,
                        price: entry.extraPricePerKg,
                        note: entry.extraNote || "Notebook"
                    });
                }
            }
        }

        // Payment and Adjustment entries
        for (const pay of validPayments) {
            const lowerNote = (pay.note || '').toLowerCase();
            const isAdjustment = lowerNote.includes('heyn') || lowerNote.includes('cafis');
            
            if (isAdjustment) {
                items.push({
                    type: 'ADJUSTMENT',
                    date: pay.date,
                    amount: -parseFloat(pay.amount),
                    note: pay.note
                });
            } else {
                items.push({
                    type: 'PAYMENT',
                    date: pay.date,
                    amount: pay.amount,
                    note: pay.note || "Lacagta"
                });
            }
        }

        try {
            // 2. Single ATOMIC Post
            const res = await fetch('/api/ledger', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-session-token': localStorage.getItem('dadwork_session_token') || ''
                },
                body: JSON.stringify({
                    customerId: selectedCustomerId,
                    receipt_id: receiptId,
                    maqal_id: targetMaqalId,
                    items: items
                })
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Failed to save receipt');
            }

            // We are using Optimistic UI via SWR now.
            toast.success('Receipt saved successfully!');
            
            // Set blink effect
            setFetchingDetails(true);

            // Always set the post-save balance so the reesto is correct instantly
            if (data.finalDebt !== undefined) {
                setFreshBalance(data.finalDebt);
            }

            // 4. Refresh data instantly using Optimistic UI (Zero Bandwidth!)
            localStorage.setItem('dadwork_customers_stale', Date.now().toString());
            
            // Update the ledger transactions optimistically or defer re-fetch (Zero Bandwidth!)
            mutateLedger((current: any) => current, { revalidate: false });
            
            // Optimistically update the customer sidebar to show they are processed
            mutateCustomers((current: any) => {
                if (!current) return current;
                return current.map((c: any) => 
                    c.id === selectedCustomerId 
                        ? { ...c, is_target_days_done: data.customerStatus?.is_target_days_done ?? true, unprocessed_books_count: data.customerStatus?.unprocessed_books_count ?? 0 } 
                        : c
                );
            }, { revalidate: false }); // DO NOT hit the server!
            
            setDateEntries([{ id: Date.now().toString(), date: '', kg: '', pricePerKg: defaultPrice, extraKg: '', extraPricePerKg: defaultPrice, extraNote: 'Notebook' }]);
            setPaymentEntries([{ id: (Date.now() + 1).toString(), date: '', amount: '' }]);
            setAdjustmentAmount('');
            
            // Workflow Auto-Transition:
            if (isReadOnlyMode) {
                setShowLastMaqal(false);
                setUpdateLastMaqal(false);
                setOldMaqalDone(true);
                setFetchingDetails(false); // End blink effect

                // Fetch new dates for the SAME customer since we just paid the old maqal
                mutateDailyEntries();
                
                // SWR might ignore the fetch if the new pairs are identical to the cached ones (which is true when just adding a payment).
                // So we manually repopulate the screen with the existing next pair instantly to avoid a blank screen!
                if (dailyEntriesRaw && dailyEntriesRaw.dailyData) {
                    const newExpandedIds = new Set<string>();
                    const newEntries = dailyEntriesRaw.dailyData.map((d: any, idx: number) => {
                        const entryId = (Date.now() + idx).toString();
                        const { entry, shouldExpandExtra } = buildEntryFromDailyRecord(entryId, d, defaultPrice, dateSpecificPrices, dateSpecificOverrides, selectedCustomerId);
                        if (shouldExpandExtra) newExpandedIds.add(entryId);
                        return entry;
                    });
                    setDateEntries(newEntries);
                    setExpandedExtraEntryIds(newExpandedIds);
                } else {
                    setDateEntries([{ id: Date.now().toString(), date: '', kg: '', pricePerKg: defaultPrice, extraKg: '', extraPricePerKg: defaultPrice, extraNote: 'Notebook' }]);
                }
            } else {
                // Normal save completed.
                // Check if this was an all-absent (0 KG) pair — if so, auto-skip through remaining absent pairs
                // and land on the first real pair instead of jumping to the next customer.
                const allAbsent = validEntries.length === 0 || validEntries.every(e => parseFloat(e.kg || '0') <= 0 && parseFloat(e.extraKg || '0') <= 0);

                if (allAbsent) {
                    // Stay on same customer, just fetch the next pair
                    const url = new URL(`/api/customer-daily-entries`, window.location.origin);
                    url.searchParams.set('customerId', selectedCustomerId);

                    const res2 = await fetch(url.toString());
                    const allDatesHeader2 = res2.headers.get('x-all-unprocessed-dates');
                    const nextPair: any[] = await res2.json();
                    
                    if (allDatesHeader2) {
                        try { setAllUnprocessedDates(JSON.parse(allDatesHeader2)); } catch(e) {}
                    }

                    if (!nextPair || nextPair.length === 0) {
                        // No more pairs — all done for this customer
                        setCustomerDailyDates([]);
                        setDateEntries([{ id: Date.now().toString(), date: '', kg: '', pricePerKg: defaultPrice, extraKg: '', extraPricePerKg: defaultPrice, extraNote: 'Notebook' }]);
                    } else {
                        const newExpandedIds = new Set<string>();
                        const newEntries = nextPair.map((d: any, idx: number) => {
                            const entryId = (Date.now() + idx).toString();
                            const { entry, shouldExpandExtra } = buildEntryFromDailyRecord(entryId, d, defaultPrice, dateSpecificPrices, dateSpecificOverrides, selectedCustomerId);
                            if (shouldExpandExtra) newExpandedIds.add(entryId);
                            return entry;
                        });
                        
                        setDateEntries(newEntries);
                        setExpandedExtraEntryIds(newExpandedIds);
                        setCustomerDailyDates(nextPair);
                        
                        // Set maqal ID based on header
                        const maqalIdHeader2 = res2.headers.get('x-maqal-id');
                        if (maqalIdHeader2) {
                            setCurrentMaqalId(parseInt(maqalIdHeader2, 10));
                        }
                    }

                    
                    const resData = data;
                    
                    setFetchingDetails(false);
                    // Persist done state in localStorage — shows checkmark instantly on next open
                    markCustomerDone(selectedCustomerId);
                    // Optimistic update in SWR cache, without fetching from server again
                    mutateCustomers(
                        (prev: any) => prev ? prev.map((c: any) =>
                            c.id === selectedCustomerId ? { ...c, is_target_days_done: resData.customerStatus?.is_target_days_done ?? true, unprocessed_books_count: resData.customerStatus?.unprocessed_books_count ?? 0 } : c
                        ) : prev,
                        { revalidate: false }
                    );
                } else {
                    // Normal non-absent save → trigger a short delay, then hard refresh
                    // This creates the permanent blue checkmark exactly as requested
                    setTimeout(() => {
                        window.location.reload();
                    }, 1500); // Wait 1.5s so they can see the "Receipt saved successfully!" toast
                    return;
                }
            }
        } catch (err: any) {
            toast.error(err.message || 'Failed to save receipt');
        } finally {
            setLoading(false);
        }
    };

    const handleVoidReceipt = async () => {
        if (!lastReceiptGroup?.receiptId) return;
        if (!confirm('Are you sure you want to void this receipt? This will add reverse adjustments to reset the debt.')) return;
        
        setIsVoiding(true);
        try {
            const res = await fetch('/api/ledger/void', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-session-token': localStorage.getItem('dadwork_session_token') || ''
                },
                body: JSON.stringify({ receipt_id: lastReceiptGroup.receiptId })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            
            setFreshBalance(null);
            localStorage.setItem('dadwork_customers_stale', Date.now().toString());
            mutateLedger((current: any) => current, { revalidate: true });
            mutateCustomers((current: any) => current, { revalidate: true });
            toast.success('Receipt voided successfully!');
        } catch (err: any) {
            toast.error(err.message || 'Failed to void receipt');
        } finally {
            setIsVoiding(false);
        }
    };

    return (
        <div className="space-y-8 pb-20">
            {/* Header */}
            <div className="relative px-4 py-3 md:px-5 md:py-4 rounded-2xl bg-card border border-border shadow-sm overflow-hidden mb-2">
                <AnimatedBackground />
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-blue-500/5 pointer-events-none" />
                <h1 className="relative z-10 text-xl md:text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
                    <BookOpen className="w-5 h-5 text-primary shrink-0" />
                    Buuga Maqalka
                </h1>
            </div>

            <div className="max-w-3xl mx-auto">
                <div className="space-y-6">
                    <Card className="glass-card overflow-hidden">
                        <CardHeader className="bg-gradient-to-r from-muted/50 to-transparent pb-6 border-b border-border">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 rounded-xl bg-primary/20 text-primary">
                                    <Receipt className="w-6 h-6" />
                                </div>
                                <div>
                                    <CardTitle className="text-xl font-bold tracking-tight text-foreground">Transaction Receipt Form</CardTitle>
                                    <CardDescription className="text-muted-foreground">Select customer and process multiple transactions simultaneously</CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-4 md:p-8">
                            <form onSubmit={handleSubmit} className="space-y-10">

                                <div className="flex items-center justify-between">
                                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground/80 flex items-center gap-2">
                                        Select Customer
                                    </Label>
                                    {selectedCustomerId && (
                                        <div className="flex flex-col items-end gap-1.5">
                                            <div className={cn(
                                                "px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-tighter border animate-in fade-in zoom-in duration-300",
                                                effectiveBalance > 0 ? "bg-destructive/10 text-destructive border-destructive/20" : "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                                            )}>
                                                Current Balance: ${Math.abs(Math.round(effectiveBalance)).toLocaleString()}
                                                {effectiveBalance > 0 ? " (OWED)" : " (CREDIT)"}
                                            </div>
                                            {history.length > 0 && !oldMaqalDone && (
                                                <Button type="button" variant="outline" size="sm" onClick={() => {
                                                    const nextShow = !showLastMaqal;
                                                    setShowLastMaqal(nextShow);
                                                    if (!nextShow) {
                                                        setUpdateLastMaqal(false);
                                                    }
                                                }} className="h-6 text-[10px] px-2 rounded font-bold border-primary/20 text-primary hover:bg-primary/5">
                                                    <BookOpen className="w-3 h-3 mr-1" /> {showLastMaqal ? 'Qari Maqalki Hore' : 'Lacag ka jar maqalki hore'}
                                                </Button>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <div className="relative">
                                    <Popover open={customerPopoverOpen} onOpenChange={setCustomerPopoverOpen}>
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant="outline"
                                                role="combobox"
                                                aria-expanded={customerPopoverOpen}
                                                className="w-full h-14 pl-12 pr-20 rounded-xl border border-border/60 bg-background/50 text-foreground font-bold flex justify-between items-center hover:bg-background/80"
                                            >
                                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                                    <User className={`w-5 h-5 ${selectedCustomerId ? 'text-primary' : 'text-muted-foreground'}`} />
                                                </div>
                                                <span className="truncate">
                                                    {selectedCustomerId
                                                        ? (() => {
                                                            const c = allCustomers.find(c => c.id === selectedCustomerId);
                                                            return c ? `${c.name.toUpperCase()} (ID: ${c.customer_code})` : "Select Customer...";
                                                        })()
                                                        : "Select Customer..."}
                                                </span>
                                                <div className="absolute inset-y-0 right-0 pr-3 flex items-center gap-1.5">
                                                    {fetchingDetails ? <Loader2 className="w-4 h-4 animate-spin text-primary" /> : <ChevronDown className="w-4 h-4 opacity-50" />}
                                                </div>
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                                            <div className="p-2 border-b flex items-center gap-2 bg-muted/20">
                                                <Input 
                                                    placeholder="Search by name or ID..." 
                                                    value={customerSearch}
                                                    onChange={(e) => setCustomerSearch(e.target.value)}
                                                    className="h-9 focus-visible:ring-1 flex-1 bg-background"
                                                    autoFocus
                                                />
                                                <Button
                                                    type="button"
                                                    variant={showUnprocessedOnly ? "default" : "outline"}
                                                    onClick={() => setShowUnprocessedOnly(!showUnprocessedOnly)}
                                                    className={cn(
                                                        "h-9 px-2 text-[10px] font-black uppercase tracking-tight gap-1 shrink-0 rounded-xl transition-all border-amber-500/30 text-amber-500 hover:bg-amber-500/10",
                                                        showUnprocessedOnly && "bg-amber-500 text-yellow-950 hover:bg-amber-600 shadow-[0_0_10px_rgba(245,158,11,0.3)] animate-pulse"
                                                    )}
                                                >
                                                    ⏳ Dhiman ({unprocessedCustomersCount})
                                                </Button>

                                            </div>
                                            <div className="max-h-60 overflow-y-auto p-1">
                                                {(() => {
                                                    const filtered = adminVisibleCustomers.filter((c: any) => {
                                                        const matchesSearch = smartCustomerSearch(c, deferredCustomerSearch);
                                                        if (showUnprocessedOnly) {
                                                            return matchesSearch && !c.is_target_days_done && (c.unprocessed_books_count || c.total_books_count);
                                                        }
                                                        if (showPriorityOnly) {
                                                            return matchesSearch && priorityIds.has(c.id);
                                                        }
                                                        return matchesSearch;
                                                    });

                                                    if (filtered.length === 0) {
                                                        return <div className="p-4 text-center text-sm text-muted-foreground">No customers found.</div>;
                                                    }

                                                    // CRITICAL: renderCustomer MUST be defined before it is called below.
                                                    // Defining it after the isSuperAdmin guard caused a Temporal Dead Zone crash.
                                                    const renderCustomer = (c: any) => (
                                                        <div 
                                                            key={c.id}
                                                            className={cn(
                                                                "relative flex cursor-default select-none items-center rounded-sm px-2 py-2.5 text-sm font-bold outline-none hover:bg-accent hover:text-accent-foreground group",
                                                                selectedCustomerId === c.id ? "bg-primary/10 text-primary" : ""
                                                            )}
                                                            onClick={() => {
                                                                handleCustomerChange(c.id);
                                                                setCustomerPopoverOpen(false);
                                                                setCustomerSearch('');
                                                            }}
                                                        >
                                                            {c.id === lastSavedCustomerId || c.is_target_days_done ? <CheckCircle2 className="w-4 h-4 text-blue-500 fill-blue-500/20 mr-1.5" /> : (c.unprocessed_books_count ? '⚠️ ' : '')}
                                                            {c.name.toUpperCase()} (ID: {c.customer_code})
                                                        </div>
                                                    );

                                                    if (!isSuperAdmin) {
                                                        return (
                                                            <>
                                                                {filtered.map(c => renderCustomer(c))}
                                                            </>
                                                        );
                                                    }

                                                    const starred = filtered.filter((c: any) => priorityIds.has(c.id));
                                                    const unstarred = filtered.filter((c: any) => !priorityIds.has(c.id));

                                                    return (
                                                        <>
                                                            {starred.length > 0 && (
                                                                <>
                                                                    <div className="px-2 py-1.5 text-xs font-black uppercase text-amber-500 bg-amber-500/8 mt-1 mb-1 first:mt-0 flex items-center gap-1">
                                                                        <Star className="w-3 h-3 fill-amber-500" /> Priority
                                                                    </div>
                                                                    {starred.map(renderCustomer)}
                                                                </>
                                                            )}
                                                            {unstarred.length > 0 && (
                                                                <>
                                                                    {starred.length > 0 && <div className="px-2 py-1.5 text-xs font-black uppercase text-muted-foreground bg-muted/50 mt-2 mb-1">Other Customers</div>}
                                                                    {unstarred.map(renderCustomer)}
                                                                </>
                                                            )}
                                                        </>
                                                    );
                                                })()}
                                            </div>
                                        </PopoverContent>
                                    </Popover>
                                </div>
                                {selectedCustomerId && (
                                    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">

                                        {/* Section 1: Maqalka — HIDDEN when Read Last Maqal is active (only payments mode) */}
                                        {!(showLastMaqal && !updateLastMaqal) && (
                                        <div id="maqal-form-section" className="space-y-4">
                                            <div className="flex flex-col gap-2 border-b border-border pb-2">
                                                <div className="flex items-center justify-between">
                                                    <Label className="text-sm font-black uppercase tracking-wider text-foreground">
                                                        1. Maqalka <span className="text-muted-foreground text-xs font-normal capitalize ml-2">(Add Kilos)</span>
                                                    </Label>
                                                    {dateEntries.length < 2 && (
                                                        <Button
                                                            type="button"
                                                            onClick={addDateEntry}
                                                            variant="secondary"
                                                            size="sm"
                                                            className="rounded-lg font-bold text-xs"
                                                            disabled={fetchingDetails}
                                                        >
                                                            <Plus className="w-4 h-4 mr-1" /> Add Row
                                                        </Button>
                                                    )}
                                                </div>
                                                {(timelineOptions.length > 0) && !updateLastMaqal && (
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <Label className="text-[10px] font-bold uppercase text-muted-foreground">Auto (Oldest First):</Label>
                                                        <select
                                                            value={timelineOptions.find(o => o.includes('📌')) || timelineOptions.find(o => o.includes('⏳')) || timelineOptions[timelineOptions.length - 1]}
                                                            onChange={() => {}}
                                                            className="h-7 text-xs font-bold rounded-md border border-border/60 bg-muted/20 px-2 cursor-pointer focus:ring-1 focus:ring-primary"
                                                        >
                                                            {timelineOptions.map((opt, idx) => (
                                                                <option key={idx} value={opt}>
                                                                    {opt}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="space-y-4">
                                                {dateEntries.map((entry, index) => {
                                                    const isEditable = updateLastMaqal && entry.isReady !== false;
                                                    return (
                                                    <div key={entry.id} className="relative p-3 md:p-4 bg-background shadow-sm border border-border/60 rounded-2xl group transition-all hover:shadow-md">
                                                        <div className="flex flex-col gap-2">
                                                            {/* Date Row + Toggle */}
                                                            <div className="flex items-end gap-2">
                                                                <div className="flex-1 space-y-1.5">
                                                                    <div className="flex items-center">
                                                                        <Label className="text-[10px] md:text-xs uppercase font-black text-muted-foreground tracking-wider ml-1">Date</Label>
                                                                        {entry.isReady === false && <span className="ml-2 text-[9px] uppercase font-black text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded-sm border border-amber-500/20 shadow-sm animate-pulse">⏳ Waiting</span>}
                                                                    </div>
                                                                    <div className="relative">
                                                                        {updateLastMaqal ? (
                                                                            <Input
                                                                                type="date"
                                                                                value={entry.date || ""}
                                                                                onChange={e => updateDateEntry(entry.id, 'date', e.target.value)}
                                                                                readOnly={!isEditable}
                                                                                className={cn("h-11 md:h-12 pl-10 font-bold text-sm md:text-base rounded-xl border border-border/80 bg-background shadow-none", !isEditable && "opacity-70 bg-muted/20 cursor-not-allowed")}
                                                                            />
                                                                        ) : (
                                                                            <select
                                                                                value={entry.date || ""}
                                                                                disabled
                                                                                className={cn(
                                                                                    "w-full h-11 md:h-12 pl-10 pr-8 font-bold text-sm md:text-base rounded-xl border border-border/80 bg-muted/30 appearance-none cursor-not-allowed focus:ring-0",
                                                                                    !entry.date && "text-muted-foreground"
                                                                                )}
                                                                            >
                                                                                {entry.date ? (
                                                                                    <option value={entry.date}>
                                                                                        {(() => {
                                                                                            const mainKg = parseFloat(entry.kg) || 0;
                                                                                            const extraKg = parseFloat(entry.extraKg || '0') || 0;
                                                                                            const dateStr = format(parseISO(entry.date), "MMM dd, yyyy");
                                                                                            if (mainKg === 0 && extraKg === 0) {
                                                                                                return `${dateStr} ❌ Baaqatay`;
                                                                                            }
                                                                                            const parts = [];
                                                                                            if (mainKg > 0) parts.push(`📦 ${mainKg} KG${entry.mainNote === 'VIP' ? ' (VIP)' : ''}`);
                                                                                            if (extraKg > 0) parts.push(`📔 ${extraKg} KG (${entry.extraNote || 'Notebook'})`);
                                                                                            return `${dateStr} - ${parts.join(' + ')}`;
                                                                                        })()}
                                                                                    </option>
                                                                                ) : (
                                                                                    <option value="" disabled>No unprocessed dates</option>
                                                                                )}
                                                                            </select>
                                                                        )}
                                                                        <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 md:w-5 md:h-5 text-primary pointer-events-none opacity-60" />
                                                                    </div>
                                                                </div>

                                                                {/* Main inputs + Extra Toggle inputs */}
                                                            </div>

                                                            {/* Main KG and Price/KG inputs (Always visible) */}
                                                            <div className="grid grid-cols-2 gap-3 mt-2">
                                                                <div className="space-y-1.5">
                                                                    <Label className="text-[10px] uppercase font-black text-muted-foreground tracking-wider ml-1">KG</Label>
                                                                    <div className="relative group/input">
                                                                        <Scale className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/70 group-focus-within/input:text-primary transition-colors" />
                                                                        <Input
                                                                            type="number"
                                                                            step="1"
                                                                            value={entry.kg}
                                                                            readOnly={!isEditable}
                                                                            onChange={e => updateDateEntry(entry.id, 'kg', e.target.value)}
                                                                            inputMode="decimal"
                                                                            className={cn(
                                                                                "h-12 pl-10 text-base font-black border-border/80 rounded-xl text-primary focus:bg-background transition-all shadow-none",
                                                                                isEditable ? "bg-background cursor-text" : "bg-muted/5 cursor-not-allowed opacity-90"
                                                                            )}
                                                                            placeholder="0"
                                                                        />
                                                                    </div>
                                                                </div>
                                                                <div className="space-y-1.5">
                                                                    <Label className="text-[10px] uppercase font-black text-muted-foreground tracking-wider ml-1">Price / KG</Label>
                                                                    <div className="relative group/input">
                                                                        <DollarSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/70 group-focus-within/input:text-primary transition-colors" />
                                                                        <Input
                                                                            type="number"
                                                                            step="1"
                                                                            value={entry.pricePerKg}
                                                                            readOnly={!isEditable}
                                                                            onChange={e => updateDateEntry(entry.id, 'pricePerKg', e.target.value)}
                                                                            inputMode="decimal"
                                                                            className={cn("h-12 pl-10 text-base font-black bg-muted/10 border-border/80 rounded-xl focus:bg-background transition-all shadow-none", !isEditable && "opacity-70 cursor-not-allowed")}
                                                                            placeholder="35"
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Notebook extra entries toggle button & badge */}
                                                            <div className="flex items-center gap-2 mt-2">
                                                                <Button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setExpandedExtraEntryIds(prev => {
                                                                            const next = new Set(prev);
                                                                            if (next.has(entry.id)) next.delete(entry.id);
                                                                            else next.add(entry.id);
                                                                            return next;
                                                                        });
                                                                    }}
                                                                    variant="outline"
                                                                    size="sm"
                                                                    className={cn(
                                                                        "h-8 text-[10px] font-bold rounded-lg border-border/80 bg-muted/5 hover:bg-muted/15 flex items-center gap-1",
                                                                        expandedExtraEntryIds.has(entry.id) && "border-primary/30 text-primary bg-primary/5"
                                                                    )}
                                                                >
                                                                    {expandedExtraEntryIds.has(entry.id) ? (
                                                                        <>
                                                                            <ChevronUp className="w-3.5 h-3.5" />
                                                                            Hide Notebook KG
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <ChevronDown className="w-3.5 h-3.5" />
                                                                            Add Notebook KG
                                                                        </>
                                                                    )}
                                                                </Button>
                                                                {entry.extraKg && entry.extraPricePerKg && !expandedExtraEntryIds.has(entry.id) && (
                                                                    <span className="text-[10px] font-black text-primary bg-primary/10 px-2.5 py-1 rounded-full whitespace-nowrap animate-in fade-in zoom-in-95 duration-200">
                                                                        📔 {entry.extraKg}kg @ ${entry.extraPricePerKg} ({entry.extraNote || 'Notebook'})
                                                                    </span>
                                                                )}
                                                            </div>

                                                            {/* Collapsible Notebook entries inputs */}
                                                            {expandedExtraEntryIds.has(entry.id) && (
                                                                <div className="grid grid-cols-2 gap-3 mt-2 p-3 bg-muted/5 border border-dashed border-border/60 rounded-xl animate-in slide-in-from-top-1 duration-150 w-full">
                                                                    <div className="space-y-1.5">
                                                                        <Label className="text-[10px] uppercase font-black text-muted-foreground tracking-wider ml-1">Notebook KG</Label>
                                                                        <div className="relative group/input">
                                                                            <Scale className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/70 group-focus-within/input:text-primary transition-colors" />
                                                                            <Input
                                                                                type="number"
                                                                                step="1"
                                                                                value={entry.extraKg || ''}
                                                                                readOnly={!isEditable}
                                                                                onChange={e => updateDateEntry(entry.id, 'extraKg', e.target.value)}
                                                                                inputMode="decimal"
                                                                                className={cn("h-12 pl-10 text-base font-black bg-muted/10 border-border/80 rounded-xl text-primary focus:bg-background transition-all shadow-none", !isEditable && "opacity-70 cursor-not-allowed")}
                                                                                placeholder="0"
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                    <div className="space-y-1.5">
                                                                        <Label className="text-[10px] uppercase font-black text-muted-foreground tracking-wider ml-1">Notebook Price / KG</Label>
                                                                        <div className="relative group/input">
                                                                            <DollarSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/70 group-focus-within/input:text-primary transition-colors" />
                                                                            <Input
                                                                                type="number"
                                                                                step="1"
                                                                                value={entry.extraPricePerKg || ''}
                                                                                readOnly={!isEditable}
                                                                                onChange={e => updateDateEntry(entry.id, 'extraPricePerKg', e.target.value)}
                                                                                inputMode="decimal"
                                                                                className={cn("h-12 pl-10 text-base font-black bg-muted/10 border-border/80 rounded-xl focus:bg-background transition-all shadow-none", !isEditable && "opacity-70 cursor-not-allowed")}
                                                                                placeholder="36"
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                    <div className="space-y-1.5 col-span-2">
                                                                        <Label className="text-[10px] uppercase font-black text-muted-foreground tracking-wider ml-1">Note / Name</Label>
                                                                        <div className="relative group/input">
                                                                            <Info className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/70 group-focus-within/input:text-primary transition-colors" />
                                                                            <Input
                                                                                type="text"
                                                                                value={entry.extraNote !== undefined ? entry.extraNote : 'Notebook'}
                                                                                readOnly={!isEditable}
                                                                                onChange={e => updateDateEntry(entry.id, 'extraNote', e.target.value)}
                                                                                className={cn("h-12 pl-10 text-sm font-bold bg-muted/10 border-border/80 rounded-xl focus:bg-background transition-all shadow-none", !isEditable && "opacity-70 cursor-not-allowed")}
                                                                                placeholder="Notebook"
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                        {dateEntries.length > 1 && (
                                                            <button
                                                                type="button"
                                                                onClick={() => removeDateEntry(entry.id)}
                                                                className="absolute -top-2 -right-2 w-6 h-6 bg-destructive text-white rounded-full flex items-center justify-center hover:scale-110 transition-transform shadow-lg"
                                                            >
                                                                <Trash2 className="w-3 h-3" />
                                                            </button>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                            </div>
                                        </div>
                                        )}

                                        {/* 3. LACAGAHA (Payment) Section */}
                                        <div className="space-y-4 pt-4 border-t border-border/50">
                                            <div className="flex items-center justify-between border-b border-border pb-2">
                                                <Label className="text-sm font-black uppercase tracking-wider text-foreground">2. Lacagaha <span className="text-muted-foreground text-xs font-normal capitalize ml-2">(Payments Received)</span></Label>
                                                <Button
                                                    type="button"
                                                    onClick={() => setPaymentEntries([...paymentEntries, { id: Date.now().toString() + Math.random(), date: '', amount: '', note: '' }])}
                                                    variant="secondary"
                                                    size="sm"
                                                    className="rounded-lg font-bold text-xs"
                                                    disabled={fetchingDetails}
                                                >
                                                    <Plus className="w-4 h-4 mr-1" /> Add Row
                                                </Button>
                                            </div>

                                            <div className="space-y-4">
                                                {paymentEntries.map((pay) => (
                                                    <div key={pay.id} className="relative p-4 md:p-5 bg-emerald-500/5 shadow-sm border border-emerald-500/20 rounded-2xl group transition-all hover:shadow-md">
                                                        <div className="grid grid-cols-2 md:grid-cols-2 gap-3 md:gap-6 items-center">
                                                            <div className="space-y-1.5 md:space-y-2 col-span-2 md:col-span-1">
                                                                <Label className="text-[10px] md:text-xs uppercase font-black text-emerald-700/70 tracking-wider ml-1">Taariikhada Lacagta</Label>
                                                                <Input
                                                                    type="date"
                                                                    value={pay.date}
                                                                    onChange={e => setPaymentEntries(entries => entries.map(entry => entry.id === pay.id ? { ...entry, date: e.target.value } : entry))}
                                                                    className="h-12 md:h-14 text-sm md:text-base font-bold bg-background border-emerald-500/30 rounded-xl focus:border-emerald-500 shadow-none"
                                                                />
                                                            </div>
                                                            <div className="space-y-1.5 md:space-y-2 col-span-2 md:col-span-1">
                                                                <Label className="text-[10px] md:text-xs uppercase font-black text-emerald-700/70 tracking-wider ml-1">Lacagta la dhiibay</Label>
                                                                <div className="relative">
                                                                    <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-emerald-500" />
                                                                    <Input
                                                                        type="number"
                                                                        value={pay.amount}
                                                                        onChange={e => setPaymentEntries(entries => entries.map(entry => entry.id === pay.id ? { ...entry, amount: e.target.value } : entry))}
                                                                        inputMode="decimal"
                                                                        className="h-12 md:h-14 pl-11 md:pl-12 text-xl md:text-2xl font-black bg-background border-emerald-500/30 rounded-xl text-emerald-600 focus:border-emerald-500 shadow-none"
                                                                        placeholder="0"
                                                                    />
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Expandable Note / Name Input */}
                                                        <div className="mt-3 flex items-center gap-2">
                                                            <Button
                                                                type="button"
                                                                onClick={() => {
                                                                    setExpandedPaymentIds(prev => {
                                                                        const next = new Set(prev);
                                                                        if (next.has(pay.id)) next.delete(pay.id);
                                                                        else next.add(pay.id);
                                                                        return next;
                                                                    });
                                                                }}
                                                                variant="outline"
                                                                size="sm"
                                                                className={cn(
                                                                    "h-8 text-[10px] font-bold rounded-lg border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/15 flex items-center gap-1 text-emerald-700 dark:text-emerald-500",
                                                                    expandedPaymentIds.has(pay.id) && "border-emerald-500/40 bg-emerald-500/10"
                                                                )}
                                                            >
                                                                {expandedPaymentIds.has(pay.id) ? (
                                                                    <>
                                                                        <ChevronUp className="w-3.5 h-3.5" />
                                                                        Hide Name
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <ChevronDown className="w-3.5 h-3.5" />
                                                                        Add Name (Cafis, Heyn)
                                                                    </>
                                                                )}
                                                            </Button>
                                                            {pay.note && !expandedPaymentIds.has(pay.id) && (
                                                                <span className="text-[10px] font-black text-emerald-700 dark:text-emerald-500 bg-emerald-500/10 px-2.5 py-1 rounded-full whitespace-nowrap animate-in fade-in zoom-in-95 duration-200">
                                                                    {pay.note}
                                                                </span>
                                                            )}
                                                        </div>

                                                        {expandedPaymentIds.has(pay.id) && (
                                                            <div className="mt-2 bg-muted/30 p-3 rounded-xl border border-emerald-500/20 animate-in slide-in-from-top-1 duration-150">
                                                                <Label className="text-[10px] uppercase font-black text-emerald-700/70 tracking-wider ml-1">Name / Note</Label>
                                                                <div className="relative group/input">
                                                                    <Info className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500/70 group-focus-within/input:text-emerald-500 transition-colors" />
                                                                    <Input
                                                                        type="text"
                                                                        value={pay.note || ''}
                                                                        onChange={e => setPaymentEntries(entries => entries.map(entry => entry.id === pay.id ? { ...entry, note: e.target.value } : entry))}
                                                                        className="h-11 mt-1 pl-10 text-sm font-bold bg-background border-emerald-500/30 rounded-xl focus:border-emerald-500 shadow-none text-foreground"
                                                                        placeholder="e.g. Cafis, Heyn, or Notebook..."
                                                                    />
                                                                </div>
                                                            </div>
                                                        )}
                                                        {paymentEntries.length > 1 && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setPaymentEntries(entries => entries.filter(entry => entry.id !== pay.id))}
                                                                className="absolute -top-2 -right-2 w-6 h-6 bg-destructive text-white rounded-full flex items-center justify-center hover:scale-110 transition-transform shadow-lg"
                                                            >
                                                                <Trash2 className="w-3 h-3" />
                                                            </button>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* 4. BOOK MATH RECEIPT */}

                                        {/* Header action buttons — shown above receipt when Read Last Maqal is active */}
                                        {showLastMaqal && lastReceiptGroup && (
                                            <div className="flex items-center justify-between px-1 -mb-2">
                                                <div className="flex items-center gap-2">
                                                    {updateLastMaqal ? (
                                                        <span className="bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider border border-amber-500/20 flex items-center gap-1">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                                                            Updating Last Maqal
                                                        </span>
                                                    ) : (
                                                        <span className="bg-primary/10 text-primary text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider border border-primary/20">
                                                            🆕 New Maqal
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="flex gap-1.5">
                                                    {lastReceiptGroup.receiptId && (
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={async () => {
                                                                setFetchingDetails(true);
                                                                try {
                                                                    await mutateLedger();
                                                                    toast.success('Refreshed last maqal!');
                                                                } catch (e) {
                                                                    toast.error('Failed to refresh data');
                                                                } finally {
                                                                    setFetchingDetails(false);
                                                                }
                                                            }}
                                                            className="h-7 text-[9px] px-2 rounded font-bold border border-border/40 text-muted-foreground hover:bg-muted"
                                                        >
                                                            <RefreshCw className="w-3 h-3 mr-1" /> Refresh
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        <div className="relative overflow-hidden mt-4 py-3 rounded-lg bg-[#fdfbf7] dark:bg-[#1e1c18] border border-border/60 font-mono text-xs shadow-inner">
                                            {/* Vertical Notebook Lines (Margin) */}
                                            <div className="absolute left-8 top-0 bottom-0 w-px bg-[#C19A6B]/60 dark:bg-[#C19A6B]/40 z-0"></div>
                                            <div className="absolute left-9 top-0 bottom-0 w-px bg-[#C19A6B]/60 dark:bg-[#C19A6B]/40 z-0"></div>

                                            <div className="relative z-10 pl-12 pr-4 space-y-0 text-slate-800 dark:text-slate-300">
                                                {/* === READ LAST MAQAL MODE: Show full last maqal + new payment preview === */}
                                                {(showLastMaqal && !updateLastMaqal && lastReceiptGroup) ? (
                                                    <>
                                                        {(() => {
                                                            const paymentsInReceipt = lastReceiptGroup.entries.filter((e: any) => e.type === 'PAYMENT').reduce((sum: number, e: any) => sum + Math.abs(e.amount), 0);
                                                            const pct = lastReceiptGroup.totalMaqalka > 0 ? Math.min(100, Math.round((paymentsInReceipt / lastReceiptGroup.totalMaqalka) * 100)) : 100;
                                                            return (
                                                                <div className="flex flex-col items-center justify-center gap-1 mb-3 mt-1">
                                                                    <p className="text-[9px] font-bold text-muted-foreground text-center uppercase tracking-wider flex items-center gap-1.5 justify-center flex-wrap">
                                                                        <span>{lastReceiptGroup.titleString}</span>
                                                                        {lastReceiptGroup.displayMaqalId != null && (
                                                                            <span className="inline-flex items-center gap-0.5 text-[9px] font-black px-1.5 py-0.5 rounded-md bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/40 shrink-0 tracking-wider uppercase animate-mq-pulse shadow-[0_0_8px_rgba(59,130,246,0.25)]">
                                                                                ⚡MQ#{lastReceiptGroup.displayMaqalId}
                                                                            </span>
                                                                        )}
                                                                    </p>
                                                                    {lastReceiptGroup.totalMaqalka > 0 && (
                                                                        <span className={`text-[8px] px-1.5 py-0.5 rounded-sm font-bold tracking-wider ${pct >= 100 ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400' : pct >= 50 ? 'bg-amber-500/20 text-amber-700 dark:text-amber-500' : 'bg-red-500/20 text-red-700 dark:text-red-400'}`}>
                                                                            {pct}% Paid
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            );
                                                        })()}

                                                        {/* Products */}
                                                        {lastReceiptGroup.entries.filter((e: any) => e.type === 'PRODUCT').filter((e: any, idx: number, arr: any[]) => {
                                                            if (Math.round(e.kg || 0) > 0) return true;
                                                            const hasOther = arr.some((other: any) => other.reference_date === e.reference_date && other.id !== e.id && Math.round(other.kg || 0) > 0);
                                                            return !hasOther;
                                                        }).map((e: any, idx: number, arr: any[]) => {
                                                            const hasMain = arr.some((other: any) => other.reference_date === e.reference_date && !other.note && Math.round(other.kg || 0) > 0);
                                                            return (
                                                            <div key={e.id} className={`flex justify-between py-1.5 border-b border-blue-200 dark:border-blue-900/40 font-medium ${Math.round(e.kg || 0) === 0 ? 'opacity-60' : ''}`}>
                                                                <span>
                                                                    {(e.note && hasMain) ? '↳ ' : ''}
                                                                    {format(new Date(e.reference_date), 'MMM dd')} · {Math.round(e.kg || 0) === 0 ? '❌ Baaqatay' : `${Math.round(e.kg || 0)}KG @ $${e.price_per_kg}`}
                                                                    {e.note ? ` (${e.note})` : ''}
                                                                </span>
                                                                <span className="font-bold">{Math.round(e.kg || 0) === 0 ? '$0' : `$${Math.round(e.amount).toLocaleString()}`}</span>
                                                            </div>
                                                        )})}

                                                        {/* Maqalka Total */}
                                                        {lastReceiptGroup.entries.some((e: any) => e.type === 'PRODUCT') && (() => {
                                                            const paymentsInReceipt = lastReceiptGroup.entries.filter((e: any) => e.type === 'PAYMENT').reduce((sum: number, e: any) => sum + Math.abs(e.amount), 0);
                                                            const pct = lastReceiptGroup.totalMaqalka > 0 ? Math.min(100, Math.round((paymentsInReceipt / lastReceiptGroup.totalMaqalka) * 100)) : 100;
                                                            return (
                                                                <div className="flex justify-between py-1.5 border-b border-blue-300 dark:border-blue-800/60 font-bold text-slate-900 dark:text-slate-100">
                                                                    <span className="flex items-center gap-2">
                                                                        Maqalka
                                                                        <span className={`text-[8px] px-1.5 py-0.5 rounded-sm ${pct >= 100 ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400' : pct >= 50 ? 'bg-amber-500/20 text-amber-700 dark:text-amber-500' : 'bg-red-500/20 text-red-700 dark:text-red-400'}`}>
                                                                            {pct}% Paid
                                                                        </span>
                                                                    </span>
                                                                    <span>${Math.round(lastReceiptGroup.totalMaqalka).toLocaleString()}</span>
                                                                </div>
                                                            );
                                                        })()}

                                                        {/* Reesto (Opening Balance) — only show when non-zero */}
                                                            {lastReceiptGroup.openingBalance !== 0 && (
                                                            <div className={`flex justify-between py-1.5 border-b border-blue-200 dark:border-blue-900/40 font-bold px-1 -ml-1 rounded-sm mt-1 ${
                                                                lastReceiptGroup.openingBalance < 0
                                                                    ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/5'
                                                                    : 'text-amber-700 dark:text-amber-500 bg-amber-500/5'
                                                            }`}>
                                                                <span>{lastReceiptGroup.openingBalance < 0 ? 'Heyn' : 'Reesto'}</span>
                                                                <span>{lastReceiptGroup.openingBalance > 0 ? '+' : '-'}${Math.abs(Math.round(lastReceiptGroup.openingBalance)).toLocaleString()}</span>
                                                            </div>
                                                            )}


                                                        {/* Adjustment entries */}
                                                        {lastReceiptGroup.entries.filter((e: any) => e.type === 'ADJUSTMENT').map((e: any) => (
                                                            <div key={e.id} className="flex justify-between py-1.5 border-b border-blue-200 dark:border-blue-900/40 text-amber-700 dark:text-amber-500 font-bold bg-amber-500/5 px-1 -ml-1 rounded-sm mt-1">
                                                                <span>{e.note || (e.amount < 0 ? 'Heyn' : 'Reesto')}</span>
                                                                <span>{e.amount > 0 ? '+' : '-'}${Math.abs(Math.round(e.amount)).toLocaleString()}</span>
                                                            </div>
                                                        ))}


                                                        {/* Lacagta Guud */}
                                                        {(lastReceiptGroup.totalMaqalka > 0 || lastReceiptGroup.totalAdjustment > 0) && (() => {
                                                            const lastTotal = Math.round(lastReceiptGroup.totalMaqalka + lastReceiptGroup.totalAdjustment + lastReceiptGroup.openingBalance);
                                                            return (
                                                                <div className="flex justify-between py-1.5 border-b-2 border-red-300 dark:border-red-900/50 font-black text-slate-900 dark:text-slate-100">
                                                                    <span className={lastTotal < 0 ? 'text-emerald-600 dark:text-emerald-500' : ''}>{lastTotal < 0 ? 'Heyn' : 'Lacagta Guud'}</span>
                                                                    <span className={lastTotal < 0 ? 'text-emerald-600 dark:text-emerald-500' : ''}>${Math.abs(lastTotal).toLocaleString()}</span>
                                                                </div>
                                                            );
                                                        })()}

                                                        {/* Saved payments from last receipt */}
                                                        {lastReceiptGroup.entries.some((e: any) => e.type === 'PAYMENT') && (
                                                            <>
                                                                <p className="text-[9px] font-black uppercase tracking-[0.15em] text-emerald-700/80 dark:text-emerald-500/80 pt-2.5 pb-0.5">Lacagaha</p>
                                                                {lastReceiptGroup.entries.filter((e: any) => e.type === 'PAYMENT').map((e: any) => (
                                                                    <div key={e.id} className="flex justify-between py-1.5 border-b border-blue-200 dark:border-blue-900/40 text-emerald-700 dark:text-emerald-500 font-bold">
                                                                        <span className="flex items-center gap-1.5">
                                                                            {format(new Date(e.reference_date), 'MMM dd')} {e.note && e.note !== 'Lacagta' ? e.note : 'Payment'}
                                                                            {lastReceiptGroup.displayMaqalId != null && (
                                                                                <span className="inline-flex items-center gap-0.5 text-[8px] font-black px-1.5 py-0.5 rounded-md bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30 shrink-0 tracking-wider uppercase animate-mq-pulse shadow-[0_0_5px_rgba(59,130,246,0.2)]">
                                                                                    ⚡MQ#{lastReceiptGroup.displayMaqalId}
                                                                                </span>
                                                                            )}
                                                                        </span>
                                                                        <span>-${Math.round(e.amount).toLocaleString()}</span>
                                                                    </div>
                                                                ))}
                                                            </>
                                                        )}

                                                        {/* Closing balance from last receipt */}
                                                        {lastReceiptGroup.totalPaid > 0 && (
                                                            <div className="flex justify-between items-center pt-2 mt-2 border-t-2 border-double border-amber-400/50 dark:border-amber-600/50 px-1 py-1">
                                                                <span className="font-black text-sm text-[#C19A6B] dark:text-[#D4B087]">{lastReceiptGroup.closingBalance <= 0 ? 'Heyn' : 'Reesto'}</span>
                                                                <span className={`text-lg font-black ${lastReceiptGroup.closingBalance > 0 ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-500'}`}>
                                                                    ${Math.abs(Math.round(lastReceiptGroup.closingBalance)).toLocaleString()}
                                                                </span>
                                                            </div>
                                                        )}

                                                        {/* Divider + new payment preview (if user is adding a payment) */}
                                                        {activePaymentAmount > 0 && (
                                                            <>
                                                                <p className="text-[9px] font-black uppercase tracking-[0.15em] text-primary/60 pt-3 pb-0.5 border-t border-dashed border-primary/20 mt-2">➕ New Payment</p>
                                                                {paymentEntries.filter(p => {
                                                                    const ln = (p.note || '').toLowerCase();
                                                                    return !(ln.includes('heyn') || ln.includes('cafis')) && parseFloat(p.amount) > 0;
                                                                }).map((pay, idx) => (
                                                                    <div key={`pay-${idx}`} className="flex justify-between py-1 border-b border-border/30 text-emerald-600 font-bold">
                                                                        <span className="flex items-center gap-1.5">
                                                                            {format(new Date(pay.date || new Date()), 'MMM dd yyyy')} {pay.note || 'Lacagta'}
                                                                            {lastReceiptGroup?.displayMaqalId != null && (
                                                                                <span className="inline-flex items-center gap-0.5 text-[8px] font-black px-1.5 py-0.5 rounded-md bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30 shrink-0 tracking-wider uppercase animate-mq-pulse">
                                                                                    ⚡MQ#{lastReceiptGroup.displayMaqalId}
                                                                                </span>
                                                                            )}
                                                                        </span>
                                                                        <span>-${Math.round(parseFloat(pay.amount)).toLocaleString()}</span>
                                                                    </div>
                                                                ))}
                                                                <div className="flex flex-col">
                                                                    <div className="flex justify-between items-center pt-2 mt-1 border-t-2 border-double border-amber-400 dark:border-amber-600 px-1 py-1">
                                                                        <span className="font-black text-sm text-[#C19A6B] dark:text-[#D4B087]">{(summary.currentBalance - activePaymentAmount) <= 0 ? 'Heyn' : 'Reesto'}</span>
                                                                        <span className={`text-lg font-black ${(summary.currentBalance - activePaymentAmount) > 0 ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-500'}`}>
                                                                            ${Math.abs(Math.round(summary.currentBalance - activePaymentAmount)).toLocaleString()}
                                                                        </span>
                                                                    </div>
                                                                    <p className={`text-[8px] text-right font-bold uppercase ${(summary.currentBalance - activePaymentAmount) > 0 ? 'text-destructive/60' : 'text-emerald-500/60'}`}>
                                                                        {(summary.currentBalance - activePaymentAmount) <= 0 ? 'Heyn' : 'Reesto'}
                                                                    </p>
                                                                </div>
                                                            </>
                                                        )}
                                                    </>
                                                ) : (
                                                    <>
                                                        {/* === NORMAL MODE: Full receipt with dates/kilos === */}
                                                        {activeDatesForHeader.length > 0 && (
                                                            <p className="text-[9px] font-bold text-muted-foreground text-center mb-3">
                                                                Maqalka Taariikhda {activeDatesForHeader.join(' iyo ')}
                                                            </p>
                                                        )}

                                                        {/* Maqalka breakdown lines */}
                                                        {dateEntries.filter(e => e.date && (
                                                            (parseFloat(e.kg) >= 0 && parseFloat(e.pricePerKg) > 0) ||
                                                            (e.extraKg && parseFloat(e.extraKg) > 0 && e.extraPricePerKg && parseFloat(e.extraPricePerKg) > 0)
                                                        )).map((entry, idx) => {
                                                            const mainKg = parseFloat(entry.kg) || 0;
                                                            const extraKg = parseFloat(entry.extraKg || '0') || 0;
                                                            const showMain = mainKg > 0 || (mainKg === 0 && extraKg === 0);
                                                            const showExtra = extraKg > 0;
                                                            return (
                                                                <div key={`rec-${idx}`} className="space-y-1 py-1 border-b border-border/30 text-muted-foreground">
                                                                    {showMain && (
                                                                        <div className="flex justify-between">
                                                                            <span>{format(new Date(entry.date), 'MMM dd')} · {mainKg === 0 ? '❌ Baaqatay' : `${entry.kg}KG × $${entry.pricePerKg}${entry.mainNote === 'VIP' ? ' (VIP)' : ''}`}</span>
                                                                            <span className="font-bold text-foreground">${Math.round(mainKg * parseFloat(entry.pricePerKg)).toLocaleString()}</span>
                                                                        </div>
                                                                    )}
                                                                    {showExtra && (
                                                                        <div className={cn("flex justify-between text-[10px] text-muted-foreground/80", (showMain && mainKg > 0) ? "pl-3" : "")}>
                                                                            <span>{(showMain && mainKg > 0) ? '↳ ' : ''}{format(new Date(entry.date), 'MMM dd')} · {entry.extraKg}KG × ${entry.extraPricePerKg} ({entry.extraNote || 'Notebook'})</span>
                                                                            <span className="font-bold text-foreground">${Math.round(extraKg * parseFloat(entry.extraPricePerKg || '0')).toLocaleString()}</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}

                                                        {/* Maqalka Total */}
                                                        <div className="flex justify-between py-1.5 border-b border-border/40 font-bold text-foreground">
                                                            <span>{dynamicMaqalLabel}</span>
                                                            <span>${productGrandTotal.toLocaleString()}</span>
                                                        </div>

                                                        {/* Reesto (Carry-over Balance) */}
                                                        {(currentReesto !== 0 || effectiveBalance === 0) && (
                                                            <div className="flex justify-between items-center py-1.5 border-b border-border/40">
                                                                <span className={cn("font-bold", currentReesto < 0 ? "text-emerald-600" : "text-destructive/80")}>{currentReesto < 0 ? 'Heyn' : 'Reesto'}</span>
                                                                {effectiveBalance === 0 ? (
                                                                    <Input
                                                                        type="number"
                                                                        value={adjustmentAmount}
                                                                        onChange={e => setAdjustmentAmount(e.target.value)}
                                                                        inputMode="decimal"
                                                                        placeholder="0"
                                                                        className="h-7 w-20 text-right font-black text-xs border-primary/20 bg-background/50 px-1.5"
                                                                    />
                                                                ) : (
                                                                    <span className={cn("font-black", currentReesto < 0 ? "text-emerald-600" : "text-destructive")}>
                                                                        {currentReesto < 0 ? "-" : "+"}{Math.abs(Math.round(currentReesto)).toLocaleString()}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}

                                                        {/* Active Adjustments in preview */}
                                                        {activeAdjustmentsAmount > 0 && paymentEntries.filter(p => {
                                                            const ln = (p.note || '').toLowerCase();
                                                            return (ln.includes('heyn') || ln.includes('cafis')) && parseFloat(p.amount) > 0;
                                                        }).map((pay, idx) => (
                                                            <div key={`adj-${idx}`} className="flex justify-between items-center py-1.5 border-b border-border/40 font-bold">
                                                                <span className="text-amber-600 dark:text-amber-500">{pay.note}</span>
                                                                <span className="text-amber-600 dark:text-amber-500">-${Math.round(parseFloat(pay.amount)).toLocaleString()}</span>
                                                            </div>
                                                        ))}

                                                        {/* Subtotal */}
                                                        {(productGrandTotal > 0 || effectiveBalance !== 0 || activeAdjustmentsAmount > 0) && (
                                                            <div className="flex justify-between py-1.5 border-b-2 border-border font-black text-foreground">
                                                                <span className={subtotal < 0 ? 'text-emerald-600 dark:text-emerald-500' : ''}>{subtotal < 0 ? 'Heyn' : 'Lacagta Guud'}</span>
                                                                <span className={subtotal < 0 ? 'text-emerald-600 dark:text-emerald-500' : ''}>${Math.abs(Math.round(subtotal)).toLocaleString()}</span>
                                                            </div>
                                                        )}

                                                        {/* Lacagaha (payments) */}
                                                        {activePaymentAmount > 0 && (
                                                            <>
                                                                <p className="text-[9px] font-black uppercase tracking-[0.15em] text-emerald-600/60 pt-1.5">Lacagaha</p>
                                                                {paymentEntries.filter(p => {
                                                                    const ln = (p.note || '').toLowerCase();
                                                                    return !(ln.includes('heyn') || ln.includes('cafis')) && parseFloat(p.amount) > 0;
                                                                }).map((pay, idx) => (
                                                                    <div key={`pay-${idx}`} className="flex justify-between py-1 border-b border-border/30 text-emerald-600 font-bold">
                                                                        <span>{format(new Date(pay.date || new Date()), 'MMM dd yyyy')} {pay.note || 'Lacagta'}</span>
                                                                        <span>-${Math.round(parseFloat(pay.amount)).toLocaleString()}</span>
                                                                    </div>
                                                                ))}
                                                            </>
                                                        )}

                                                        {/* Final Balance - double underline style (Only if payments were made) */}
                                                        {activePaymentAmount > 0 && (
                                                            <div className="flex flex-col">
                                                                <div className="flex justify-between items-center pt-2 mt-1 border-t-2 border-double border-amber-400 dark:border-amber-600 px-1 py-1">
                                                                    <span className="font-black text-sm text-[#C19A6B] dark:text-[#D4B087]">{finalLacagtaGuud <= 0 ? 'Heyn' : 'Reesto'}</span>
                                                                    <span className={`text-lg font-black ${finalLacagtaGuud > 0 ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-500'}`}>
                                                                        ${Math.abs(Math.round(finalLacagtaGuud)).toLocaleString()}
                                                                    </span>
                                                                </div>
                                                                <p className={`text-[8px] text-right font-bold uppercase ${finalLacagtaGuud > 0 ? 'text-destructive/60' : 'text-emerald-500/60'}`}>
                                                                    {finalLacagtaGuud <= 0 ? 'Heyn' : 'Reesto'}
                                                                </p>
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        </div>

                                        {/* Submit — Super Admin or Priority Admin only */}
                                        {isSuperAdmin || (isAdmin && selectedCustomerId && priorityIds.has(selectedCustomerId)) ? (
                                            <Button
                                                type="submit"
                                                disabled={loading}
                                                className="w-full h-10 rounded-lg font-black text-xs uppercase tracking-wider shadow-md"
                                            >
                                                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Receipt'}
                                            </Button>
                                        ) : (
                                            <div className="w-full h-10 rounded-lg border border-border/40 bg-muted/30 flex items-center justify-center text-[11px] font-bold text-muted-foreground uppercase tracking-wider gap-2">
                                                <Lock className="w-3.5 h-3.5" /> View Only — Priority Required
                                            </div>
                                        )}
                                    </div>
                                )}
                            </form>
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* WISER MOBILE: Sticky Bottom Bar */}
            {selectedCustomerId && (
                <div className="fixed bottom-0 left-0 right-0 bg-background/80 backdrop-blur-xl border-t border-border p-4 md:hidden z-50 animate-in slide-in-from-bottom duration-500 shadow-[0_-8px_30px_rgb(0,0,0,0.12)]">
                    <div className="flex items-center gap-4 max-w-lg mx-auto">
                        <div className="flex-1">
                            <p className="text-[10px] font-black uppercase tracking-widest text-[#C19A6B] dark:text-[#D4B087] leading-none mb-1">{activePaymentAmount > 0 ? (finalLacagtaGuud <= 0 ? 'Heyn' : 'Reesto') : 'Lacagta Guud'}</p>
                            <p className={`text-xl font-black leading-none ${finalLacagtaGuud > 0 ? 'text-destructive' : 'text-emerald-500'}`}>
                                ${Math.round(finalLacagtaGuud).toLocaleString()}
                            </p>
                        </div>
                        {isSuperAdmin || (isAdmin && selectedCustomerId && priorityIds.has(selectedCustomerId)) ? (
                            <Button
                                onClick={handleSubmit}
                                disabled={loading}
                                className="h-14 px-8 rounded-xl font-black uppercase tracking-widest text-xs shadow-lg shadow-primary/20"
                            >
                                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Save Receipt'}
                            </Button>
                        ) : (
                            <div className="h-14 px-5 rounded-xl border border-border/30 bg-muted/30 flex items-center justify-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider gap-1.5">
                                <Lock className="w-3.5 h-3.5" /> View Only
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
