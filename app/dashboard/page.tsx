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
        revalidateOnFocus: false,
        dedupingInterval: 60000,
        revalidateOnReconnect: true,
        revalidateIfStale: true
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

        const handleStorage = (e: StorageEvent) => {
            if (e.key === 'dadwork_customers_stale' && document.visibilityState === 'visible') {
                mutateDashboard(undefined, { revalidate: true });
            }
        };

        const handleCustom = () => mutateDashboard(undefined, { revalidate: true });

        const handleFocus = () => {
            const staleSignal = localStorage.getItem('dadwork_customers_stale');
            const lastCheck = sessionStorage.getItem('dashboard_last_check');
            if (staleSignal && staleSignal !== lastCheck) {
                sessionStorage.setItem('dashboard_last_check', staleSignal);
                mutateDashboard(undefined, { revalidate: true });
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

    // ── PREMIUM SKELETON LOADER ──
    if (isLoading && !data) {
        return (
            <div className="space-y-5 md:space-y-6 max-w-3xl mx-auto w-full px-1 md:px-0">
                <div className="h-10 md:h-11 rounded-full bg-card border border-border/50 animate-pulse shadow-sm" />
                <div className="h-[120px] rounded-2xl bg-card border border-border/50 animate-pulse shadow-sm" />
                <div className="grid grid-cols-2 gap-3 md:gap-4">
                    <div className="h-[140px] rounded-2xl bg-card border border-border/50 animate-pulse shadow-sm" />
                    <div className="h-[140px] rounded-2xl bg-card border border-border/50 animate-pulse shadow-sm" />
                </div>
                <div className="h-[100px] rounded-2xl bg-card border border-border/50 animate-pulse shadow-sm" />
            </div>
        );
    }

    const totalCombinedDebt = (data?.totalDebt || 0) + (data?.totalReesto || 0);

    return (
        <div className="space-y-5 md:space-y-6 max-w-3xl mx-auto w-full px-1 md:px-0 pb-10">
            <GlobalSearch />
            
            {/* Header / Cover */}
            <div className="relative p-6 md:p-8 rounded-2xl bg-card overflow-hidden border border-border/60 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-sm hover:shadow-md transition-shadow duration-500 mb-2 group">
                <AnimatedBackground />
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                
                <div className="relative z-10 flex-1">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2.5 rounded-xl bg-primary text-primary-foreground shadow-sm">
                            <Activity className="w-5 h-5 md:w-6 md:h-6" />
                        </div>
                        <h2 className="text-2xl md:text-3xl font-black text-foreground tracking-tight uppercase">Overview</h2>
                    </div>
                    <p className="text-muted-foreground text-sm font-medium max-w-md ml-1 leading-relaxed">
                        Business intelligence at a glance. Track operational volume and financial health.
                    </p>
                </div>
            </div>

            {/* Stats Grid - Premium Cards */}
            <div className="grid grid-cols-2 gap-3 md:gap-4">
                {/* Total Customers */}
                <Card className="bg-card border-border/60 overflow-hidden group flex flex-col justify-center shadow-sm hover:shadow-md hover:border-primary/30 transition-all duration-300 hover:-translate-y-0.5">
                    <CardContent className="p-4 md:p-5 flex flex-col items-center text-center justify-center h-full relative">
                        <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity duration-300 pointer-events-none">
                            <Users className="w-24 h-24 text-primary" />
                        </div>
                        <div className="p-2 md:p-2.5 rounded-xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors duration-300 mb-3 z-10">
                            <Users className="h-5 w-5" />
                        </div>
                        <p className="text-[10px] md:text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1 z-10">
                            Active Customers
                        </p>
                        <p className="text-3xl md:text-4xl font-black text-foreground tabular-nums tracking-tight z-10">
                            {data?.totalCustomers || 0}
                        </p>
                    </CardContent>
                </Card>

                {/* Deynta Guud Toggle Card */}
                <Card 
                    className="bg-card border-border/60 overflow-hidden cursor-pointer group shadow-sm hover:shadow-md hover:border-primary/30 transition-all duration-300 hover:-translate-y-0.5"
                    onClick={() => setIsExpanded(!isExpanded)}
                >
                    <CardContent className="p-4 md:p-5 flex flex-col h-full relative">
                        <div className="flex justify-between items-center mb-3 relative z-10">
                            <p className="text-[10px] md:text-xs font-bold text-muted-foreground uppercase tracking-widest">
                                Total Receivables
                            </p>
                            <Link 
                                href="/reports?tab=debtors" 
                                onClick={(e) => e.stopPropagation()} 
                                className="p-1.5 rounded-xl bg-secondary text-secondary-foreground hover:bg-primary hover:text-primary-foreground transition-colors duration-300 flex items-center gap-1 shadow-sm"
                            >
                                <ChevronRight className="h-3 w-3 md:h-4 md:w-4" />
                            </Link>
                        </div>
                        
                        <div className="flex-1 flex flex-col justify-center text-center relative z-10">
                            <p className="text-3xl md:text-4xl font-black text-foreground tabular-nums flex items-baseline justify-center gap-1 tracking-tight">
                                <span className="text-xl md:text-2xl text-muted-foreground/60 font-medium">$</span>
                                {totalCombinedDebt.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                            </p>
                        </div>

                        {/* Expandable Split Details */}
                        <div className={`grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-border/50 transition-all duration-300 overflow-hidden relative z-10 ${isExpanded ? 'max-h-40 opacity-100' : 'max-h-0 opacity-0 border-transparent m-0 p-0'}`}>
                            <div className="flex flex-col items-center border-r border-border/50 px-2">
                                <div className="flex items-center gap-1.5 mb-1.5 text-destructive">
                                    <TrendingUp className="h-3.5 w-3.5" />
                                    <p className="text-[9px] font-bold uppercase tracking-widest opacity-80">Ledger</p>
                                </div>
                                <p className="text-sm md:text-base font-black text-destructive tabular-nums tracking-tight">
                                    ${(data?.totalDebt || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </p>
                            </div>
                            <div className="flex flex-col items-center px-2">
                                <div className="flex items-center gap-1.5 mb-1.5 text-emerald-500">
                                    <DollarSign className="h-3.5 w-3.5" />
                                    <p className="text-[9px] font-bold uppercase tracking-widest opacity-80">Reesto</p>
                                </div>
                                <p className="text-sm md:text-base font-black text-emerald-500 tabular-nums tracking-tight">
                                    ${(data?.totalReesto || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </p>
                            </div>
                        </div>

                        {!isExpanded && (
                            <div className="text-center mt-2 text-muted-foreground/30 group-hover:text-primary transition-colors z-10">
                                <ChevronDown className="h-4 w-4 mx-auto" />
                            </div>
                        )}
                        {isExpanded && (
                            <div className="text-center mt-3 text-muted-foreground/30 group-hover:text-primary transition-colors z-10">
                                <ChevronUp className="h-4 w-4 mx-auto" />
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Today's Summary - Premium Banner */}
            <Card className="bg-card border-border/60 overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-300 group">
                <CardContent className="p-0">
                    <div className="p-5 md:p-6 bg-gradient-to-r from-primary/5 via-transparent to-transparent">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="p-3 rounded-2xl bg-primary text-primary-foreground shadow-sm group-hover:scale-105 transition-transform duration-300">
                                    <Package className="h-5 w-5 md:h-6 md:w-6" />
                                </div>
                                <div>
                                    <p className="text-[10px] md:text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1">
                                        Today's Volume
                                    </p>
                                    <div className="flex items-baseline gap-1.5">
                                        <p className="text-3xl md:text-4xl font-black text-foreground tabular-nums tracking-tight">
                                            {Math.round(data?.todayKg || 0)}
                                        </p>
                                        <span className="text-sm font-bold text-muted-foreground uppercase">KG</span>
                                    </div>
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="text-[10px] md:text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1">
                                    Active Now
                                </p>
                                <div className="flex items-baseline justify-end gap-1.5">
                                    <p className="text-xl md:text-2xl font-black text-foreground tabular-nums tracking-tight">
                                        {data?.todayCustomerCount || 0}
                                    </p>
                                    <span className="text-xs font-semibold text-muted-foreground/60 hidden sm:inline">served</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
