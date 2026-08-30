'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
    DollarSign,
    Calendar,
    Search,
    Loader2,
    ArrowUpRight,
    Wallet,
    TrendingUp,
    Banknote,
    Filter,
    User,
    X,
    ChevronDown,
    ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import useSWR from 'swr';
import { AnimatedBackground } from '@/components/animated-background';

const fetcher = async (url: string) => {
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

interface Payment {
    id: string;
    customer_id: string;
    amount: number;
    note: string | null;
    created_at: string;
    reference_date: string;
    previous_debt: number;
    new_debt: number;
    maqal_id: number | null;
    customer: { id: string; name: string; customer_code: string } | null;
}

interface PaymentData {
    payments: Payment[];
    totalCount: number;
    periodTotal: number;
    totalAllTime: number;
    hasMore: boolean;
    nextOffset: number | null;
    todayTotal?: number;
    count?: number;
}

type PeriodFilter = 'today' | 'week' | 'month' | 'year' | 'all';

const PERIOD_OPTIONS: { value: PeriodFilter; label: string }[] = [
    { value: 'all',   label: 'All Time' },
    { value: 'today', label: 'Today' },
    { value: 'week',  label: 'This Week' },
    { value: 'month', label: 'This Month' },
    { value: 'year',  label: 'This Year' },
];

const PAGE_SIZE = 50;

export default function PaymentsPage() {
    const { data: rawCustomers } = useSWR<{ id: string; name: string; customer_code: string }[]>('/api/customers?lite=true', fetcher, {
        revalidateOnFocus: false,
        dedupingInterval: 300000,
        keepPreviousData: true,
        revalidateIfStale: false,
    });
    const customers = rawCustomers || [];

    const [searchTerm, setSearchTerm] = useState('');
    const [filterCustomerId, setFilterCustomerId] = useState('all');
    const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('all');
    const [filterOpen, setFilterOpen] = useState(false);

    // Accumulated list for infinite/append pagination
    const [payments, setPayments] = useState<Payment[]>([]);
    const [isLoadingMore, setIsLoadingMore] = useState(false);

    // Build URL for initial page
    const apiUrl = useMemo(() => {
        const params = new URLSearchParams();
        params.set('limit', PAGE_SIZE.toString());
        params.set('offset', '0');
        params.set('period', periodFilter);
        if (filterCustomerId !== 'all') {
            params.set('customerId', filterCustomerId);
        }
        if (searchTerm.trim()) {
            params.set('search', searchTerm.trim());
        }
        return `/api/payments?${params.toString()}`;
    }, [periodFilter, filterCustomerId, searchTerm]);

    const { data, isLoading: initialLoading, mutate } = useSWR<PaymentData>(apiUrl, fetcher, {
        revalidateOnFocus: false,
        dedupingInterval: 60000,
        keepPreviousData: false,
        revalidateIfStale: false,
        revalidateOnReconnect: false,
    });

    // Reset accumulated list when first page loads or filters change
    useEffect(() => {
        if (data?.payments) {
            setPayments(data.payments);
        }
    }, [data]);

    const totalCount = data?.totalCount ?? 0;
    const periodTotal = data?.periodTotal ?? 0;
    const totalAllTime = data?.totalAllTime ?? 0;
    const hasMore = payments.length < totalCount;

    const handleLoadMore = useCallback(async () => {
        if (isLoadingMore || !hasMore) return;
        setIsLoadingMore(true);
        try {
            const params = new URLSearchParams();
            params.set('limit', PAGE_SIZE.toString());
            params.set('offset', payments.length.toString());
            params.set('period', periodFilter);
            if (filterCustomerId !== 'all') {
                params.set('customerId', filterCustomerId);
            }
            if (searchTerm.trim()) {
                params.set('search', searchTerm.trim());
            }
            const res = await fetcher(`/api/payments?${params.toString()}`);
            if (res.payments && res.payments.length > 0) {
                setPayments(prev => {
                    const existingIds = new Set(prev.map(p => p.id));
                    const newRows = res.payments.filter((p: Payment) => !existingIds.has(p.id));
                    return [...prev, ...newRows];
                });
            }
        } catch (err) {
            console.error('Failed to load more payments:', err);
        } finally {
            setIsLoadingMore(false);
        }
    }, [isLoadingMore, hasMore, payments.length, periodFilter, filterCustomerId, searchTerm]);

    const hasActiveFilter = periodFilter !== 'all' || filterCustomerId !== 'all' || !!searchTerm;
    const clearAll = () => { setPeriodFilter('all'); setFilterCustomerId('all'); setSearchTerm(''); };

    const selectedPeriodLabel = PERIOD_OPTIONS.find(o => o.value === periodFilter)?.label || 'All Time';
    const selectedCustomerName = customers.find(c => c.id === filterCustomerId)?.name || '';

    return (
        <div className="space-y-5 md:space-y-6 max-w-3xl mx-auto w-full px-1 md:px-0">

            {/* Header */}
            <div className="relative px-4 py-3 md:px-5 md:py-4 rounded-2xl bg-card border border-border shadow-sm overflow-hidden flex items-center justify-between gap-4">
                <AnimatedBackground />
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-blue-500/5 pointer-events-none" />
                <div className="relative z-10">
                    <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
                        <Wallet className="w-5 h-5 text-primary shrink-0" />
                        Lacagaha
                    </h1>
                </div>
            </div>

            {/* Collapsible Filter Bar */}
            <div className="rounded-2xl border border-border/50 overflow-hidden bg-card shadow-sm">
                <button
                    onClick={() => setFilterOpen(v => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors"
                >
                    <div className="flex items-center gap-2.5 flex-wrap">
                        <div className={cn("p-1.5 rounded-lg transition-colors", hasActiveFilter ? "bg-primary/15" : "bg-muted")}>
                            <Filter className={cn("w-3.5 h-3.5", hasActiveFilter ? "text-primary" : "text-muted-foreground")} />
                        </div>
                        <span className="text-[11px] font-black uppercase tracking-widest text-foreground">Filter</span>
                        {periodFilter !== 'all' && (
                            <span className="text-[9px] font-black uppercase tracking-wider bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                                {selectedPeriodLabel}
                            </span>
                        )}
                        {filterCustomerId !== 'all' && (
                            <span className="text-[9px] font-black uppercase tracking-wider bg-blue-500/10 text-blue-500 px-2 py-0.5 rounded-full max-w-[110px] truncate">
                                {selectedCustomerName}
                            </span>
                        )}
                        {searchTerm && (
                            <span className="text-[9px] font-black uppercase tracking-wider bg-orange-500/10 text-orange-500 px-2 py-0.5 rounded-full max-w-[90px] truncate">
                                "{searchTerm}"
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {hasActiveFilter && (
                            <button
                                onClick={e => { e.stopPropagation(); clearAll(); }}
                                className="text-[9px] font-black uppercase tracking-widest text-muted-foreground hover:text-red-500 flex items-center gap-0.5 transition-colors"
                            >
                                <X className="w-3 h-3" /> Clear
                            </button>
                        )}
                        {filterOpen
                            ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                            : <ChevronDown className="w-4 h-4 text-muted-foreground" />
                        }
                    </div>
                </button>

                {filterOpen && (
                    <div className="border-t border-border/50 px-4 py-4 space-y-4 bg-background/50 animate-in fade-in slide-in-from-top-1 duration-200">
                        {/* Period Pills */}
                        <div>
                            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-2">Period</p>
                            <div className="flex flex-wrap gap-2">
                                {PERIOD_OPTIONS.map(opt => (
                                    <button
                                        key={opt.value}
                                        onClick={() => setPeriodFilter(opt.value)}
                                        className={cn(
                                             'px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all',
                                            periodFilter === opt.value
                                                ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                                                : 'bg-background text-muted-foreground border-border/50 hover:border-primary/40 hover:text-foreground'
                                        )}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Customer Select */}
                        <div>
                            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-2">Customer</p>
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                                <select
                                    value={filterCustomerId}
                                    onChange={e => setFilterCustomerId(e.target.value)}
                                    className="h-9 pl-9 pr-4 rounded-xl border border-border/50 bg-background text-xs font-bold focus:ring-2 focus:ring-primary/20 outline-none w-full"
                                >
                                    <option value="all">All Customers</option>
                                    {customers.map(c => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Search */}
                        <div>
                            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-2">Search</p>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                                <Input
                                    placeholder="Name, code or note..."
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                    className="pl-9 h-9 text-xs bg-background border-border/50 rounded-xl"
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Smart Stats */}
            <div className="grid grid-cols-3 gap-2.5 md:gap-4">
                <Card className="glass-card group">
                    <CardContent className="p-3.5 md:p-5">
                        <div className="p-1.5 md:p-2 rounded-lg bg-emerald-500/10 w-fit mb-2.5">
                            <DollarSign className="h-3.5 w-3.5 md:h-4 md:w-4 text-emerald-500" />
                        </div>
                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-0.5 truncate">{selectedPeriodLabel}</p>
                        <p className="text-base md:text-xl font-black text-foreground tabular-nums">
                            ${periodTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </p>
                    </CardContent>
                </Card>
                <Card className="glass-card group">
                    <CardContent className="p-3.5 md:p-5">
                        <div className="p-1.5 md:p-2 rounded-lg bg-blue-500/10 w-fit mb-2.5">
                            <Banknote className="h-3.5 w-3.5 md:h-4 md:w-4 text-blue-500" />
                        </div>
                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-0.5">All Time</p>
                        <p className="text-base md:text-xl font-black text-foreground tabular-nums">
                            ${totalAllTime.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </p>
                    </CardContent>
                </Card>
                <Card className="glass-card group">
                    <CardContent className="p-3.5 md:p-5">
                        <div className="p-1.5 md:p-2 rounded-lg bg-purple-500/10 w-fit mb-2.5">
                            <TrendingUp className="h-3.5 w-3.5 md:h-4 md:w-4 text-purple-500" />
                        </div>
                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-0.5">Payments</p>
                        <p className="text-base md:text-xl font-black text-foreground tabular-nums">{totalCount}</p>
                    </CardContent>
                </Card>
            </div>

            {/* Payment List */}
            <Card className="glass-card overflow-hidden">
                <CardHeader className="border-b border-border/50 pb-3 pt-4 px-4">
                    <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                        <div className="p-1 rounded-md bg-primary/10">
                            <Calendar className="h-3.5 w-3.5 text-primary" />
                        </div>
                        Payment History
                        <span className="ml-auto text-[10px] font-black text-muted-foreground">{totalCount} records</span>
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    {initialLoading && payments.length === 0 ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        </div>
                    ) : payments.length === 0 ? (
                        <div className="text-center py-12">
                            <div className="p-3 rounded-full bg-muted w-fit mx-auto mb-3">
                                <DollarSign className="h-6 w-6 text-muted-foreground/40" />
                            </div>
                            <p className="text-sm font-bold text-muted-foreground">No payments found</p>
                            <p className="text-xs text-muted-foreground/60 mt-1">
                                {hasActiveFilter ? 'Try changing the filters' : 'No payments recorded yet'}
                            </p>
                            {hasActiveFilter && (
                                <Button variant="outline" size="sm" onClick={clearAll} className="mt-4 text-xs font-bold rounded-xl">
                                    Clear Filters
                                </Button>
                            )}
                        </div>
                    ) : (
                        <div className="divide-y divide-border/50">
                            {payments.map((payment) => {
                                const mqLabel = payment.maqal_id ? `MQ#${payment.maqal_id}` : null;
                                return (
                                    <div key={payment.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-all group">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="p-2 rounded-xl bg-emerald-500/10 group-hover:bg-emerald-500/15 transition-colors shrink-0">
                                                <ArrowUpRight className="h-4 w-4 text-emerald-500" />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <p className="text-[13px] font-bold text-foreground truncate">{payment.customer?.name || 'Unknown'}</p>
                                                    {mqLabel && (
                                                        <span className="text-[8px] font-black text-primary bg-primary/10 rounded px-1.5 py-0.5">
                                                            {mqLabel}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-[10px] text-muted-foreground font-medium">
                                                    {format(new Date(payment.created_at || payment.reference_date), 'MMM dd, yyyy · h:mm a')}
                                                </p>
                                                {payment.note && (
                                                    <p className="text-[10px] text-muted-foreground/70 italic mt-0.5 truncate">{payment.note}</p>
                                                )}
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0 ml-3">
                                            <p className="text-[13px] font-black text-emerald-500 tabular-nums">
                                                +${payment.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                            </p>
                                            <p className="text-[10px] text-muted-foreground font-medium tabular-nums">
                                                Bal: ${payment.new_debt.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                            {hasMore && (
                                <div className="p-4">
                                    <Button 
                                        onClick={handleLoadMore}
                                        disabled={isLoadingMore}
                                        variant="secondary" 
                                        className="w-full text-xs font-bold bg-muted/50 hover:bg-muted"
                                    >
                                        {isLoadingMore ? (
                                            <span className="flex items-center gap-2">
                                                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading more...
                                            </span>
                                        ) : (
                                            `Load More (${totalCount - payments.length} remaining)`
                                        )}
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
