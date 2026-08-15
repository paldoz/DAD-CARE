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
    Settings,
    Bell,
    LogOut,
} from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { GlobalSearch } from '@/components/global-search';
import { AnimatedBackground } from '@/components/animated-background';
import { SecurityBell } from '@/components/security-bell';
import { logout } from '@/lib/session';
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
    const [userRole, setUserRole] = useState('');
    const [avatarUrl, setAvatarUrl] = useState('');
    const [avatarInitial, setAvatarInitial] = useState('D');
    const [greetingWords, setGreetingWords] = useState<string[]>([]);
    const [showProfileMenu, setShowProfileMenu] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const { data, isLoading, mutate: mutateDashboard } = useSWR<DashboardData>('/api/dashboard', fetcher, {
        revalidateOnFocus: false,
        dedupingInterval: 60000,
        revalidateOnReconnect: false,
        revalidateIfStale: false
    });

    useEffect(() => {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        void mq.matches; // access so it's not flagged unused

        const todayDate = new Date();
        const standardDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(todayDate);
        const hijriDateFull = new Intl.DateTimeFormat('en-GB-u-ca-islamic', { day: 'numeric', month: 'long', year: 'numeric' }).format(todayDate);
        setDates({
            standard: standardDate,
            hijri: hijriDateFull.replace(/ AH$/, '').replace(/,/, '')
        });

        // Load user info from localStorage
        const storedUser = localStorage.getItem('currentUser');
        let name = '';
        let role = '';
        let avatar = '';
        if (storedUser) {
            try {
                const parsed = JSON.parse(storedUser);
                name = parsed.username || parsed.name || '';
                role = parsed.role || '';
                avatar = parsed.avatar_url || '';
            } catch (e) {}
        }
        setUsername(name);
        setUserRole(role);
        setAvatarUrl(avatar);
        setAvatarInitial(name ? name.charAt(0).toUpperCase() : 'D');

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

        // Close profile menu on outside click
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setShowProfileMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);

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
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('storage', handleStorage);
            window.removeEventListener('focus', handleFocus);
        };
    }, [mutateDashboard]);

    const handleLogout = async () => {
        setShowProfileMenu(false);
        await logout();
        window.location.href = '/login';
    };

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
    const isSuperAdmin = userRole === 'SUPER_ADMIN';

    const roleBadgeLabel =
        userRole === 'SUPER_ADMIN' ? 'Super Admin'
        : userRole === 'ADMIN' ? 'Admin'
        : userRole ? userRole.replace(/_/g, ' ') : null;

    const topDebtors = (data?.topDebtors || []).slice(0, 3);

    return (
        <div className="w-full max-w-3xl mx-auto space-y-3 md:space-y-4">

            {/* ── Inline styles for greeting animation ── */}
            <style>{`
                @keyframes wordRevealLoop {
                    0%, 5%  { opacity: 0; transform: translateY(8px); }
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

            {/* ── Hero Header Panel ── */}
            <div className="relative overflow-hidden rounded-2xl border border-border bg-card">
                <AnimatedBackground />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-blue-500/8" />

                <div className="relative z-10 px-4 py-4 md:px-5 md:py-5">
                    <div className="flex items-start justify-between gap-3">

                        {/* LEFT: Avatar (clickable) + Greeting + Role */}
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                            {/* Clickable Avatar → profile dropdown */}
                            <div className="relative shrink-0" ref={menuRef}>
                                <button
                                    onClick={() => setShowProfileMenu(v => !v)}
                                    className="w-11 h-11 md:w-12 md:h-12 rounded-xl border-2 border-primary/20 shadow-md overflow-hidden bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center active:scale-95 transition-transform"
                                    aria-label="Profile menu"
                                >
                                    {avatarUrl ? (
                                        <img src={avatarUrl} alt={username} className="w-full h-full object-cover" />
                                    ) : (
                                        <span className="text-primary-foreground font-black text-base md:text-lg">
                                            {avatarInitial}
                                        </span>
                                    )}
                                </button>

                                {/* Profile dropdown */}
                                {showProfileMenu && (
                                    <div className="absolute top-14 left-0 z-[200] bg-card border border-border rounded-2xl shadow-2xl p-3 min-w-[200px] animate-in fade-in slide-in-from-top-2 duration-200">
                                        {/* User info */}
                                        <div className="px-2 pb-2 mb-2 border-b border-border/50">
                                            <p className="text-xs font-black uppercase tracking-widest text-foreground">{username || 'DadWork'}</p>
                                            <p className="text-[9px] font-bold tracking-widest uppercase text-muted-foreground mt-0.5">
                                                {roleBadgeLabel || 'Admin'}
                                            </p>
                                        </div>
                                        <Link
                                            href="/settings"
                                            onClick={() => setShowProfileMenu(false)}
                                            className="flex items-center gap-3 w-full px-3 py-2 rounded-xl text-foreground hover:bg-muted transition-colors"
                                        >
                                            <Settings className="h-4 w-4 shrink-0 text-muted-foreground" />
                                            <span className="text-sm font-semibold">Settings</span>
                                        </Link>
                                        <button
                                            onClick={handleLogout}
                                            className="flex items-center gap-3 w-full px-3 py-2 rounded-xl text-red-500 hover:bg-red-500/10 transition-colors active:scale-[0.98] mt-1"
                                        >
                                            <LogOut className="h-4 w-4 shrink-0" />
                                            <span className="text-sm font-bold">Logout</span>
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Greeting + Role badge */}
                            <div className="min-w-0 flex-1">
                                <p className="text-[10px] font-semibold text-muted-foreground mb-0.5">Welcome back</p>
                                <h1 className="text-lg md:text-xl font-bold text-foreground tracking-tight leading-snug flex flex-wrap gap-x-1.5 mb-1.5">
                                    {greetingWords.map((word, i) => (
                                        <span
                                            key={i}
                                            className="greeting-word"
                                            style={{ animationDelay: `${i * 0.15}s` }}
                                        >
                                            {word}
                                        </span>
                                    ))}
                                </h1>
                                {roleBadgeLabel && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-primary/10 text-primary border border-primary/20">
                                        <span className="w-1 h-1 rounded-full bg-primary inline-block animate-pulse" />
                                        {roleBadgeLabel}
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* RIGHT: Notification + Settings icons + Date */}
                        <div className="flex flex-col items-end gap-2 shrink-0">
                            {/* Icon row */}
                            <div className="flex items-center gap-1.5">
                                {isSuperAdmin ? (
                                    <div className="[&>button]:!h-9 [&>button]:!w-9 [&>button]:!rounded-xl [&>button]:!border [&>button]:!border-border/60 [&>button]:!bg-card/50">
                                        <SecurityBell />
                                    </div>
                                ) : (
                                    <Link
                                        href="/settings"
                                        className="h-9 w-9 rounded-xl border border-border/60 bg-card/50 flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/30 hover:bg-primary/5 transition-colors"
                                        title="Notifications"
                                    >
                                        <Bell className="h-4 w-4" />
                                    </Link>
                                )}
                                <Link
                                    href="/settings"
                                    className="h-9 w-9 rounded-xl border border-border/60 bg-card/50 flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/30 hover:bg-primary/5 transition-colors"
                                    title="Settings"
                                >
                                    <Settings className="h-4 w-4" />
                                </Link>
                            </div>

                            {/* Date — desktop only */}
                            {dates.standard && (
                                <div className="hidden md:flex flex-col items-end gap-0.5">
                                    <p className="text-[11px] font-semibold text-foreground/80 flex items-center gap-1">
                                        📅 {dates.standard}
                                    </p>
                                    {dates.hijri && (
                                        <p className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                                            🌙 {dates.hijri}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Global Search ── */}
            <GlobalSearch />

            {/* ── 3 Stat Cards ── */}
            <div className="grid grid-cols-3 gap-2 md:gap-3">

                {/* Card 1 — Total Customers */}
                <div className="stat-card rounded-xl md:rounded-2xl border border-border bg-card p-3 sm:p-4 md:p-5 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-wider text-muted-foreground line-clamp-1">
                            Customers
                        </span>
                        <div className="p-1 md:p-1.5 rounded-lg bg-blue-50 dark:bg-blue-500/10 shrink-0">
                            <Users className="h-3 w-3 md:h-3.5 md:w-3.5 text-blue-600 dark:text-blue-400" />
                        </div>
                    </div>
                    <div className="mt-auto">
                        <p className="text-2xl sm:text-3xl md:text-4xl font-bold text-foreground tabular-nums leading-none">
                            {data?.totalCustomers || 0}
                        </p>
                        <p className="text-[9px] md:text-[10px] text-muted-foreground mt-1 line-clamp-1">Active accounts</p>
                    </div>
                </div>

                {/* Card 2 — Deynta Guud */}
                <div
                    className="stat-card rounded-xl md:rounded-2xl border border-border bg-card p-3 sm:p-4 md:p-5 flex flex-col gap-2 cursor-pointer hover:border-primary/30 transition-colors"
                    onClick={() => setIsExpanded(!isExpanded)}
                >
                    <div className="flex items-center justify-between">
                        <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-wider text-muted-foreground line-clamp-1">
                            Debt
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
                        <p className="text-2xl sm:text-3xl md:text-4xl font-bold text-foreground tabular-nums leading-none flex items-baseline gap-0.5">
                            <span className="text-xs md:text-sm text-muted-foreground font-semibold">$</span>
                            {totalCombinedDebt.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </p>
                        <p className="text-[9px] md:text-[10px] text-muted-foreground mt-1 line-clamp-1">Outstanding</p>
                    </div>

                    {/* Expandable breakdown */}
                    <div className={`overflow-hidden transition-all duration-300 ${isExpanded ? 'max-h-24 opacity-100 mt-1' : 'max-h-0 opacity-0'}`}>
                        <div className="pt-2 border-t border-border flex flex-col gap-1.5">
                            <div className="flex items-center justify-between">
                                <p className="text-[8px] md:text-[9px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                                    <TrendingUp className="h-2 w-2 text-red-400" />
                                    Lacagta
                                </p>
                                <p className="text-[10px] md:text-xs font-bold text-red-500 tabular-nums">
                                    ${(data?.totalDebt || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </p>
                            </div>
                            <div className="flex items-center justify-between">
                                <p className="text-[8px] md:text-[9px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                                    <DollarSign className="h-2 w-2 text-emerald-400" />
                                    Reesto
                                </p>
                                <p className="text-[10px] md:text-xs font-bold text-emerald-500 tabular-nums">
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
                <div className="stat-card rounded-xl md:rounded-2xl border border-border bg-card p-3 sm:p-4 md:p-5 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-wider text-muted-foreground line-clamp-1">
                            Today
                        </span>
                        <div className="p-1 md:p-1.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 shrink-0">
                            <Zap className="h-3 w-3 md:h-3.5 md:w-3.5 text-amber-500" />
                        </div>
                    </div>
                    <div className="mt-auto">
                        <p className="text-2xl sm:text-3xl md:text-4xl font-bold text-foreground tabular-nums leading-none flex items-baseline gap-0.5">
                            {Math.round(data?.todayKg || 0)}
                            <span className="text-[9px] md:text-xs font-semibold text-muted-foreground ml-0.5">KG</span>
                        </p>
                        <p className="text-[9px] md:text-[10px] text-muted-foreground mt-1 line-clamp-1">
                            {data?.todayCustomerCount || 0} active
                        </p>
                    </div>
                </div>
            </div>

            {/* ── Top Outstanding Debtors ── */}
            {topDebtors.length > 0 && (
                <div className="rounded-xl md:rounded-2xl border border-border bg-card overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
                        <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Top Outstanding</h3>
                        <Link href="/reports?tab=debtors" className="text-[10px] font-semibold text-primary hover:text-primary/80 transition-colors">
                            View all →
                        </Link>
                    </div>
                    <div className="divide-y divide-border/50">
                        {topDebtors.map((debtor) => (
                            <div key={debtor.id} className="flex items-center justify-between px-4 py-2.5">
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-foreground truncate">{debtor.name}</p>
                                    <p className="text-[10px] text-muted-foreground">#{debtor.code}</p>
                                </div>
                                <span className="text-sm font-bold text-red-500 tabular-nums ml-3 shrink-0">
                                    ${debtor.debt.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Recent Activity Card ── */}
            <div className="rounded-xl md:rounded-2xl border border-border bg-card p-4 md:p-5 relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Recent Activity</h3>
                    <Link href="/daily-book" className="text-[10px] font-semibold text-primary hover:text-primary/80 transition-colors">
                        View all →
                    </Link>
                </div>

                <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Today</p>
                    <div className="flex items-center gap-2.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                        <span className="text-sm text-foreground">
                            <span className="font-semibold">{data?.todayCustomerCount || 0}</span> customers active
                        </span>
                    </div>
                    <div className="flex items-center gap-2.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                        <span className="text-sm text-foreground">
                            <span className="font-semibold">{Math.round(data?.todayKg || 0)}</span> KG processed
                        </span>
                    </div>
                </div>

                <div className="flex justify-end mt-4">
                    <Link
                        href="/daily-book"
                        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                    >
                        View Daily Book <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                </div>
            </div>

            {/* Admin Egress Monitor */}
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
