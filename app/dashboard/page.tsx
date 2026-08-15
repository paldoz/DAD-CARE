'use client';

import {
    Users,
    DollarSign,
    Zap,
    Loader2,
    Activity,
    ArrowRight,
    Settings,
    Bell,
    LogOut,
    AlertTriangle,
    ChevronRight,
    TrendingUp,
    ShieldCheck,
    BookOpen,
    UserPlus,
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
    topDebtors: { id: string; name: string; code: string; debt: number; }[];
    recentTransactions: any[];
}

interface MqAnalyticsData {
    period: string;
    mqs: {
        id: string;
        label: string;
        kg: number;
        expected: number;
        paid: number;
        remaining: number;
        paymentPercentage: number;
        customerCount: number;
        customers: {
            id: string;
            name: string;
            code: string;
            expected: number;
            paid: number;
            kg: number;
            remaining: number;
        }[];
    }[];
    totals: {
        expected: number;
        paid: number;
        remaining: number;
        kg: number;
        paymentProgress: number;
        totalMqs: number;
    };
}

/* ── Compact sparkline (card decoration only) ─────────── */
function BlueSparkline() {
    return (
        <svg viewBox="0 0 120 28" className="w-full h-7 mt-2" preserveAspectRatio="none">
            <path d="M0,22 C10,18 20,24 30,16 C40,8 50,20 60,14 C70,8 80,18 90,12 C100,6 110,16 120,10"
                fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    );
}
function GreenSparkline() {
    return (
        <svg viewBox="0 0 120 28" className="w-full h-7 mt-2" preserveAspectRatio="none">
            <path d="M0,20 C10,24 20,14 30,18 C40,22 50,10 60,16 C70,22 80,12 90,18 C100,24 110,12 120,14"
                fill="none" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    );
}
function OrangeSparkline() {
    return (
        <svg viewBox="0 0 120 4" className="w-full h-1.5 mt-3" preserveAspectRatio="none">
            <line x1="0" y1="2" x2="120" y2="2" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" />
        </svg>
    );
}

