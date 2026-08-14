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
                    @keyframes wordReveal {
                        0% { opacity: 0; transform: translateY(8px); }
                        100% { opacity: 1; transform: translateY(0); }
                    }
                    .greeting-word {
                        display: inline-block;
                        opacity: 0; /* starts hidden before animation runs */
                        animation: wordReveal 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
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
                        <p className="text-xs text-muted-foreground mt-1 font-medium">
                            {dates.standard}
                            {dates.hijri && (
                                <span className="ml-2 opacity-60">· {dates.hijri}</span>
                            )}
                        </p>
                    )}
                </div>
            </div>

            {/* ── 3 Stat Cards ── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">

                {/* Card 1 — Total Customers */}
                <div className="stat-card rounded-2xl border border-border bg-card p-5 md:p-6 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            Total Customers
                        </span>
                        <div className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-500/10">
                            <Users className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                        </div>
                    </div>
                    <div>
                        <p className="text-3xl md:text-4xl font-bold text-foreground tabular-nums leading-none">
                            {data?.totalCustomers || 0}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1.5">Active accounts</p>
                    </div>
                </div>

                {/* Card 2 — Deynta Guud */}
                <div
                    className="stat-card rounded-2xl border border-border bg-card p-5 md:p-6 flex flex-col gap-3 cursor-pointer hover:border-primary/30 transition-colors"
                    onClick={() => setIsExpanded(!isExpanded)}
                >
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            Deynta Guud
                        </span>
                        <div className="flex items-center gap-1.5">
                            <Link
                                href="/reports?tab=debtors"
                                onClick={(e) => e.stopPropagation()}
                                className="p-1.5 rounded-lg bg-muted hover:bg-primary/10 transition-colors"
                            >
                                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" />
                            </Link>
                        </div>
                    </div>
                    <div>
                        <p className="text-3xl md:text-4xl font-bold text-foreground tabular-nums leading-none flex items-baseline gap-1">
                            <span className="text-lg text-muted-foreground font-semibold">$</span>
                            {totalCombinedDebt.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1.5">Total outstanding</p>
                    </div>

                    {/* Expandable breakdown */}
                    <div className={`overflow-hidden transition-all duration-300 ${isExpanded ? 'max-h-24 opacity-100 mt-1' : 'max-h-0 opacity-0'}`}>
                        <div className="pt-3 border-t border-border grid grid-cols-2 gap-2">
                            <div>
                                <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1">
                                    <TrendingUp className="h-2.5 w-2.5 text-red-400" />
                                    Lacagta Guud
                                </p>
                                <p className="text-sm font-bold text-red-500 tabular-nums">
                                    ${(data?.totalDebt || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </p>
                            </div>
                            <div>
                                <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1">
                                    <DollarSign className="h-2.5 w-2.5 text-emerald-400" />
                                    Reesto
                                </p>
                                <p className="text-sm font-bold text-emerald-500 tabular-nums">
                                    ${(data?.totalReesto || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="text-center mt-auto">
                        {isExpanded
                            ? <ChevronUp className="h-3.5 w-3.5 mx-auto text-muted-foreground/40" />
                            : <ChevronDown className="h-3.5 w-3.5 mx-auto text-muted-foreground/40" />
                        }
                    </div>
                </div>

                {/* Card 3 — Today's KG */}
                <div className="stat-card rounded-2xl border border-border bg-card p-5 md:p-6 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            Today&apos;s KG
                        </span>
                        <div className="p-1.5 rounded-lg bg-amber-50 dark:bg-amber-500/10">
                            <Zap className="h-3.5 w-3.5 text-amber-500" />
                        </div>
                    </div>
                    <div>
                        <p className="text-3xl md:text-4xl font-bold text-foreground tabular-nums leading-none flex items-baseline gap-1">
                            {Math.round(data?.todayKg || 0)}
                            <span className="text-base font-semibold text-muted-foreground ml-0.5">KG</span>
                        </p>
                        <p className="text-xs text-muted-foreground mt-1.5">
                            {data?.todayCustomerCount || 0} active customers
                        </p>
                    </div>
                </div>
            </div>

            {/* ── Today's Activity Card ── */}
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="px-5 py-4 md:px-6 md:py-5 border-b border-border/60 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Activity className="h-4 w-4 text-primary" />
                        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                            Today&apos;s Activity
                        </span>
                    </div>
                </div>
                <div className="px-5 py-4 md:px-6 md:py-5">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 md:gap-6">
                        <div className="flex flex-col gap-0.5">
                            <p className="text-2xl md:text-3xl font-bold text-foreground tabular-nums">
                                {Math.round(data?.todayKg || 0)}
                                <span className="text-sm font-semibold text-muted-foreground ml-1">KG</span>
                            </p>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total KG</p>
                        </div>
                        <div className="flex flex-col gap-0.5">
                            <p className="text-2xl md:text-3xl font-bold text-emerald-500 tabular-nums">
                                {data?.todayCustomerCount || 0}
                            </p>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Active Customers</p>
                        </div>
                        <div className="flex flex-col gap-0.5 col-span-2 sm:col-span-1">
                            <p className="text-2xl md:text-3xl font-bold text-foreground tabular-nums flex items-baseline gap-0.5">
                                <span className="text-sm font-semibold text-muted-foreground">$</span>
                                {(data?.totalPaid || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                            </p>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total Collected</p>
                        </div>
                    </div>
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
