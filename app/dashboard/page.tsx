'use client';

import {
    Users,
    DollarSign,
    Zap,
    Loader2,
    ChevronRight,
    TrendingUp,
    Activity,
    ChevronDown,
    ChevronUp,
    ArrowRight,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { GlobalSearch } from '@/components/global-search';
import { AnimatedBackground } from '@/components/animated-background';
import useSWR from 'swr';

const fetcher = async (url: string) => {
    const res = await fetch(url, {
        credentials: 'include',
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
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
    const [isExpanded, setIsExpanded] = useState(false);
    const [dates, setDates] = useState({ standard: '', hijri: '' });
    const [username, setUsername] = useState('');
    const [greetingWords, setGreetingWords] = useState<string[]>([]);
    const [reducedMotion, setReducedMotion] = useState(false);

    const { data, isLoading, mutate: mutateDashboard } = useSWR<DashboardData>('/api/dashboard', fetcher, {
        revalidateOnFocus: false,
        dedupingInterval: 60000,
        revalidateOnReconnect: false,
        revalidateIfStale: false
    });

    useEffect(() => {
        // Detect reduced motion preference
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        setReducedMotion(mq.matches);

        const todayDate = new Date();
        const standardDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(todayDate);
        const hijriDateFull = new Intl.DateTimeFormat('en-GB-u-ca-islamic', { day: 'numeric', month: 'long', year: 'numeric' }).format(todayDate);
        setDates({
            standard: standardDate,
            hijri: hijriDateFull.replace(/ AH$/, '').replace(/,/, '')
        });

        // Load username from localStorage
        const storedUser = localStorage.getItem('currentUser');
        let name = '';
        if (storedUser) {
            try {
                const parsed = JSON.parse(storedUser);
                name = parsed.username || parsed.name || '';
            } catch (e) {}
        }
        setUsername(name);

        // Build time-based greeting
        const hour = todayDate.getHours();
        let timeGreeting = 'Good evening';
        if (hour >= 5 && hour < 12) timeGreeting = 'Good morning';
        else if (hour >= 12 && hour < 17) timeGreeting = 'Good afternoon';
        else if (hour >= 17 && hour < 22) timeGreeting = 'Good evening';
        else timeGreeting = 'Good night';

        const words = name
            ? [...timeGreeting.split(' '), `${name},`, '👋']
            : [...timeGreeting.split(' '), '👋'];
        setGreetingWords(words);

        // Cross-page invalidation
        const handleStorage = (e: StorageEvent) => {
            if (e.key === 'dadwork_customers_stale' && document.visibilityState === 'visible') {
                mutateDashboard();
            }
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
        window.addEventListener('focus', handleFocus);
        handleFocus();
        return () => {
            window.removeEventListener('storage', handleStorage);
            window.removeEventListener('focus', handleFocus);
        };
    }, [mutateDashboard]);

    if (isLoading && !data) {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <div className="flex flex-col items-center gap-3">
                    <Loader2 className="h-7 w-7 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">Loading...</p>
                </div>
            </div>
        );
    }

    const totalCombinedDebt = (data?.totalDebt || 0) + (data?.totalReesto || 0);

    return (
        <div className="w-full max-w-3xl mx-auto space-y-4 md:space-y-5">

            {/* ── Global Search ── */}
            <GlobalSearch />

            {/* ── Greeting Hero Card ── */}
            <div className="dashboard-greeting-card relative overflow-hidden rounded-2xl border border-border bg-card px-5 py-4 md:px-6 md:py-5">
                <AnimatedBackground />
                {/* Subtle diagonal stripe decoration */}
                <div className="pointer-events-none absolute inset-0 greeting-stripes opacity-[0.025]" />
                {/* Very soft blue glow top-right */}
                <div className="pointer-events-none absolute -top-10 -right-10 h-40 w-40 rounded-full bg-blue-500/10 blur-3xl" />

                <style>{`
                    .greeting-stripes {
                        background-image: repeating-linear-gradient(
                            135deg,
                            #2563eb 0px,
                            #2563eb 1px,
                            transparent 1px,
                            transparent 18px
                        );
                    }
                    @keyframes wordRevealLoop {
                        0%, 5% { opacity: 0; transform: translateY(8px); }
                        15%, 80% { opacity: 1; transform: translateY(0); }
                        90%, 100% { opacity: 0; transform: translateY(-4px); }
                    }
                    .greeting-word {
                        display: inline-block;
                        opacity: 0;
                        animation: wordRevealLoop 8s cubic-bezier(0.2, 0.8, 0.2, 1) infinite;
                    }
                    @media (prefers-reduced-motion: reduce) {
                        .greeting-word { animation: none !important; opacity: 1 !important; transform: none !important; }
                    }
                `}</style>

                <div className="relative z-10">
                    <h1 className="text-xl md:text-2xl font-semibold text-foreground tracking-tight leading-snug flex flex-wrap">
                        {greetingWords.map((word, i) => (
                            <span
                                key={i}
                                className="greeting-word"
                                style={{
                                    animationDelay: `${i * 0.15}s`,
                                    marginRight: '0.3em',
                                }}
                            >
                                {word}
                            </span>
                        ))}
                    </h1>
                    {dates.standard && (
                        <p className="hidden md:block text-xs text-muted-foreground mt-1 font-medium">
                            {dates.standard}
                            {dates.hijri && (
                                <span className="ml-2 opacity-60">· {dates.hijri}</span>
                            )}
                        </p>
                    )}
                </div>
            </div>

            {/* ── 3 Stat Cards ── */}
            <div className="grid grid-cols-3 gap-2 md:gap-4">

                {/* Card 1 — Total Customers */}
                <div className="stat-card rounded-xl md:rounded-2xl border border-border bg-card p-3 sm:p-4 md:p-6 flex flex-col gap-2 md:gap-3">
                    <div className="flex items-center justify-between">
                        <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-wider text-muted-foreground line-clamp-1">
                            Total Customers
                        </span>
                        <div className="p-1 md:p-1.5 rounded-lg bg-blue-50 dark:bg-blue-500/10 shrink-0">
                            <Users className="h-3 w-3 md:h-3.5 md:w-3.5 text-blue-600 dark:text-blue-400" />
                        </div>
                    </div>
                    <div className="mt-auto">
                        <p className="text-xl xs:text-2xl sm:text-3xl md:text-4xl font-bold text-foreground tabular-nums leading-none">
                            {data?.totalCustomers || 0}
                        </p>
                        <p className="text-[10px] md:text-xs text-muted-foreground mt-1 md:mt-1.5 line-clamp-1">Active accounts</p>
                    </div>
                </div>

                {/* Card 2 — Deynta Guud */}
                <div
                    className="stat-card rounded-xl md:rounded-2xl border border-border bg-card p-3 sm:p-4 md:p-6 flex flex-col gap-2 md:gap-3 cursor-pointer hover:border-primary/30 transition-colors"
                    onClick={() => setIsExpanded(!isExpanded)}
                >
                    <div className="flex items-center justify-between">
                        <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-wider text-muted-foreground line-clamp-1">
                            Deynta Guud
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                            <Link
                                href="/reports?tab=debtors"
                                onClick={(e) => e.stopPropagation()}
                                className="p-1 md:p-1.5 rounded-lg bg-muted hover:bg-primary/10 transition-colors"
                            >
                                <ChevronRight className="h-3 w-3 md:h-3.5 md:w-3.5 text-muted-foreground hover:text-primary" />
                            </Link>
                        </div>
                    </div>
                    <div className="mt-auto">
                        <p className="text-xl xs:text-2xl sm:text-3xl md:text-4xl font-bold text-foreground tabular-nums leading-none flex items-baseline gap-0.5 md:gap-1">
                            <span className="text-sm md:text-lg text-muted-foreground font-semibold">$</span>
                            {totalCombinedDebt.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </p>
                        <p className="text-[10px] md:text-xs text-muted-foreground mt-1 md:mt-1.5 line-clamp-1">Total outstanding</p>
                    </div>

                    {/* Expandable breakdown */}
                    <div className={`overflow-hidden transition-all duration-300 ${isExpanded ? 'max-h-24 opacity-100 mt-1' : 'max-h-0 opacity-0'}`}>
                        <div className="pt-2 md:pt-3 border-t border-border flex flex-col gap-1 md:gap-2">
                            <div>
                                <p className="text-[8px] md:text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5 flex items-center gap-1">
                                    <TrendingUp className="h-2 w-2 md:h-2.5 md:w-2.5 text-red-400" />
                                    Lacagta
                                </p>
                                <p className="text-[11px] md:text-sm font-bold text-red-500 tabular-nums">
                                    ${(data?.totalDebt || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </p>
                            </div>
                            <div>
                                <p className="text-[8px] md:text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5 flex items-center gap-1">
                                    <DollarSign className="h-2 w-2 md:h-2.5 md:w-2.5 text-emerald-400" />
                                    Reesto
                                </p>
                                <p className="text-[11px] md:text-sm font-bold text-emerald-500 tabular-nums">
                                    ${(data?.totalReesto || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="text-center mt-auto">
                        {isExpanded
                            ? <ChevronUp className="h-3 w-3 md:h-3.5 md:w-3.5 mx-auto text-muted-foreground/40" />
                            : <ChevronDown className="h-3 w-3 md:h-3.5 md:w-3.5 mx-auto text-muted-foreground/40" />
                        }
                    </div>
                </div>

                {/* Card 3 — Today's KG */}
                <div className="stat-card rounded-xl md:rounded-2xl border border-border bg-card p-3 sm:p-4 md:p-6 flex flex-col gap-2 md:gap-3">
                    <div className="flex items-center justify-between">
                        <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-wider text-muted-foreground line-clamp-1">
                            Today&apos;s KG
                        </span>
                        <div className="p-1 md:p-1.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 shrink-0">
                            <Zap className="h-3 w-3 md:h-3.5 md:w-3.5 text-amber-500" />
                        </div>
                    </div>
                    <div className="mt-auto">
                        <p className="text-xl xs:text-2xl sm:text-3xl md:text-4xl font-bold text-foreground tabular-nums leading-none flex items-baseline gap-0.5 md:gap-1">
                            {Math.round(data?.todayKg || 0)}
                            <span className="text-[10px] md:text-base font-semibold text-muted-foreground ml-0.5">KG</span>
                        </p>
                        <p className="text-[10px] md:text-xs text-muted-foreground mt-1 md:mt-1.5 line-clamp-1">
                            {data?.todayCustomerCount || 0} active
                        </p>
                    </div>
                </div>
            </div>

            {/* ── Recent Activity Card ── */}
            <div className="rounded-2xl border border-border bg-card p-5 md:p-6 relative overflow-hidden group">
                {/* Subtle gradient background effect on hover */}
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                
                <h3 className="text-sm font-semibold text-foreground mb-4">Recent Activity</h3>
                
                <div className="space-y-1.5 mb-6">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Today</p>
                    <p className="text-sm text-foreground flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        <span className="font-medium">{data?.todayCustomerCount || 0}</span> customers active
                    </p>
                    <p className="text-sm text-foreground flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                        <span className="font-medium">{Math.round(data?.todayKg || 0)}</span> KG processed
                    </p>
                </div>
                
                <div className="flex justify-end">
                    <Link 
                        href="/daily-book" 
                        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                    >
                        View Daily Book <ArrowRight className="w-4 h-4" />
                    </Link>
                </div>
            </div>

            {/* Admin Egress Monitor link */}
            <div className="flex justify-center pb-2">
                <Link
                    href="/api/egress-stats"
                    target="_blank"
                    className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                >
                    <Activity className="h-3 w-3" />
                    <span>Egress Monitor</span>
                </Link>
            </div>

        </div>
    );
}