export default function DashboardPage() {
    const [dates, setDates] = useState({ standard: '', hijri: '' });
    const [username, setUsername] = useState('');
    const [userRole, setUserRole] = useState('');
    const [avatarUrl, setAvatarUrl] = useState('');
    const [avatarInitial, setAvatarInitial] = useState('D');
    const [greetingWords, setGreetingWords] = useState<string[]>([]);
    const [showProfileMenu, setShowProfileMenu] = useState(false);
    const [overviewPeriod, setOverviewPeriod] = useState<'week' | 'month' | 'year'>('week');
    const [overviewTab, setOverviewTab] = useState<'money' | 'kg' | 'payment'>('money');
    const [expandedMq, setExpandedMq] = useState<string | null>(null);
    const [selectedDot, setSelectedDot] = useState<number | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const { data, isLoading, mutate: mutateDashboard } = useSWR<DashboardData>('/api/dashboard', fetcher, {
        revalidateOnFocus: false,
        dedupingInterval: 60000,
        revalidateOnReconnect: false,
        revalidateIfStale: false
    });

    const { data: overviewResponse, isLoading: overviewLoading } = useSWR<MqAnalyticsData>(
        `/api/dashboard/mq-analytics?period=${overviewPeriod}`,
        fetcher,
        { revalidateOnFocus: false, dedupingInterval: 30000 }
    );

    useEffect(() => {
        const todayDate = new Date();
        const standardDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(todayDate);
        const hijriDateFull = new Intl.DateTimeFormat('en-GB-u-ca-islamic', { day: 'numeric', month: 'long', year: 'numeric' }).format(todayDate);
        setDates({
            standard: standardDate,
            hijri: hijriDateFull.replace(/ AH$/, '').replace(/,/, '')
        });

        const storedUser = localStorage.getItem('currentUser');
        let name = '', role = '', avatar = '';
        if (storedUser) {
            try {
                const parsed = JSON.parse(storedUser);
                name = parsed.username || parsed.name || '';
                role = parsed.role || '';
                avatar = parsed.avatar_url || '';
            } catch (e) { }
        }
        setUsername(name);
        setUserRole(role);
        setAvatarUrl(avatar);
        setAvatarInitial(name ? name.charAt(0).toUpperCase() : 'D');

        const hour = todayDate.getHours();
        let timeGreeting = 'Good evening';
        if (hour >= 5 && hour < 12) timeGreeting = 'Good morning';
        else if (hour >= 12 && hour < 17) timeGreeting = 'Good afternoon';
        else if (hour >= 17 && hour < 22) timeGreeting = 'Good evening';
        else timeGreeting = 'Good night';

        const words = name
            ? [...timeGreeting.split(' '), `${name}`, '👋']
            : [...timeGreeting.split(' '), '👋'];
        setGreetingWords(words);

        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setShowProfileMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);

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
    const topDebtors = (data?.topDebtors || []).slice(0, 5);
    const recentTx = (data?.recentTransactions || []).slice(0, 5);
    const hasAttention = topDebtors.some((d: any) => d.debt > 0);

    const roleBadgeLabel =
        userRole === 'SUPER_ADMIN' ? 'Super Admin'
            : userRole === 'ADMIN' ? 'Admin'
                : userRole ? userRole.replace(/_/g, ' ') : null;

    /* greeting line: "Good morning," on line 1, "Name 👋" on line 2 */
    const greetingLine1 = greetingWords.slice(0, 2).join(' ') + ',';
    const greetingLine2Parts = greetingWords.slice(2); // ["Name", "👋"]

    /* ── MQ Analytics Data ─────────────────────── */
    const mqs = overviewResponse?.mqs || [];
    const ovTotals = overviewResponse?.totals || { expected: 0, paid: 0, remaining: 0, kg: 0, paymentProgress: 0, totalMqs: 0 };
    const hasOverviewData = mqs.length > 0;
    
    const fmtMoney = (v: number) => '$' + v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const fmtKg = (v: number) => Math.round(v).toLocaleString() + ' KG';

    const OV_H = 110;
    const OV_W = 320;
    const OV_PAD_X = 20;
    const ovLabels = mqs.map(m => m.label);
    const ovPaid = mqs.map(m => m.paid);
    const ovRemaining = mqs.map(m => m.remaining);
    const ovMaxVal = Math.max(10, ...ovPaid, ...ovRemaining);
    const n = ovLabels.length || 1;

    const ovCoords = (values: number[]) =>
        values.map((v, i) => ({
            x: OV_PAD_X + i * ((OV_W - OV_PAD_X * 2) / Math.max(n - 1, 1)),
            y: OV_H - (v / ovMaxVal) * OV_H,
        }));

    const ovPath = (coords: { x: number; y: number }[]) => {
        if (coords.length === 0) return '';
        if (coords.length === 1) return `M ${coords[0].x} ${coords[0].y}`;
        let d = `M ${coords[0].x} ${coords[0].y}`;
        for (let i = 1; i < coords.length; i++) {
            const prev = coords[i - 1];
            const curr = coords[i];
            const cpx = prev.x + (curr.x - prev.x) / 2;
            d += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`;
        }
        return d;
    };

    const paidCoords = ovCoords(ovPaid);
    const remCoords = ovCoords(ovRemaining);
    const paidPath = ovPath(paidCoords);
    const remPath = ovPath(remCoords);

    return (
        <div className="w-full max-w-3xl mx-auto space-y-3 md:space-y-4">

            <style>{`
                @keyframes wordReveal {
                    0%, 5%  { opacity: 0; transform: translateY(8px); }
                    15%, 80% { opacity: 1; transform: translateY(0); }
                    90%, 100% { opacity: 0; transform: translateY(-4px); }
                }
                .gword {
                    display: inline-block;
                    opacity: 0;
                    animation: wordReveal 8s cubic-bezier(0.2,0.8,0.2,1) infinite;
                }
                @media (prefers-reduced-motion: reduce) {
                    .gword { animation: none !important; opacity: 1 !important; transform: none !important; }
                }
            `}</style>

            {/* ══════════════════════════════════════
                HERO HEADER
            ══════════════════════════════════════ */}
            <div className="relative rounded-2xl border border-border bg-card">
                <div className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none">
                    <AnimatedBackground />
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-blue-500/8" />
                </div>

                <div className="relative z-10 px-4 py-5 md:px-5">
                    <div className="flex items-start justify-between gap-3">

                        {/* LEFT: Avatar + Greeting */}
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                            {/* Clickable avatar */}
                            <div className="relative shrink-0" ref={menuRef}>
                                <button
                                    onClick={() => setShowProfileMenu(v => !v)}
                                    className="w-12 h-12 rounded-full border-2 border-white/20 shadow-lg overflow-hidden bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center active:scale-95 transition-transform"
                                    aria-label="Profile menu"
                                >
                                    {avatarUrl ? (
                                        <img src={avatarUrl} alt={username} className="w-full h-full object-cover" />
                                    ) : (
                                        <span className="text-white font-black text-lg">{avatarInitial}</span>
                                    )}
                                </button>

                                {/* Profile dropdown — logout only, compact */}
                                {showProfileMenu && (
                                    <div className="absolute top-14 left-0 z-[999] bg-card border border-border rounded-xl shadow-xl p-1.5 min-w-[130px] animate-in fade-in slide-in-from-top-2 duration-150">
                                        <button onClick={handleLogout}
                                            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors">
                                            <LogOut className="h-3.5 w-3.5 shrink-0" />
                                            <span className="text-xs font-bold">Logout</span>
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Greeting text */}
                            <div className="min-w-0 flex-1 pt-0.5">
                                {/* Line 1: "Good morning," — static, no animation needed */}
                                <p className="text-sm font-medium text-muted-foreground leading-tight">{greetingLine1}</p>
                                {/* Line 2: "Name 👋" — word-by-word animated */}
                                <h1 className="text-2xl md:text-3xl font-black text-foreground tracking-tight leading-tight flex flex-wrap items-center gap-x-1">
                                    {greetingLine2Parts.map((word, i) => (
                                        <span key={i} className="gword" style={{ animationDelay: `${i * 0.15}s` }}>
                                            {word}
                                        </span>
                                    ))}
                                </h1>
                                {/* Role badge */}
                                {roleBadgeLabel && (
                                    <span className="inline-flex items-center gap-1 mt-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-primary/15 text-primary border border-primary/30">
                                        <ShieldCheck className="w-2.5 h-2.5" />
                                        {roleBadgeLabel}
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* RIGHT: Icons + Date */}
                        <div className="flex flex-col items-end gap-2 shrink-0 pt-0.5">
                            {/* Icon buttons */}
                            <div className="flex items-center gap-2">
                                {isSuperAdmin ? (
                                    <div className="[&>button]:!h-10 [&>button]:!w-10 [&>button]:!rounded-xl [&>button]:!border [&>button]:!border-border/60 [&>button]:!bg-muted/80">
                                        <SecurityBell />
                                    </div>
                                ) : (
                                    <Link href="/settings"
                                        className="h-10 w-10 rounded-xl border border-border/60 bg-muted/80 flex items-center justify-center text-foreground hover:bg-muted transition-colors"
                                        title="Notifications">
                                        <Bell className="h-4.5 w-4.5" />
                                    </Link>
                                )}
                                <Link href="/settings"
                                    className="h-10 w-10 rounded-xl border border-border/60 bg-muted/80 flex items-center justify-center text-foreground hover:bg-muted transition-colors"
                                    title="Settings">
                                    <Settings className="h-4 w-4" />
                                </Link>
                            </div>
                            {/* Date — visible on all sizes */}
                            {dates.standard && (
                                <div className="flex flex-col items-end gap-0.5 pt-1 md:pt-0">
                                    <p className="text-[9px] md:text-[11px] font-semibold text-foreground/80 flex items-center gap-1">📅 {dates.standard}</p>
                                    {dates.hijri && <p className="text-[8px] md:text-[10px] text-muted-foreground flex items-center gap-1">🌙 {dates.hijri}</p>}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* ══════════════════════════════════════
                SEARCH
            ══════════════════════════════════════ */}
            <GlobalSearch />

            {/* ══════════════════════════════════════
                3 STAT CARDS — dark style, circular icons, sparklines
            ══════════════════════════════════════ */}
            <div className="grid grid-cols-3 gap-2 md:gap-3">

                {/* Card 1 — Active Customers */}
                <div className="rounded-2xl border border-border bg-card p-3 md:p-4 flex flex-col">
                    <div className="flex items-center gap-2 mb-1">
                        <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
                            <Users className="h-3.5 w-3.5 md:h-4 md:w-4 text-white" />
                        </div>
                        <span className="text-[9px] md:text-[10px] font-bold text-muted-foreground uppercase tracking-wide leading-tight line-clamp-2">Active Customers</span>
                    </div>
                    <p className="text-2xl sm:text-3xl md:text-4xl font-black text-foreground tabular-nums leading-none mt-1">
                        {data?.totalCustomers || 0}
                    </p>
                    <p className="text-[9px] md:text-[10px] text-emerald-500 font-semibold mt-1">Active accounts</p>
                    <BlueSparkline />
                </div>

                {/* Card 2 — Outstanding Debt */}
                <div className="rounded-2xl border border-border bg-card p-3 md:p-4 flex flex-col cursor-pointer"
                    onClick={() => window.location.href = '/reports?tab=debtors'}>
                    <div className="flex items-center gap-2 mb-1">
                        <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-emerald-600 flex items-center justify-center shrink-0">
                            <DollarSign className="h-3.5 w-3.5 md:h-4 md:w-4 text-white" />
                        </div>
                        <span className="text-[9px] md:text-[10px] font-bold text-muted-foreground uppercase tracking-wide leading-tight line-clamp-2">Outstanding Debt</span>
                    </div>
                    <p className="text-xl sm:text-2xl md:text-3xl font-black text-foreground tabular-nums leading-none mt-1 flex items-baseline gap-0.5">
                        <span className="text-xs md:text-sm text-muted-foreground font-semibold">$</span>
                        {totalCombinedDebt.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </p>
                    <p className="text-[9px] md:text-[10px] text-muted-foreground font-medium mt-1 line-clamp-1">
                        {data?.totalCustomers || 0} customers owing
                    </p>
                    <GreenSparkline />
                </div>

                {/* Card 3 — Today's Processing */}
                <div className="rounded-2xl border border-border bg-card p-3 md:p-4 flex flex-col">
                    <div className="flex items-center gap-2 mb-1">
                        <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-amber-600 flex items-center justify-center shrink-0">
                            <Zap className="h-3.5 w-3.5 md:h-4 md:w-4 text-white" />
                        </div>
                        <span className="text-[9px] md:text-[10px] font-bold text-muted-foreground uppercase tracking-wide leading-tight line-clamp-2">Today&apos;s Processing</span>
                    </div>
                    <p className="text-2xl sm:text-3xl md:text-4xl font-black text-foreground tabular-nums leading-none mt-1 flex items-baseline gap-1">
                        {Math.round(data?.todayKg || 0)}
                        <span className="text-[10px] md:text-sm text-muted-foreground font-semibold">kg</span>
                    </p>
                    <p className="text-[9px] md:text-[10px] text-muted-foreground font-medium mt-1">
                        {data?.todayCustomerCount || 0} active
                    </p>
                    <OrangeSparkline />
                </div>
            </div>

            {/* ══════════════════════════════════════
                NEEDS ATTENTION BANNER
            ══════════════════════════════════════ */}
            {hasAttention && (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
                            <AlertTriangle className="h-4 w-4 text-amber-500" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-bold text-foreground">Needs attention</p>
                            <p className="text-[11px] text-muted-foreground">{topDebtors.length} customers have high outstanding debt</p>
                        </div>
                    </div>
                    <Link href="/reports?tab=debtors"
                        className="text-xs font-bold text-amber-500 hover:text-amber-400 flex items-center gap-1 shrink-0 transition-colors">
                        View Overdue <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                </div>
            )}

            {/* ══════════════════════════════════════
                RECENT ACTIVITY + TOP OUTSTANDING  (side by side)
            ══════════════════════════════════════ */}
            <div className="grid grid-cols-2 gap-2 md:gap-3">

                {/* Recent Activity */}
                <div className="rounded-2xl border border-border bg-card p-3 md:p-4 min-w-0">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-xs md:text-sm font-bold text-foreground truncate mr-2">Recent Activity</h3>
                        <Link href="/daily-book" className="text-[10px] md:text-xs font-semibold text-primary hover:text-primary/80 transition-colors shrink-0">View all</Link>
                    </div>
                    {recentTx.length > 0 ? (
                        <div className="space-y-3">
                            {recentTx.map((tx: any, i: number) => {
                                const isPayment = tx.type === 'payment' || tx.amount != null;
                                const isKg = tx.kg != null;
                                const icon = isPayment
                                    ? <DollarSign className="h-3 w-3 md:h-3.5 md:w-3.5 text-white" />
                                    : isKg
                                        ? <BookOpen className="h-3 w-3 md:h-3.5 md:w-3.5 text-white" />
                                        : <UserPlus className="h-3 w-3 md:h-3.5 md:w-3.5 text-white" />;
                                const iconBg = isPayment ? 'bg-emerald-600' : isKg ? 'bg-amber-700' : 'bg-blue-700';
                                const label = isPayment
                                    ? `${tx.customer_name || tx.name || 'Customer'} paid $${(tx.amount || 0).toFixed(0)}`
                                    : isKg
                                        ? `${tx.customer_name || tx.name || 'Customer'} added ${tx.kg} kg`
                                        : tx.customer_name || tx.name || 'New customer registered';
                                const time = tx.created_at
                                    ? new Date(tx.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                                    : '';
                                return (
                                    <div key={i} className="flex items-center gap-2 md:gap-3 min-w-0">
                                        <div className={`w-6 h-6 md:w-8 md:h-8 rounded-lg md:rounded-xl ${iconBg} flex items-center justify-center shrink-0`}>
                                            {icon}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[11px] md:text-sm font-semibold text-foreground truncate">{label}</p>
                                            {time && <p className="text-[9px] md:text-[10px] text-muted-foreground">{time}</p>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 md:gap-3">
                                <div className="w-6 h-6 md:w-8 md:h-8 rounded-lg md:rounded-xl bg-emerald-600 flex items-center justify-center shrink-0">
                                    <Zap className="h-3 w-3 md:h-3.5 md:w-3.5 text-white" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[11px] md:text-sm font-semibold text-foreground truncate">{data?.todayCustomerCount || 0} customers active</p>
                                    <p className="text-[9px] md:text-[10px] text-muted-foreground">Today</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 md:gap-3">
                                <div className="w-6 h-6 md:w-8 md:h-8 rounded-lg md:rounded-xl bg-amber-700 flex items-center justify-center shrink-0">
                                    <TrendingUp className="h-3 w-3 md:h-3.5 md:w-3.5 text-white" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[11px] md:text-sm font-semibold text-foreground truncate">{Math.round(data?.todayKg || 0)} KG processed</p>
                                    <p className="text-[9px] md:text-[10px] text-muted-foreground">Today</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Top Outstanding */}
                <div className="rounded-2xl border border-border bg-card p-3 md:p-4 min-w-0">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-xs md:text-sm font-bold text-foreground truncate mr-2">Top Outstanding</h3>
                        <Link href="/reports?tab=debtors" className="text-[10px] md:text-xs font-semibold text-primary hover:text-primary/80 transition-colors shrink-0">View all</Link>
                    </div>
                    {topDebtors.length > 0 ? (
                        <div className="space-y-2 md:space-y-2.5">
                            {topDebtors.map((debtor) => (
                                <div key={debtor.id} className="flex items-center justify-between min-w-0">
                                    <p className="text-[11px] md:text-sm font-semibold text-foreground truncate mr-2">{debtor.name}</p>
                                    <span className="text-[11px] md:text-sm font-bold text-red-500 tabular-nums shrink-0">
                                        ${debtor.debt.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                    </span>
                                </div>
                            ))}
                            <Link href="/customers"
                                className="flex items-center justify-center gap-1 md:gap-1.5 text-[10px] md:text-xs font-bold text-primary hover:text-primary/80 transition-colors mt-2 md:mt-3 pt-2 md:pt-3 border-t border-border/50">
                                View All Customers <ArrowRight className="w-3 h-3 md:w-3.5 md:h-3.5" />
                            </Link>
                        </div>
                    ) : (
                        <p className="text-[11px] md:text-sm text-muted-foreground">No outstanding debt 🎉</p>
                    )}
                </div>
            </div>

            {/* ══════════════════════════════════════
                BUSINESS OVERVIEW — REAL DATA
            ══════════════════════════════════════ */}
            <div className="rounded-2xl border border-border bg-card p-4 md:p-5">
                {/* Header + Period Selector */}
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-foreground">Business Overview</h3>
                    <div className="flex gap-1 bg-muted rounded-lg p-0.5">
                        {(['week', 'month', 'year'] as const).map(p => (
                            <button
                                key={p}
                                onClick={() => setOverviewPeriod(p)}
                                className={`text-[10px] font-bold px-2.5 py-1 rounded-md transition-all ${
                                    overviewPeriod === p
                                        ? 'bg-card text-foreground shadow-sm'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                {p === 'week' ? 'Week' : p === 'month' ? 'Month' : 'Year'}
                            </button>
                        ))}
                    </div>
                </div>

                {overviewLoading ? (
                    <div className="flex items-center justify-center h-32">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                ) : !hasOverviewData ? (
                    <div className="flex flex-col items-center justify-center h-32 gap-2">
                        <TrendingUp className="h-7 w-7 text-muted-foreground/30" />
                        <p className="text-sm text-muted-foreground">No business activity for this period</p>
                        <Link href="/daily-book" className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors">View Daily Book →</Link>
                    </div>
                ) : (
                    <>
                        {/* ── Self-contained chart card ─────────────────────────────── */}
                        <div className="mb-2">
                            {/* Legend + Totals */}
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-2 h-2 rounded-full bg-blue-500" />
                                        <span className="text-[10px] font-semibold text-muted-foreground">Collected</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                                        <span className="text-[10px] font-semibold text-muted-foreground">Debt</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 text-right">
                                    <div>
                                        <p className="text-sm font-black text-blue-500 tabular-nums">{fmtMoney(ovTotals.paid)}</p>
                                        <p className="text-[9px] font-semibold text-muted-foreground">Collected</p>
                                    </div>
                                    <div>
                                        <p className="text-sm font-black text-emerald-500 tabular-nums">{fmtMoney(ovTotals.remaining)}</p>
                                        <p className="text-[9px] font-semibold text-muted-foreground">Outstanding</p>
                                    </div>
                                </div>
                            </div>

                            {/* SVG — lines + dots + MQ label + % all inside */}
                            <div className="relative w-full">
                                {/* Reserve space for bottom labels: chart H=110, labels below at y=130~150 */}
                                <svg
                                    viewBox={`0 -8 ${OV_W} 160`}
                                    className="w-full overflow-visible"
                                    style={{ height: 160 }}
                                    preserveAspectRatio="none"
                                >
                                    <defs>
                                        <linearGradient id="ovGP3" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.18" />
                                            <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
                                        </linearGradient>
                                        <linearGradient id="ovGR3" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#10b981" stopOpacity="0.15" />
                                            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                                        </linearGradient>
                                    </defs>

                                    {/* Gridlines */}
                                    {[0, 0.33, 0.66, 1].map((t, i) => (
                                        <line key={i}
                                            x1={OV_PAD_X} y1={OV_H * t} x2={OV_W - OV_PAD_X} y2={OV_H * t}
                                            stroke="currentColor" strokeOpacity="0.05" strokeWidth="1"
                                            strokeDasharray={i > 0 && i < 3 ? "3 3" : "0"} />
                                    ))}

                                    {/* Area fills */}
                                    {paidPath && <path d={`${paidPath} L ${paidCoords[paidCoords.length-1]?.x} ${OV_H} L ${paidCoords[0]?.x} ${OV_H} Z`} fill="url(#ovGP3)" />}
                                    {remPath && <path d={`${remPath} L ${remCoords[remCoords.length-1]?.x} ${OV_H} L ${remCoords[0]?.x} ${OV_H} Z`} fill="url(#ovGR3)" />}

                                    {/* Lines */}
                                    {paidPath && <path d={paidPath} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
                                    {remPath && <path d={remPath} fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}

                                    {/* Dots + inline MQ label + % for each MQ */}
                                    {paidCoords.map((c, i) => {
                                        const mq = mqs[i];
                                        if (!mq) return null;
                                        const isSelected = selectedDot === i;
                                        const shortLabel = mq.label.replace('MQ ', 'MQ').replace(' Aug', '\nAug');
                                        const pct = mq.paymentPercentage;
                                        const pctColor = pct >= 90 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
                                        return (
                                            <g key={`dot-${i}`} style={{ cursor: 'pointer' }}
                                                onClick={() => setSelectedDot(isSelected ? null : i)}>
                                                {/* Vertical tick line */}
                                                <line x1={c.x} y1={OV_H + 4} x2={c.x} y2={OV_H + 8}
                                                    stroke="currentColor" strokeOpacity="0.15" strokeWidth="1" />
                                                {/* MQ label */}
                                                <text x={c.x} y={OV_H + 18} fontSize="7.5" fill="currentColor"
                                                    fillOpacity="0.55" textAnchor="middle" fontWeight="700">
                                                    {mq.label.length > 8 ? mq.label.slice(0, 8) : mq.label}
                                                </text>
                                                {/* Payment % badge */}
                                                <text x={c.x} y={OV_H + 30} fontSize="8" fill={pctColor}
                                                    textAnchor="middle" fontWeight="900">
                                                    {pct}%
                                                </text>
                                                {/* Dot */}
                                                <circle cx={c.x} cy={c.y} r={isSelected ? 6 : 4}
                                                    fill="#2563eb"
                                                    stroke={isSelected ? '#fff' : '#2563eb'}
                                                    strokeWidth={isSelected ? 2 : 0} />
                                            </g>
                                        );
                                    })}
                                </svg>

                                {/* Inline detail panel — opens below chart when dot tapped */}
                                {selectedDot !== null && mqs[selectedDot] && (
                                    <div className="mt-2 p-3 rounded-xl border border-primary/30 bg-primary/5 animate-in slide-in-from-top-1 duration-150">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-xs font-black text-foreground">{mqs[selectedDot].label}</span>
                                            <button onClick={() => setSelectedDot(null)}
                                                className="text-[10px] text-muted-foreground hover:text-foreground font-bold px-2 py-0.5 rounded-md hover:bg-muted transition-colors">✕</button>
                                        </div>
                                        <div className="grid grid-cols-4 gap-2 mb-2">
                                            <div className="bg-card rounded-lg p-2 border border-border/40 text-center">
                                                <p className="text-[9px] font-semibold text-muted-foreground mb-0.5">KG</p>
                                                <p className="text-[11px] font-black text-foreground tabular-nums">{fmtKg(mqs[selectedDot].kg)}</p>
                                            </div>
                                            <div className="bg-card rounded-lg p-2 border border-border/40 text-center">
                                                <p className="text-[9px] font-semibold text-muted-foreground mb-0.5">Expected</p>
                                                <p className="text-[11px] font-black text-foreground tabular-nums">{fmtMoney(mqs[selectedDot].expected)}</p>
                                            </div>
                                            <div className="bg-card rounded-lg p-2 border border-border/40 text-center">
                                                <p className="text-[9px] font-semibold text-muted-foreground mb-0.5">Paid</p>
                                                <p className="text-[11px] font-black text-blue-500 tabular-nums">{fmtMoney(mqs[selectedDot].paid)}</p>
                                            </div>
                                            <div className="bg-card rounded-lg p-2 border border-border/40 text-center">
                                                <p className="text-[9px] font-semibold text-muted-foreground mb-0.5">Rem</p>
                                                <p className="text-[11px] font-black text-amber-500 tabular-nums">{fmtMoney(mqs[selectedDot].remaining)}</p>
                                            </div>
                                        </div>
                                        {mqs[selectedDot].customers.length > 0 && (
                                            <div className="space-y-1">
                                                {mqs[selectedDot].customers.slice(0, 5).map(c => (
                                                    <Link key={c.id} href={`/customers/${c.id}`}
                                                        className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-card border border-transparent hover:border-border/40 transition-colors">
                                                        <span className="text-[11px] font-semibold text-foreground truncate max-w-[130px]">{c.name}</span>
                                                        <div className="flex items-center gap-2 text-[10px] font-bold shrink-0">
                                                            <span className="text-blue-500">{fmtMoney(c.paid)}</span>
                                                            {c.remaining > 0 && <span className="text-amber-500">{fmtMoney(c.remaining)} owed</span>}
                                                        </div>
                                                    </Link>
                                                ))}
                                                {mqs[selectedDot].customers.length > 5 && (
                                                    <p className="text-[10px] text-muted-foreground text-center pt-1">
                                                        +{mqs[selectedDot].customers.length - 5} more
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </>

                )}
            </div>

            {/* Admin Egress Monitor */}
            <div className="flex justify-center pb-2 pt-2">
                <Link href="/api/egress-stats" target="_blank"
                    className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground/40 hover:text-muted-foreground transition-colors">
                    <Activity className="h-3 w-3" />
                    <span>Egress Monitor</span>
                </Link>
            </div>

        </div>
    );
}
