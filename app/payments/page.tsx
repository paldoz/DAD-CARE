'use client';

import { useState, useEffect, useMemo } from 'react';
import { format, isToday, isThisMonth, isThisYear, isThisWeek } from 'date-fns';
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

interface Payment {
    id: string;
    customer_id: string;
    amount: number;
    note: string | null;
    created_at: string;
    reference_date: string;
    previous_debt: number;
    new_debt: number;
    customer: { id: string; name: string; customer_code: string } | null;
}

interface PaymentData {
    payments: Payment[];
    todayTotal: number;
    totalAllTime: number;
    count: number;
}

type PeriodFilter = 'today' | 'week' | 'month' | 'year' | 'all';

const PERIOD_OPTIONS: { value: PeriodFilter; label: string }[] = [
    { value: 'all',   label: 'All Time' },
    { value: 'today', label: 'Today' },
    { value: 'week',  label: 'This Week' },
    { value: 'month', label: 'This Month' },
    { value: 'year',  label: 'This Year' },
];

export default function PaymentsPage() {
    const { data: rawCustomers } = useSWR<{ id: string; name: string; customer_code: string }[]>('/api/customers?lite=true', fetcher, {
        revalidateOnFocus: false,
        dedupingInterval: 300000,
        keepPreviousData: true,
        revalidateIfStale: false,
    });
    const customers = rawCustomers || [];
    
    const { data: rawData, isLoading: loading } = useSWR<PaymentData>('/api/payments?limit=200', fetcher, {
        revalidateOnFocus: false,     // ⚡ don't re-fetch on every tab-switch
        dedupingInterval: 60000,      // ⚡ 1 req per min — was 10s (saves ~83% of calls)
        keepPreviousData: true,
        revalidateIfStale: false,
        revalidateOnReconnect: false,
    });
    const data = rawData || { payments: [], todayTotal: 0, totalAllTime: 0, count: 0 };

    const [searchTerm, setSearchTerm] = useState('');
    const [filterCustomerId, setFilterCustomerId] = useState('all');
    const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('all');
    const [filterOpen, setFilterOpen] = useState(false);
    const [visibleCount, setVisibleCount] = useState(10);

    // Reset Load More pagination whenever filters change
    useEffect(() => {
        setVisibleCount(10);
    }, [periodFilter, filterCustomerId, searchTerm]);

    const filteredPayments = useMemo(() => {
        let list = data?.payments || [];
        if (periodFilter === 'today') list = list.filter(p => isToday(new Date(p.reference_date || p.created_at)));
        else if (periodFilter === 'week')  list = list.filter(p => isThisWeek(new Date(p.reference_date || p.created_at)));
        else if (periodFilter === 'month') list = list.filter(p => isThisMonth(new Date(p.reference_date || p.created_at)));
        else if (periodFilter === 'year')  list = list.filter(p => isThisYear(new Date(p.reference_date || p.created_at)));
        if (filterCustomerId !== 'all') list = list.filter(p => p.customer_id === filterCustomerId);
        if (searchTerm) {
            const q = searchTerm.toLowerCase();
            list = list.filter(p =>
                p.customer?.name?.toLowerCase().includes(q) ||
                p.customer?.customer_code?.toLowerCase().includes(q) ||
                p.note?.toLowerCase().includes(q)
            );
        }
        return list;
    }, [data, periodFilter, filterCustomerId, searchTerm]);

    const filteredTotal = useMemo(() =>
        filteredPayments.reduce((s, p) => s + (p.amount || 0), 0), [filteredPayments]);

    const hasActiveFilter = periodFilter !== 'all' || filterCustomerId !== 'all' || !!searchTerm;
    const clearAll = () => { setPeriodFilter('all'); setFilterCustomerId('all'); setSearchTerm(''); };

    const selectedPeriodLabel = PERIOD_OPTIONS.find(o => o.value === periodFilter)?.label || 'All Time';
    const selectedCustomerName = customers.find(c => c.id === filterCustomerId)?.name || '';

    return (
        <div className="space-y-5 md:space-y-6 max-w-3xl mx-auto w-full px-1 md:px-0">

            {/* Header */}
            <div className="relative p-6 md:p-8 rounded-2xl bg-card overflow-hidden border border-border flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-sm">
                <AnimatedBackground />
                <div className="relative z-10 flex-1">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2.5 rounded-xl bg-primary/20 text-primary shadow-inner">
                            <Wallet className="w-6 h-6" />
                        </div>
                        <h2 className="text-2xl md:text-3xl font-black text-foreground tracking-tight uppercase">Lacagaha</h2>
                    </div>
                    <p className="text-muted-foreground text-sm font-medium max-w-md ml-1">
                        Track and manage all customer payments securely.
                    </p>
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
                            ${filteredTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
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
                            ${(data?.totalAllTime || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </p>
                    </CardContent>
                </Card>
                <Card className="glass-card group">
                    <CardContent className="p-3.5 md:p-5">
                        <div className="p-1.5 md:p-2 rounded-lg bg-purple-500/10 w-fit mb-2.5">
                            <TrendingUp className="h-3.5 w-3.5 md:h-4 md:w-4 text-purple-500" />
                        </div>
                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-0.5">Payments</p>
                        <p className="text-base md:text-xl font-black text-foreground tabular-nums">{filteredPayments.length}</p>
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
                        <span className="ml-auto text-[10px] font-black text-muted-foreground">{filteredPayments.length} records</span>
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        </div>
                    ) : filteredPayments.length === 0 ? (
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
                            {filteredPayments.slice(0, visibleCount).map((payment) => (
                                <div key={payment.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-all group">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 rounded-xl bg-emerald-500/10 group-hover:bg-emerald-500/15 transition-colors shrink-0">
                                            <ArrowUpRight className="h-4 w-4 text-emerald-500" />
                                        </div>
                                        <div>
                                            <p className="text-[13px] font-bold text-foreground">{payment.customer?.name || 'Unknown'}</p>
                                            <p className="text-[10px] text-muted-foreground font-medium">
                                                {format(new Date(payment.reference_date || payment.created_at), 'MMM dd, yyyy · h:mm a')}
                                            </p>
                                            {payment.note && (
                                                <p className="text-[10px] text-muted-foreground/70 italic mt-0.5">{payment.note}</p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="text-[13px] font-black text-emerald-500 tabular-nums">
                                            +${payment.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                        </p>
                                        <p className="text-[10px] text-muted-foreground font-medium tabular-nums">
                                            Bal: ${payment.new_debt.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                        </p>
                                    </div>
                                </div>
                            ))}
                            {filteredPayments.length > visibleCount && (
                                <div className="p-4">
                                    <Button 
                                        onClick={() => setVisibleCount(prev => prev + 10)}
                                        variant="secondary" 
                                        className="w-full text-xs font-bold bg-muted/50 hover:bg-muted"
                                    >
                                        Load More ({filteredPayments.length - visibleCount} remaining)
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
