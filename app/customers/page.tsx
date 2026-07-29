'use client';

import Link from 'next/link';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useEffect, useState, useMemo } from 'react';
import { AddCustomerDialog } from '@/components/add-customer-dialog';
import { toast } from 'sonner';
import { Phone, Search, ChevronRight, Users, Star, Filter, Check, Loader2, Clock, Globe, CalendarDays, CheckCircle2, RotateCcw, Trash2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
    DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import { Switch } from '@/components/ui/switch';
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

interface Customer {
    id: string;
    name: string;
    customer_code: string;
    gender?: string;
    phone?: string;
    avatar_url?: string;
    is_inactive?: boolean;
    is_kabarka?: boolean;
    is_unassignable?: boolean;
}

export default function CustomersPage() {
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [activeTab, setActiveTab] = useState<'active' | 'inactive'>('active');
    const [currentUser, setCurrentUser] = useState<any | null>(null);
    const [filterType, setFilterType] = useState<string>('default');
    const [rankingMode, setRankingMode] = useState<'maqalka' | 'lacagta'>('maqalka');
    const [selectedMaqalPair, setSelectedMaqalPair] = useState<string>('latest');
    const [showAllTimePct, setShowAllTimePct] = useState<Record<string, boolean>>({});
    const [managingCustomerId, setManagingCustomerId] = useState<string | null>(null);
    const [maqalSearch, setMaqalSearch] = useState('');

    const [reorderOpenForId, setReorderOpenForId] = useState<string | null>(null);
    const [reorderTargetId, setReorderTargetId] = useState<string>('');
    const [isReordering, setIsReordering] = useState(false);

    const { data: maqalPairs } = useSWR<any[]>('/api/maqal-pairs', fetcher, { revalidateOnFocus: false, dedupingInterval: 600000, revalidateIfStale: false });

    // Latest pair = the most recently saved pair in the DailyBook (sorted DESC by date, index 0 = newest)
    const latestPair = maqalPairs?.[0] || null;

    // Debounce search input — also resets Load More pagination
    useEffect(() => {
        if (searchTerm === debouncedSearch) return;
        setIsSearching(true);
        const timer = setTimeout(() => {
            setDebouncedSearch(searchTerm);
            setIsSearching(false);
            setSize(1); // Reset pagination on new search
        }, 300);
        return () => clearTimeout(timer);
    }, [searchTerm, debouncedSearch]);

    // Reset Load More pagination when filter or tab changes
    useEffect(() => {
        setSize(1);
    }, [filterType, activeTab, selectedMaqalPair]);

    // Helper to format pair date strings like "2026-06-28" or ISO → "28 Jun"
    const formatPairDate = (dateStr: string) => {
        if (!dateStr) return '';
        try {
            // Handle both "2026-06-28" and "2026-06-28T00:00:00.000Z"
            const d = new Date(dateStr);
            if (!isNaN(d.getTime())) {
                const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
            }
        } catch {}
        // Fallback: split by '-'
        const [, m, dd] = dateStr.split('-');
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return `${parseInt(dd)} ${months[parseInt(m) - 1]}`;
    };

    // Extract day number from a date string for search matching
    const getDayFromDate = (dateStr: string): string => {
        if (!dateStr) return '';
        try {
            const d = new Date(dateStr);
            if (!isNaN(d.getTime())) return String(d.getUTCDate());
        } catch {}
        const parts = dateStr.split('-');
        return parts.length >= 3 ? String(parseInt(parts[2])) : '';
    };

    const filteredPairs = maqalPairs?.filter(pair => {
        if (!maqalSearch) return true;
        const q = maqalSearch.toLowerCase().trim();
        const formatted = `${formatPairDate(pair.date1)} & ${formatPairDate(pair.date2)}`.toLowerCase();
        const day1 = getDayFromDate(pair.date1);
        const day2 = getDayFromDate(pair.date2);
        // Match against formatted text, or raw day numbers
        return formatted.includes(q) || day1 === q || day2 === q || day1.startsWith(q) || day2.startsWith(q);
    });

    const getKey = (pageIndex: number, previousPageData: Customer[]) => {
        if (previousPageData && !previousPageData.length) return null; // reached the end
        
        const params = new URLSearchParams();
        params.append('page', (pageIndex + 1).toString());
        params.append('limit', '20');
        
        if (selectedMaqalPair === 'latest' && latestPair) {
            params.append('maqal_d1', latestPair.date1);
            params.append('maqal_d2', latestPair.date2);
        } else if (selectedMaqalPair && selectedMaqalPair.includes('|')) {
            params.append('maqal_d1', selectedMaqalPair.split('|')[0]);
            params.append('maqal_d2', selectedMaqalPair.split('|')[1]);
        }
        

        if (debouncedSearch) {
            params.append('search', debouncedSearch);
        }
        params.append('tab', activeTab);
        if (filterType !== 'default') {
            params.append('sort', filterType);
        }
        
        return `/api/customers?${params.toString()}`;
    };

    const { data: customersDataPages, isLoading, size, setSize, mutate: mutateCustomers } = useSWRInfinite<Customer[]>(
        getKey,
        fetcher,
        { revalidateOnFocus: false, dedupingInterval: 60000, revalidateOnReconnect: false, revalidateIfStale: false }
    );
    const customers = customersDataPages ? customersDataPages.flat() : [];

    const getToken = () => typeof window !== 'undefined' ? localStorage.getItem('dadwork_session_token') || '' : '';

    // NOTE: Deactivating a customer is now ONLY done from the Daily Book page.
    // The handleDeactivate function has been intentionally removed from this page.

    const handleRestore = async (customerId: string) => {
        if (!confirm('Restore this customer to Active? They will re-appear in all lists with their original ID and history.')) return;
        setManagingCustomerId(customerId);
        
        try {
            // Step 1: Restore the customer (clears deleted_at and assigns a valid code)
            const res = await fetch(`/api/customers?id=${customerId}&restore=true`, {
                method: 'DELETE',
                headers: { 'x-session-token': getToken() }
            });
            if (!res.ok) throw new Error((await res.json()).error || 'Failed');

            // Step 2: Auto re-sequence all customer IDs to fill any gaps
            const fixRes = await fetch('/api/resequence-customers', {
                method: 'POST',
                headers: { 'x-session-token': getToken() }
            });
            if (!fixRes.ok) console.warn('Restore succeeded but ID re-sequencing failed silently.');

            toast.success('Customer restored & IDs updated!');
            // Step 3: Silently refresh the list — no screen freeze
            mutateCustomers(undefined, { revalidate: true });
            
            // Instantly refresh priority trackers across the app
            localStorage.setItem('dadwork_customers_stale', Date.now().toString());
            window.dispatchEvent(new Event('dadwork_customers_stale'));
        } catch (err: any) { 
            toast.error(err.message); 
            mutateCustomers(undefined, { revalidate: true });
        }
        finally { setManagingCustomerId(null); }
    };

    const handlePermanentDelete = async (customerId: string, name: string) => {
        if (!confirm(`⚠️ PERMANENTLY DELETE "${name}"? This will erase ALL their ledger entries, daily book history, and cannot be undone!`)) return;
        setManagingCustomerId(customerId);
        
        // Optimistic UI Update is disabled when paginating to avoid complex state management
        // mutateCustomers((prev: any) => prev ? prev.filter((c: any) => c.id !== customerId) : [], { revalidate: false });

        try {
            const res = await fetch(`/api/customers?id=${customerId}&permanent=true`, {
                method: 'DELETE',
                headers: { 'x-session-token': getToken() }
            });
            if (!res.ok) throw new Error((await res.json()).error || 'Failed');
            toast.success('Customer permanently deleted.');
            mutateCustomers(undefined, { revalidate: true });
        } catch (err: any) { 
            toast.error(err.message); 
            mutateCustomers(undefined, { revalidate: true }); // Revert on failure
        }
        finally { setManagingCustomerId(null); }
    };

    const handleToggleStatus = async (customerId: string, field: 'is_unassignable' | 'is_kabarka', value: boolean, e?: React.FormEvent) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        try {
            const res = await fetch('/api/customers/toggle-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ customerId, field, value })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to toggle status');
            toast.success(`Successfully updated ${field === 'is_kabarka' ? 'Kabarka' : 'Assignment'} status!`);
            setTimeout(() => window.location.reload(), 1500); // Wait 1.5s so spinner shows, then reload
        } catch (err: any) {
            toast.error(err.message);
        }
    };

    const handleReorderCustomer = async (customerId: string, e?: React.FormEvent) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        if (!reorderTargetId.trim()) return;
        setIsReordering(true);
        try {
            const res = await fetch('/api/customers/reorder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ customerId, targetCode: reorderTargetId.trim() })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to reorder');
            toast.success('Customer reordered successfully!');
            setReorderOpenForId(null);
            setReorderTargetId('');
            setTimeout(() => window.location.reload(), 1500); // Wait 1.5s so spinner shows, then reload
        } catch (err: any) {
            toast.error(err.message);
            setIsReordering(false);
        }
    };

    useEffect(() => {
        const userStr = localStorage.getItem('currentUser');
        if (userStr) {
            try {
                setCurrentUser(JSON.parse(userStr));
            } catch (e) {
                console.error('Failed to parse current user session', e);
            }
        }

        // Listen for cross-page invalidation signal (e.g. from Ledger saves)
        const handleStorage = (e: StorageEvent) => {
            if (e.key === 'dadwork_customers_stale') {
                if (document.visibilityState === 'visible') {
                    mutateCustomers(undefined, { revalidate: true });
                }
            }
        };

        // Also check on window focus just in case
        const handleFocus = () => {
            const staleSignal = localStorage.getItem('dadwork_customers_stale');
            const lastCheck = sessionStorage.getItem('customers_last_check');
            if (staleSignal && staleSignal !== lastCheck) {
                sessionStorage.setItem('customers_last_check', staleSignal);
                mutateCustomers(undefined, { revalidate: true });
            }
        };

        window.addEventListener('storage', handleStorage);
        window.addEventListener('focus', handleFocus);
        
        // Check immediately on mount too
        handleFocus();

        return () => {
            window.removeEventListener('storage', handleStorage);
            window.removeEventListener('focus', handleFocus);
        };
    }, [mutateCustomers]);

    // Backend now handles all filtering and sorting!
    const filteredCustomers = customers;

    const activeCustomers = customers.filter((c: any) => !c.is_inactive && !c.is_kabarka);
    const inactiveCustomers = customers.filter((c: any) => c.is_inactive);

    return (
        <div className="space-y-4 max-w-2xl mx-auto px-1 md:px-0" suppressHydrationWarning>
            {/* Header / Cover */}
            <div className="relative p-6 md:p-8 rounded-2xl bg-card overflow-hidden border border-border flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-sm mb-6">
                <AnimatedBackground />

                <div className="relative z-10 flex-1">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2.5 rounded-xl bg-primary/20 text-primary shadow-inner">
                            <Users className="w-6 h-6" />
                        </div>
                        <h2 className="text-2xl md:text-3xl font-black text-foreground tracking-tight uppercase">Customers</h2>
                    </div>
                    <div className="flex items-center gap-2 mt-1 ml-1 flex-wrap">
                        <button 
                            onClick={() => setActiveTab('active')}
                            className={`text-xs font-black uppercase tracking-widest px-3 py-1 rounded-full transition-colors ${activeTab === 'active' ? 'text-emerald-500 bg-emerald-500/20 ring-1 ring-emerald-500/50' : 'text-emerald-500/60 bg-emerald-500/10 hover:bg-emerald-500/20'}`}
                        >
                            Active: {activeCustomers.length}
                        </button>
                        {inactiveCustomers.length > 0 && (
                            <button 
                                onClick={() => setActiveTab('inactive')}
                                className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full transition-opacity ${activeTab === 'inactive' ? 'text-red-500 bg-red-500/20 ring-1 ring-red-500/50 opacity-100' : 'text-red-500/60 bg-red-500/10 hover:opacity-100 opacity-60'}`}
                            >
                                Inactive: {inactiveCustomers.length}
                            </button>
                        )}
                    </div>
                    <p className="text-muted-foreground text-sm font-medium max-w-md ml-1 mt-1">
                        Manage all registered clients, review balances, and find individuals in your ledger instantly.
                    </p>
                </div>

                <div className="relative z-10 flex flex-col sm:flex-row gap-3 self-stretch md:self-center md:flex-wrap lg:flex-nowrap justify-end items-stretch sm:items-center">
                    <div className="relative flex-1 sm:max-w-[220px] w-full shrink">
                        {isSearching
                            ? <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary animate-spin" />
                            : <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        }
                        <Input
                            placeholder="Search by name or ID..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-9 h-11 bg-background/50 backdrop-blur-sm border-border/60 focus:border-primary transition-colors w-full rounded-xl shrink"
                        />
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button className={`h-11 px-3 rounded-xl border flex items-center justify-center gap-2 transition-colors ${filterType !== 'default' ? 'bg-primary/10 text-primary border-primary/30' : 'bg-background/50 text-foreground border-border/60 hover:bg-muted/50'}`}>
                                    <Filter className="w-4 h-4" />
                                    <span className="text-xs font-bold hidden sm:inline-block">Filter</span>
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48 bg-card/95 backdrop-blur-xl border-border/50 rounded-2xl shadow-xl">
                                <DropdownMenuItem onClick={() => setFilterType('default')} className={`text-[10px] sm:text-xs font-bold cursor-pointer rounded-xl ${filterType === 'default' ? 'bg-primary/10 text-primary' : ''}`}>
                                    ⚙️ Caadi (Default) {filterType === 'default' && <Check className="w-3 h-3 ml-auto" />}
                                </DropdownMenuItem>

                                {currentUser?.assigned_customer_ids?.length > 0 && (
                                    <DropdownMenuItem onClick={() => setFilterType('priority')} className={`text-[10px] sm:text-xs font-bold cursor-pointer rounded-xl ${filterType === 'priority' ? 'bg-amber-500/10 text-amber-500' : ''}`}>
                                        ⭐ My Priority {filterType === 'priority' && <Check className="w-3 h-3 ml-auto" />}
                                    </DropdownMenuItem>
                                )}

                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger className="text-[10px] sm:text-xs font-bold cursor-pointer rounded-xl text-emerald-500 focus:text-emerald-600 focus:bg-emerald-500/10">
                                        ⭐ Macaamilka Ugu Fiican
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuPortal>
                                        <DropdownMenuSubContent className="w-48 bg-card/95 backdrop-blur-xl border-border/50 rounded-2xl shadow-xl">
                                            <DropdownMenuItem onClick={() => setFilterType('best_lacag')} className={`text-[10px] sm:text-xs font-bold cursor-pointer rounded-xl ${filterType === 'best_lacag' ? 'bg-emerald-500/10 text-emerald-500' : ''}`}>
                                                Lacagta {filterType === 'best_lacag' && <Check className="w-3 h-3 ml-auto" />}
                                            </DropdownMenuItem>
                                            
                                            <div className="px-2 pt-2 pb-1">
                                                <div className="text-[10px] font-bold text-muted-foreground mb-1 uppercase tracking-wider">Maqalka</div>
                                                <input 
                                                    type="text" 
                                                    placeholder="Search dates (e.g. 24)..." 
                                                    value={maqalSearch}
                                                    onChange={(e) => setMaqalSearch(e.target.value)}
                                                    className="w-full text-xs bg-muted/50 border border-border/50 rounded-md p-1.5 focus:ring-1 focus:ring-primary/50 text-foreground"
                                                    onClick={(e) => e.stopPropagation()}
                                                    onKeyDown={(e) => e.stopPropagation()}
                                                />
                                            </div>
                                            <div className="max-h-40 overflow-y-auto overflow-x-hidden p-1 space-y-0.5">
                                                {(!maqalSearch || "latest maqal".includes(maqalSearch.toLowerCase())) && (
                                                    <DropdownMenuItem onClick={() => { 
                                                        setFilterType('best_maqal'); 
                                                        setSelectedMaqalPair('latest');
                                                    }} className={`text-[10px] sm:text-xs font-bold cursor-pointer rounded-xl ${(filterType === 'best_maqal' && selectedMaqalPair === 'latest') ? 'bg-primary/10 text-primary' : ''}`}>
                                                        ✅ Latest Maqal {latestPair && <span className="ml-1 text-[9px] opacity-70">({formatPairDate(latestPair.date1)} & {formatPairDate(latestPair.date2)})</span>}
                                                        {(filterType === 'best_maqal' && selectedMaqalPair === 'latest') && <Check className="w-3 h-3 ml-auto" />}
                                                    </DropdownMenuItem>
                                                )}
                                                {(!maqalSearch || "all time".includes(maqalSearch.toLowerCase())) && (
                                                    <DropdownMenuItem onClick={() => { setFilterType('best_maqal'); setSelectedMaqalPair('all_time'); }} className={`text-[10px] sm:text-xs font-bold cursor-pointer rounded-xl ${(filterType === 'best_maqal' && selectedMaqalPair === 'all_time') ? 'bg-primary/10 text-primary' : ''}`}>
                                                        All Time {(filterType === 'best_maqal' && selectedMaqalPair === 'all_time') && <Check className="w-3 h-3 ml-auto" />}
                                                    </DropdownMenuItem>
                                                )}
                                                {filteredPairs?.map(pair => {
                                                    const val = `${pair.date1}|${pair.date2}`;
                                                    const paidCount = parseInt(pair.payment_count) || 0;
                                                    const totalCount = parseInt(pair.total_customers) || 0;
                                                    const isQualified = paidCount >= 20;
                                                    return (
                                                        <DropdownMenuItem key={val} onClick={() => { setFilterType('best_maqal'); setSelectedMaqalPair(val); }} className={`text-[10px] sm:text-xs font-bold cursor-pointer rounded-xl ${(filterType === 'best_maqal' && selectedMaqalPair === val) ? 'bg-primary/10 text-primary' : ''}`}>
                                                            <span className="flex items-center gap-1 flex-1 min-w-0">
                                                                {formatPairDate(pair.date1)} & {formatPairDate(pair.date2)}
                                                                {isQualified ? (
                                                                    <span className="ml-1 text-[8px] font-black px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-400">
                                                                        ✅ {paidCount}/{totalCount}
                                                                    </span>
                                                                ) : (
                                                                    <span className="ml-1 text-[8px] font-black px-1 py-0.5 rounded bg-amber-500/15 text-amber-400">
                                                                        ⏳ {paidCount}/{totalCount}
                                                                    </span>
                                                                )}
                                                            </span>
                                                            {(filterType === 'best_maqal' && selectedMaqalPair === val) && <Check className="w-3 h-3 ml-auto shrink-0" />}
                                                        </DropdownMenuItem>
                                                    );
                                                })}
                                                {maqalSearch && filteredPairs?.length === 0 && (
                                                    <div className="text-center py-3 text-[10px] font-medium text-muted-foreground">
                                                        No pairs available
                                                    </div>
                                                )}
                                            </div>
                                        </DropdownMenuSubContent>
                                    </DropdownMenuPortal>
                                </DropdownMenuSub>

                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger className="text-[10px] sm:text-xs font-bold cursor-pointer rounded-xl text-destructive focus:text-destructive focus:bg-destructive/10">
                                        ⚠️ Macaamilka Ugu Liita
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuPortal>
                                        <DropdownMenuSubContent className="w-48 bg-card/95 backdrop-blur-xl border-border/50 rounded-2xl shadow-xl">
                                            <DropdownMenuItem onClick={() => setFilterType('worst_lacag')} className={`text-[10px] sm:text-xs font-bold cursor-pointer rounded-xl ${filterType === 'worst_lacag' ? 'bg-destructive/10 text-destructive' : ''}`}>
                                                Lacagta {filterType === 'worst_lacag' && <Check className="w-3 h-3 ml-auto" />}
                                            </DropdownMenuItem>
                                            
                                            <div className="px-2 pt-2 pb-1">
                                                <div className="text-[10px] font-bold text-muted-foreground mb-1 uppercase tracking-wider">Maqalka</div>
                                                <input 
                                                    type="text" 
                                                    placeholder="Search dates (e.g. 24)..." 
                                                    value={maqalSearch}
                                                    onChange={(e) => setMaqalSearch(e.target.value)}
                                                    className="w-full text-xs bg-muted/50 border border-border/50 rounded-md p-1.5 focus:ring-1 focus:ring-primary/50 text-foreground"
                                                    onClick={(e) => e.stopPropagation()}
                                                    onKeyDown={(e) => e.stopPropagation()}
                                                />
                                            </div>
                                            <div className="max-h-40 overflow-y-auto overflow-x-hidden p-1 space-y-0.5">
                                                {(!maqalSearch || "latest maqal".includes(maqalSearch.toLowerCase())) && (
                                                    <DropdownMenuItem onClick={() => { 
                                                        setFilterType('worst_maqal'); 
                                                        setSelectedMaqalPair('latest');
                                                    }} className={`text-[10px] sm:text-xs font-bold cursor-pointer rounded-xl ${(filterType === 'worst_maqal' && selectedMaqalPair === 'latest') ? 'bg-primary/10 text-primary' : ''}`}>
                                                        ✅ Latest Maqal {latestPair && <span className="ml-1 text-[9px] opacity-70">({formatPairDate(latestPair.date1)} & {formatPairDate(latestPair.date2)})</span>}
                                                        {(filterType === 'worst_maqal' && selectedMaqalPair === 'latest') && <Check className="w-3 h-3 ml-auto" />}
                                                    </DropdownMenuItem>
                                                )}
                                                {(!maqalSearch || "all time".includes(maqalSearch.toLowerCase())) && (
                                                    <DropdownMenuItem onClick={() => { setFilterType('worst_maqal'); setSelectedMaqalPair('all_time'); }} className={`text-[10px] sm:text-xs font-bold cursor-pointer rounded-xl ${(filterType === 'worst_maqal' && selectedMaqalPair === 'all_time') ? 'bg-primary/10 text-primary' : ''}`}>
                                                        All Time {(filterType === 'worst_maqal' && selectedMaqalPair === 'all_time') && <Check className="w-3 h-3 ml-auto" />}
                                                    </DropdownMenuItem>
                                                )}
                                                {filteredPairs?.map(pair => {
                                                    const val = `${pair.date1}|${pair.date2}`;
                                                    const paidCount = parseInt(pair.payment_count) || 0;
                                                    const totalCount = parseInt(pair.total_customers) || 0;
                                                    const isQualified = paidCount >= 20;
                                                    return (
                                                        <DropdownMenuItem key={val} onClick={() => { setFilterType('worst_maqal'); setSelectedMaqalPair(val); }} className={`text-[10px] sm:text-xs font-bold cursor-pointer rounded-xl ${(filterType === 'worst_maqal' && selectedMaqalPair === val) ? 'bg-primary/10 text-primary' : ''}`}>
                                                            <span className="flex items-center gap-1 flex-1 min-w-0">
                                                                {formatPairDate(pair.date1)} & {formatPairDate(pair.date2)}
                                                                {isQualified ? (
                                                                    <span className="ml-1 text-[8px] font-black px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-400">
                                                                        ✅ {paidCount}/{totalCount}
                                                                    </span>
                                                                ) : (
                                                                    <span className="ml-1 text-[8px] font-black px-1 py-0.5 rounded bg-amber-500/15 text-amber-400">
                                                                        ⏳ {paidCount}/{totalCount}
                                                                    </span>
                                                                )}
                                                            </span>
                                                            {(filterType === 'worst_maqal' && selectedMaqalPair === val) && <Check className="w-3 h-3 ml-auto shrink-0" />}
                                                        </DropdownMenuItem>
                                                    );
                                                })}
                                                {maqalSearch && filteredPairs?.length === 0 && (
                                                    <div className="text-center py-3 text-[10px] font-medium text-muted-foreground">
                                                        No pairs available
                                                    </div>
                                                )}
                                            </div>
                                        </DropdownMenuSubContent>
                                    </DropdownMenuPortal>
                                </DropdownMenuSub>

                                <DropdownMenuItem onClick={() => setFilterType('most_paid')} className={`text-[10px] sm:text-xs font-bold cursor-pointer rounded-xl ${filterType === 'most_paid' ? 'bg-primary/10 text-primary' : ''}`}>
                                    💰 Lacagta Ugu Badan Bixiyay {filterType === 'most_paid' && <Check className="w-3 h-3 ml-auto" />}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setFilterType('least_paid')} className={`text-[10px] sm:text-xs font-bold cursor-pointer rounded-xl ${filterType === 'least_paid' ? 'bg-primary/10 text-primary' : ''}`}>
                                    💸 Lacagta Ugu Yar Bixiyay {filterType === 'least_paid' && <Check className="w-3 h-3 ml-auto" />}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setFilterType('most_kg')} className={`text-[10px] sm:text-xs font-bold cursor-pointer rounded-xl ${filterType === 'most_kg' ? 'bg-primary/10 text-primary' : ''}`}>
                                    ⚖️ KG Ugu Badan {filterType === 'most_kg' && <Check className="w-3 h-3 ml-auto" />}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setFilterType('least_kg')} className={`text-[10px] sm:text-xs font-bold cursor-pointer rounded-xl ${filterType === 'least_kg' ? 'bg-primary/10 text-primary' : ''}`}>
                                    🪶 KG Ugu Yar {filterType === 'least_kg' && <Check className="w-3 h-3 ml-auto" />}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        {currentUser?.role === 'SUPER_ADMIN' && (
                            <AddCustomerDialog onSuccess={() => mutateCustomers(undefined, { revalidate: true })} />
                        )}
                    </div>
                </div>
            </div>


            {/* List */}
            <div className="rounded-xl border border-border/40 overflow-hidden bg-card/30 backdrop-blur-sm">
                {isLoading ? (
                    <div className="divide-y divide-border/30">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="flex items-center gap-3 px-4 py-3 animate-pulse">
                                <div className="w-8 h-8 rounded-full bg-muted shrink-0" />
                                <div className="flex-1 space-y-1.5">
                                    <div className="h-3 bg-muted rounded w-1/3" />
                                    <div className="h-2.5 bg-muted/50 rounded w-1/4" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : filteredCustomers.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                        <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
                        <p className="text-xs font-bold uppercase tracking-widest">
                            {searchTerm ? 'No results found' : 'No customers yet'}
                        </p>
                        {!searchTerm && currentUser?.role === 'SUPER_ADMIN' && (
                            <div className="mt-4">
                                <AddCustomerDialog onSuccess={() => mutateCustomers(undefined, { revalidate: true })} />
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="divide-y divide-border/30">
                        {customers.map((customer: any, index: number) => {
                            const isMale = customer.gender === 'Male';
                            const isFemale = customer.gender === 'Female';
                            const accentColor = isMale ? 'text-blue-400' : isFemale ? 'text-pink-400' : 'text-primary';
                            const avatarBg = isMale ? 'bg-blue-500/10 border-blue-500/30' : isFemale ? 'bg-pink-500/10 border-pink-500/30' : 'bg-primary/10 border-primary/30';

                            let performanceColor = '';
                            if (filterType === 'best' && index < 5) performanceColor = 'bg-emerald-500/10';
                            else if (filterType === 'worst' && index < 5) performanceColor = 'bg-destructive/10';

                            // Inactive customers get action buttons, not a nav link
                            if ((customer as any).is_inactive) {
                                return (
                                    <div
                                        key={customer.id}
                                        className="flex items-center gap-3 px-4 py-2.5 bg-muted/10"
                                    >
                                        <Avatar className="h-8 w-8 border shrink-0 bg-muted/30 border-border/30">
                                            <AvatarFallback className="text-xs font-black text-muted-foreground/50">
                                                {customer.name.substring(0, 1).toUpperCase()}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-black truncate uppercase text-muted-foreground/60 line-through">{customer.name}</p>
                                            <p className="text-[10px] text-muted-foreground/40 font-bold">#{customer.customer_code}</p>
                                        </div>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <button
                                                onClick={() => handleRestore(customer.id)}
                                                disabled={managingCustomerId === customer.id}
                                                className="flex items-center gap-1 text-[10px] font-black uppercase px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 hover:bg-emerald-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {managingCustomerId === customer.id 
                                                    ? <><Loader2 className="w-3 h-3 animate-spin" /><span>Recovering...</span></>
                                                    : <><RotateCcw className="w-3 h-3" /><span>Recover</span></>}
                                            </button>
                                            <button
                                                onClick={() => handlePermanentDelete(customer.id, customer.name)}
                                                disabled={managingCustomerId === customer.id}
                                                className="flex items-center gap-1 text-[10px] font-black uppercase px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                <Trash2 className="w-3 h-3" />
                                                Delete Forever
                                            </button>
                                        </div>
                                    </div>
                                );
                            }

                            return (
                                <Link
                                    href={`/customers/${customer.id}`}
                                    key={customer.id}
                                    prefetch={false}
                                    className={`group flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors cursor-pointer ${performanceColor}`}
                                >
                                    <Avatar className={`h-8 w-8 border shrink-0 ${avatarBg}`}>
                                        <AvatarFallback className={`text-xs font-black ${accentColor}`}>
                                            {customer.name.substring(0, 1).toUpperCase()}
                                        </AvatarFallback>
                                    </Avatar>

                                    {/* Main info */}
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-xs font-black truncate group-hover:${accentColor} transition-colors uppercase flex items-center gap-1.5`}>
                                            {customer.name}
                                            {(customer as any).is_target_days_done && <CheckCircle2 className="w-3.5 h-3.5 text-blue-500 fill-blue-500/20" />}
                                            {currentUser?.assigned_customer_ids?.includes(customer.id) && (
                                                <span className="inline-flex items-center gap-0.5 text-[9px] font-black uppercase bg-amber-500/10 text-amber-500 border border-amber-500/30 px-1.5 py-0.5 rounded-md shadow-[0_0_10px_rgba(245,158,11,0.2)]">
                                                    <Star className="w-2.5 h-2.5 fill-amber-500 text-amber-500" />
                                                    Priority
                                                </span>
                                            )}
                                        </p>
                                        <div className="flex flex-wrap items-center gap-2 mt-0.5">
                                            {(filterType === 'best_maqal' || filterType === 'worst_maqal') ? (
                                                <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md flex items-center gap-1 ${
                                                    (index === 0) ? 'bg-amber-500/20 text-amber-500 border border-amber-500/40 shadow-[0_0_8px_rgba(245,158,11,0.3)]' 
                                                    : (index === 1) ? 'bg-slate-400/20 text-slate-500 border border-slate-400/40 shadow-[0_0_8px_rgba(148,163,184,0.3)]'
                                                    : (index === 2) ? 'bg-orange-700/20 text-orange-700 dark:text-orange-600 border border-orange-700/40 shadow-[0_0_8px_rgba(194,65,12,0.3)]'
                                                    : 'bg-muted/50 text-muted-foreground border border-border/50'
                                                }`}>
                                                    {index === 0 ? <Star className="w-2.5 h-2.5 fill-amber-500" /> 
                                                     : index === 1 ? <Star className="w-2.5 h-2.5 fill-slate-400" />
                                                     : index === 2 ? <Star className="w-2.5 h-2.5 fill-orange-700 dark:fill-orange-600" /> 
                                                     : null}
                                                    Rank {index + 1}
                                                </span>
                                            ) : currentUser?.role === 'SUPER_ADMIN' ? (
                                                <div onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                                                    <Popover open={reorderOpenForId === customer.id} onOpenChange={(o) => {
                                                        setReorderOpenForId(o ? customer.id : null);
                                                        if (o) setReorderTargetId('');
                                                    }}>
                                                        <PopoverTrigger asChild>
                                                            <button className="text-[10px] font-bold text-muted-foreground/70 hover:text-primary transition-colors cursor-pointer flex items-center gap-1">
                                                                #{customer.customer_code}
                                                                {customer.is_unassignable && <span title="Hidden from Assignments">🚷</span>}
                                                                {customer.is_kabarka && <span title="Kabarka Mode">➖</span>}
                                                            </button>
                                                        </PopoverTrigger>
                                                        <PopoverContent side="right" className="w-auto p-3 bg-background/40 backdrop-blur-xl border-border/50 shadow-2xl rounded-xl z-[100] flex flex-col gap-3">
                                                            <div className="flex flex-col gap-2 border-b border-border/50 pb-3" onClick={e => e.stopPropagation()}>
                                                                <div className="flex items-center justify-between gap-4">
                                                                    <div className="flex items-center gap-1.5">
                                                                        <span className="text-xs">🚷</span>
                                                                        <span className="text-[10px] font-bold text-muted-foreground whitespace-nowrap">Hide from Assignments</span>
                                                                    </div>
                                                                    <Switch 
                                                                        checked={!!customer.is_unassignable} 
                                                                        onCheckedChange={(checked) => handleToggleStatus(customer.id, 'is_unassignable', checked)}
                                                                        disabled={isReordering}
                                                                        className="scale-75 origin-right"
                                                                    />
                                                                </div>
                                                                <div className="flex items-center justify-between gap-4">
                                                                    <div className="flex items-center gap-1.5">
                                                                        <span className="text-xs">➖</span>
                                                                        <span className="text-[10px] font-bold text-muted-foreground whitespace-nowrap">Kabarka Mode (Extra)</span>
                                                                    </div>
                                                                    <Switch 
                                                                        checked={!!customer.is_kabarka} 
                                                                        onCheckedChange={(checked) => handleToggleStatus(customer.id, 'is_kabarka', checked)}
                                                                        disabled={isReordering}
                                                                        className="scale-75 origin-right"
                                                                    />
                                                                </div>
                                                            </div>
                                                            <form onSubmit={(e) => handleReorderCustomer(customer.id, e)} className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                                                <span className="text-xs font-bold text-muted-foreground ml-1">Move to #</span>
                                                                <Input 
                                                                    autoFocus 
                                                                    type="number" 
                                                                    placeholder="e.g. 20" 
                                                                    value={reorderTargetId}
                                                                    onChange={(e) => setReorderTargetId(e.target.value)}
                                                                    className="w-16 h-8 text-xs font-bold bg-background/50 border-input shadow-inner"
                                                                />
                                                                <Button type="submit" disabled={isReordering || !reorderTargetId} size="icon" className="h-8 w-8 rounded-lg shrink-0">
                                                                    {isReordering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                                                </Button>
                                                            </form>
                                                        </PopoverContent>
                                                    </Popover>
                                                </div>
                                            ) : (
                                                <span className="text-[10px] font-bold text-muted-foreground/70">
                                                    #{customer.customer_code}
                                                </span>
                                            )}
                                            {customer.phone && (
                                                <span className="hidden sm:flex items-center gap-1 text-[10px] text-muted-foreground">
                                                    <Phone className="w-2.5 h-2.5" />
                                                    {customer.phone}
                                                </span>
                                            )}
                                            {/* Dynamic Maqal % — SINGLE badge, toggles between maqal/all-time */}
                                            {(() => {
                                                const allTimePct = (customer as any).all_time_maqal_pct ?? 0;
                                                const allTimeTotal = (customer as any).all_time_maqal_total ?? 0;
                                                const maqalPct = (customer as any).selected_maqal_pct ?? (customer as any).latest_maqal_pct ?? 0;
                                                const maqalTotal = (customer as any).selected_maqal_total ?? (customer as any).latest_maqal_total ?? 0;

                                                // Show all-time if user selected 'all_time' or explicitly toggled this customer
                                                const showAllTime = selectedMaqalPair === 'all_time' || showAllTimePct[customer.id];
                                                
                                                const pct = showAllTime ? allTimePct : maqalPct;
                                                const total = showAllTime ? allTimeTotal : maqalTotal;
                                                const icon = showAllTime ? <Globe className="w-2.5 h-2.5" /> : <CalendarDays className="w-2.5 h-2.5" />;
                                                const label = showAllTime ? 'All Time' : '';

                                                if (filterType === 'default') return null;
                                                if (showAllTime && allTimeTotal <= 0) return null;
                                                if (!showAllTime && maqalTotal <= 0) return null;

                                                return (
                                                    <button 
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            setShowAllTimePct(prev => ({...prev, [customer.id]: !prev[customer.id]}));
                                                        }}
                                                        className={`flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded transition-all cursor-pointer hover:opacity-80 active:scale-95 border ${
                                                            pct >= 80 ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' 
                                                            : pct >= 50 ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' 
                                                            : pct >= 25 ? 'bg-orange-500/15 text-orange-400 border-orange-500/30'
                                                            : 'bg-red-500/15 text-red-400 border-red-500/30'
                                                        }`}
                                                        title={showAllTime ? `All-Time: ${pct}% — Click for maqal view` : `Maqal: ${pct}% — Click for all-time`}
                                                    >
                                                        {icon}
                                                        <span>{pct}%</span>
                                                    </button>
                                                );
                                            })()}
                                            {/* Unsolved pair reminder — pulsing amber — hide when specific maqal selected */}
                                            {selectedMaqalPair === 'latest' && !(customer as any).is_target_days_done && (customer as any).pair_date1 && (customer as any).pair_date2 && (
                                                <span className="reminder-pulse text-[8px] font-bold text-amber-500/90 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-md flex items-center gap-1">
                                                    <Clock className="w-2.5 h-2.5" />
                                                    {formatPairDate((customer as any).pair_date1)} & {formatPairDate((customer as any).pair_date2)}
                                                </span>
                                            )}
                                            {(filterType === 'most_paid' || filterType === 'least_paid' || filterType === 'best') && (
                                                <span className="text-[9px] font-bold text-emerald-500 bg-emerald-500/10 px-1.5 rounded">
                                                    Paid: ${(customer as any).total_paid || 0}
                                                </span>
                                            )}
                                            {(filterType === 'most_kg' || filterType === 'least_kg') && (
                                                <span className="text-[9px] font-bold text-blue-500 bg-blue-500/10 px-1.5 rounded">
                                                    KG Maalintii: {((customer as any).total_books_count ? ((customer as any).total_kg || 0) / (customer as any).total_books_count : 0).toFixed(1).replace(/\.0$/, '')}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Balance Info */}
                                    <div className="text-right shrink-0 min-w-[70px]">
                                        <p className={`text-sm font-black leading-none ${(customer as any).current_balance > 0 ? 'text-destructive' : 'text-emerald-500'}`}>
                                            ${Math.abs(Math.round((customer as any).current_balance || 0)).toLocaleString('en-US')}
                                        </p>
                                        <p className="text-[8px] font-bold uppercase tracking-tighter text-muted-foreground mt-0.5">
                                            {(customer as any).current_balance < 0 ? 'Heyn' : (customer as any).last_receipt_has_payment ? 'Reesto' : 'Lacagta Guud'}
                                        </p>
                                    </div>

                                    {/* Arrow */}
                                    <ChevronRight className={`w-3.5 h-3.5 shrink-0 text-muted-foreground/30 group-hover:${accentColor} group-hover:translate-x-0.5 transition-all`} />
                                </Link>
                            );
                        })}
                    </div>
                )}
                
                {customersDataPages && customersDataPages[customersDataPages.length - 1]?.length === 20 && (
                    <div className="p-4 pt-2">
                        <Button 
                            onClick={() => setSize(size + 1)}
                            variant="secondary" 
                            className="w-full text-xs font-bold bg-muted/50 hover:bg-muted"
                        >
                            <RefreshCw className="w-3.5 h-3.5 mr-2 opacity-50" />
                            Load More
                        </Button>
                    </div>
                )}
            </div>

        </div>
    );
}
