'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Users,
    TrendingUp,
    DollarSign,
    Package,
    Loader2,
    ChevronRight,
    ArrowDownWideNarrow,
    ArrowUpNarrowWide,
    ChevronDown,
    ChevronUp,
    Activity,
    Zap
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { GlobalSearch } from '@/components/global-search';
import { AnimatedBackground } from '@/components/animated-background';
import useSWR from 'swr';

const fetcher = async (url: string) => {
    // Cookie-only auth (credentials: include) — NO x-session-token header.
    const res = await fetch(url, { 
        credentials: 'include',
        headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        }
    });
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

interface DashboardData {
    totalCustomers: number;
    totalDebt: number;
    totalReesto: number;
    totalPaid: number;
    totalKg: number;
    todayKg: number;
    todayCustomerCount: number;
    topDebtors: { id: string; name: string; code: string; debt: number; is_reesto: boolean; total_payments: number; total_maqal: number; percentage_paid: number; }[];
    recentTransactions: any[];
}

export default function DashboardPage() {
    const { theme, setTheme } = useTheme();
    const [isExpanded, setIsExpanded] = useState(false);
    const [dates, setDates] = useState({ standard: '', hijri: '' });

    const { data, isLoading, mutate: mutateDashboard } = useSWR<DashboardData>('/api/dashboard', fetcher, {
        revalidateOnFocus: false,     // ⚡ use event signal instead of focus-revalidation
        dedupingInterval: 60000,      // ⚡ 1 req per min max — saves Vercel compute
        revalidateOnReconnect: false,
        revalidateIfStale: false
    });

    useEffect(() => {
        // Calculate dates safely on client to prevent hydration mismatch
        const todayDate = new Date();
        const standardDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(todayDate);
        const hijriDateFull = new Intl.DateTimeFormat('en-GB-u-ca-islamic', { day: 'numeric', month: 'long', year: 'numeric' }).format(todayDate);
        setDates({
            standard: standardDate,
            hijri: hijriDateFull.replace(/ AH$/, '').replace(/,/, '')
        });

        // Listen for cross-page invalidation signal (e.g. from Ledger saves)
        const handleStorage = (e: StorageEvent) => {
            if (e.key === 'dadwork_customers_stale') {
                if (document.visibilityState === 'visible') {
                    mutateDashboard();
                }
            }
        };

        const handleCustom = () => {
            mutateDashboard();
        };

        const handleFocus = () => {
            const staleSignal = localStorage.getItem('dadwork_customers_stale');
            const lastCheck = sessionStorage.getItem('dashboard_last_check');
            if (staleSignal && staleSignal !== lastCheck) {
                sessionStorage.setItem('dashboard_last_check', staleSignal);
                mutateDashboard();
            }
        };

        window.addEventListener('storage', handleStorage);
        window.addEventListener('dadwork_customers_stale', handleCustom);
        window.addEventListener('focus', handleFocus);
        handleFocus();

        return () => {
            window.removeEventListener('storage', handleStorage);
            window.removeEventListener('dadwork_customers_stale', handleCustom);
            window.removeEventListener('focus', handleFocus);
        };
    }, [mutateDashboard]);

    // Only show the full-page spinner on the very first load (no cached data yet)
    if (isLoading && !data) {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <div className="flex flex-col items-center gap-4">
                    <div className="relative">
                        <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
                        <div className="relative p-4 rounded-full bg-primary/10">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    </div>
                    <p className="text-sm text-muted-foreground font-medium">Loading dashboard...</p>
                </div>
            </div>
        );
    }

    // Derived lists (kept minimal since Customers List moved to reports)
    const totalCombinedDebt = (data?.totalDebt || 0) + (data?.totalReesto || 0);

    return (
        <div className="space-y-5 md:space-y-6 max-w-3xl mx-auto w-full px-1 md:px-0">
            <GlobalSearch />
            
            {/* Header / Cover */}
            <div className="relative p-6 md:p-8 rounded-2xl bg-card overflow-hidden border border-border flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-sm mb-2">
                <AnimatedBackground />
                
                <div className="relative z-10 flex-1">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2.5 rounded-xl bg-primary/20 text-primary shadow-inner">
                            <Activity className="w-6 h-6" />
                        </div>
                        <h2 className="text-2xl md:text-3xl font-black text-foreground tracking-tight uppercase">Dashboard</h2>
                    </div>
                    <p className="text-muted-foreground text-sm font-medium max-w-md ml-1">
                        Business overview at a glance. Track customers, payments, debts, and daily operational volume.
                    </p>
                </div>
            </div>

            {/* Stats Grid - Premium Cards */}
            <div className="grid grid-cols-2 gap-2 md:gap-4">
                {/* Total Customers */}
                <Card className="glass-card overflow-hidden group flex flex-col justify-center">
                    <CardContent className="p-3 md:p-4 flex flex-col items-center text-center justify-center h-full">
                        <div className="p-1.5 md:p-2 rounded-xl bg-blue-500/10 group-hover:bg-blue-500/15 transition-colors mb-3">
                            <Users className="h-5 w-5 md:h-6 md:w-6 text-blue-500" />
                        </div>
                        <p className="text-[10px] md:text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1">
                            Total Customers
                        </p>
                        <p className="text-2xl md:text-3xl font-black text-foreground tabular-nums">
                            {data?.totalCustomers || 0}
                        </p>
                    </CardContent>
                </Card>

                {/* Deynta Guud Toggle Card */}
                <Card 
                    className="glass-card overflow-hidden cursor-pointer group hover:border-primary/50 transition-all shadow-sm group-hover:shadow-md group-hover:shadow-primary/10"
                    onClick={() => setIsExpanded(!isExpanded)}
                >
                    <CardContent className="p-3 md:p-4 flex flex-col h-full">
                        <div className="flex justify-between items-center mb-3">
                            <p className="text-[10px] md:text-xs font-bold text-muted-foreground uppercase tracking-widest">
                                Deynta Guud
                            </p>
                            <Link 
                                href="/reports?tab=debtors" 
                                onClick={(e) => e.stopPropagation()} 
                                className="p-1.5 rounded-xl bg-primary/10 text-primary hover:bg-primary/20 transition-colors flex items-center gap-1 group/link"
                            >
                                <span className="text-[9px] font-bold uppercase tracking-widest hidden sm:inline opacity-80 group-hover/link:opacity-100">Reports</span>
                                <ChevronRight className="h-3 w-3" />
                            </Link>
                        </div>
                        
                        <div className="flex-1 flex flex-col justify-center text-center">
                            <p className="text-2xl md:text-3xl font-black text-foreground tabular-nums flex items-baseline justify-center gap-1">
                                <span className="text-lg md:text-xl text-muted-foreground font-bold">$</span>
                                {totalCombinedDebt.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                            </p>
                        </div>

                        {/* Expandable Split Details */}
                        <div className={`grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-border/50 transition-all duration-300 overflow-hidden ${isExpanded ? 'max-h-40 opacity-100' : 'max-h-0 opacity-0 border-transparent m-0 p-0'}`}>
                            <div className="flex flex-col items-center border-r border-border/50">
                                <div className="flex items-center gap-1 mb-1 text-red-500">
                                    <TrendingUp className="h-3 w-3" />
                                    <p className="text-[9px] font-bold uppercase tracking-widest">Lacagta Guud</p>
                                </div>
                                <p className="text-base font-black text-red-500 tabular-nums">
                                    ${(data?.totalDebt || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </p>
                            </div>
                            <div className="flex flex-col items-center">
                                <div className="flex items-center gap-1 mb-1 text-emerald-500">
                                    <DollarSign className="h-3 w-3" />
                                    <p className="text-[9px] font-bold uppercase tracking-widest">Reesto</p>
                                </div>
                                <p className="text-base font-black text-emerald-500 tabular-nums">
                                    ${(data?.totalReesto || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </p>
                            </div>
                        </div>

                        {!isExpanded && (
                            <div className="text-center mt-1 text-muted-foreground/30 group-hover:text-primary transition-colors">
                                <ChevronDown className="h-4 w-4 mx-auto" />
                            </div>
                        )}
                        {isExpanded && (
                            <div className="text-center mt-2 text-muted-foreground/30 group-hover:text-primary transition-colors">
                                <ChevronUp className="h-4 w-4 mx-auto" />
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Today's Summary - Gradient Card */}
            <Card className="glass-card overflow-hidden border-primary/20">
                <CardContent className="p-0">
                    <div className="p-4 md:p-5 bg-gradient-to-br from-primary/5 via-transparent to-blue-500/5">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 rounded-xl bg-primary/10">
                                    <Zap className="h-5 w-5 text-primary" />
                                </div>
                                <div>
                                    <p className="text-[10px] md:text-xs font-bold text-muted-foreground uppercase tracking-widest">
                                        Today&apos;s KG
                                    </p>
                                    <div className="relative w-[130px] h-[36px] overflow-hidden mt-0.5">
                                        <div className="animate-kinetic flex items-center w-max">
                                            <p className="text-2xl md:text-3xl font-black text-primary tabular-nums animate-lightning">
                                                ⚡ {Math.round(data?.todayKg || 0)} <span className="text-sm font-bold text-primary/60">KG</span>
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-0.5">Active</p>
                                <div className="relative w-[80px] h-[28px] overflow-hidden ml-auto">
                                    <div className="animate-kinetic flex items-center w-max" style={{ animationDelay: '-1.5s' }}>
                                        <p className="text-lg font-black text-foreground animate-lightning">
                                            ⚡ {data?.todayCustomerCount || 0}
                                        </p>
                                    </div>
                                </div>
                                <p className="text-[10px] text-muted-foreground mt-0.5">customers</p>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Admin Egress Monitor (System Link) */}
            <div className="flex justify-center mt-6 mb-8">
                <Link href="/api/egress-stats" target="_blank" className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors bg-secondary/30 px-3 py-1.5 rounded-full border border-border/50">
                    <Activity className="h-3 w-3" />
                    <span>View Live Egress Monitor</span>
                </Link>
            </div>
        </div>
    );
}
