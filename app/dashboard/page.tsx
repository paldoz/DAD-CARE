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
import { subscribeToDailyDates } from '@/lib/hijri-date';
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
        dateRange?: string;
        startDate?: string;
        endDate?: string;
        kg: number;
        expected: number;
        paid: number;
        remaining: number;
        overpaid?: number;
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
            overpaid?: number;
            paymentPct?: number;
            payments: {
                id: string;
                date: string;
                amount: number;
                receiptId: string | null;
                maqalId: number | null;
                note: string | null;
            }[];
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
    const [overviewPeriod, setOverviewPeriod] = useState<'week' | 'month' | 'year' | 'all'>('all');
    const [expandedMqDetail, setExpandedMqDetail] = useState<boolean>(false);
    const [selectedDot, setSelectedDot] = useState<number | null>(null);
    const [paymentDrillDown, setPaymentDrillDown] = useState<{ mqLabel: string; mqDateRange: string; customers: MqAnalyticsData['mqs'][0]['customers'] } | null>(null);
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
        // Use the shared hijri-date utility — same as sidebar & customers page
        // This correctly maps numeric months to Arabic Hijri month names (Saudi Arabia Umm al-Qura)
        const unsub = subscribeToDailyDates((standard, hijri) => {
            setDates({ standard, hijri });
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
            unsub();
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

    // ── Scrollable chart constants ──────────────────────────────────────────
    // Each MQ column gets COL_W px. The chart scrolls horizontally.
    const OV_H = 110;              // chart draw area height (px in SVG units)
    const COL_W = 60;             // px per MQ column — generous spacing
    const OV_PAD_X = COL_W / 2;  // first/last dot centred in their column
    const ovPaid = mqs.map(m => m.paid);
    const ovRemaining = mqs.map(m => m.remaining);
    const ovMaxVal = Math.max(10, ...ovPaid, ...ovRemaining);
    const n = mqs.length || 1;
    const OV_W = COL_W * n;       // total SVG width — grows with MQ count

    const ovCoords = (values: number[]) =>
        values.map((v, i) => ({
            x: OV_PAD_X + i * COL_W,
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
                                {/* Line 1: "Good morning," — word-by-word animated */}
                                <p className="text-sm font-medium text-muted-foreground leading-tight flex flex-wrap items-center gap-x-1">
                                    {greetingLine1.split(' ').map((word, i) => (
                                        <span key={`l1-${i}`} className="gword" style={{ animationDelay: `${i * 0.15}s` }}>
                                            {word}
                                        </span>
                                    ))}
                                </p>
                                {/* Line 2: "Name 👋" — word-by-word animated */}
                                <h1 className="text-2xl md:text-3xl font-black text-foreground tracking-tight leading-tight flex flex-wrap items-center gap-x-1">
                                    {greetingLine2Parts.map((word, i) => (
                                        <span key={`l2-${i}`} className="gword" style={{ animationDelay: `${(greetingLine1.split(' ').length + i) * 0.15}s` }}>
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
                                const isPayment = tx.type === 'PAYMENT';
                                const isProduct = tx.type === 'PRODUCT';
                                const icon = isPayment
                                    ? <DollarSign className="h-3 w-3 md:h-3.5 md:w-3.5 text-white" />
                                    : isProduct
                                        ? <BookOpen className="h-3 w-3 md:h-3.5 md:w-3.5 text-white" />
                                        : <UserPlus className="h-3 w-3 md:h-3.5 md:w-3.5 text-white" />;
                                const iconBg = isPayment ? 'bg-emerald-600' : isProduct ? 'bg-amber-700' : 'bg-blue-700';
                                const label = isPayment
                                    ? `${tx.customer_name || 'Customer'} paid $${(tx.amount || 0).toFixed(0)}`
                                    : isProduct
                                        ? `${tx.customer_name || 'Customer'} — ${(tx.kg || 0).toFixed(1)} kg`
                                        : tx.customer_name || 'New customer';

                                // Business date selected by user when entering the transaction
                                const businessDate = tx.reference_date
                                    ? new Date(tx.reference_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                                    : null;

                                // Actual entry time
                                const entryTime = tx.created_at
                                    ? new Date(tx.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                                    : null;

                                const mqLabel = tx.maqal_id ? `MQ#${tx.maqal_id}` : null;

                                return (
                                    <div key={tx.id ?? i} className="flex items-start gap-2 md:gap-3 min-w-0">
                                        <div className={`w-6 h-6 md:w-8 md:h-8 rounded-lg md:rounded-xl ${iconBg} flex items-center justify-center shrink-0 mt-0.5`}>
                                            {icon}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-[11px] md:text-sm font-semibold text-foreground truncate">{label}</p>
                                            <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                                {mqLabel && (
                                                    <span className="text-[9px] font-black text-primary/80 bg-primary/10 rounded px-1 py-0.5">{mqLabel}</span>
                                                )}
                                                {businessDate && (
                                                    <span className="text-[9px] md:text-[10px] font-semibold text-foreground/70">{businessDate}</span>
                                                )}
                                                {entryTime && (
                                                    <span className="text-[9px] md:text-[10px] text-muted-foreground">· entered {entryTime}</span>
                                                )}
                                            </div>
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
                        {(['all', 'year', 'month', 'week'] as const).map(p => (
                            <button
                                key={p}
                                onClick={() => { setOverviewPeriod(p); setSelectedDot(null); setExpandedMqDetail(false); }}
                                className={`text-[10px] font-bold px-2.5 py-1 rounded-md transition-all ${
                                    overviewPeriod === p
                                        ? 'bg-card text-foreground shadow-sm'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                {p === 'all' ? 'All' : p === 'week' ? 'Week' : p === 'month' ? 'Month' : 'Year'}
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
                        {/* ── Totals summary row ── */}
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                                    <span className="text-[10px] font-semibold text-muted-foreground">Collected</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full bg-red-400" />
                                    <span className="text-[10px] font-semibold text-muted-foreground">Debt</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-4 text-right">
                                <div>
                                    <p className="text-sm font-black text-blue-500 tabular-nums">{fmtMoney(ovTotals.paid)}</p>
                                    <p className="text-[9px] font-semibold text-muted-foreground">Total Collected</p>
                                </div>
                                <div>
                                    <p className="text-sm font-black text-red-400 tabular-nums">{fmtMoney(ovTotals.remaining)}</p>
                                    <p className="text-[9px] font-semibold text-muted-foreground">Outstanding</p>
                                </div>
                            </div>
                        </div>

                        {/* ── Scrollable line chart ── */}
                        <div className="relative w-full mb-3">
                            {/* Hint label */}
                            <p className="text-[9px] text-muted-foreground text-center mb-2 flex items-center justify-center gap-1">
                                <span>← Swipe to explore MQs →</span>
                            </p>

                            {/* Scroll container */}
                            <div
                                className="overflow-x-auto pb-1 rounded-xl"
                                style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}
                            >
                                {/* Inner container — width grows with MQ count */}
                                <div style={{ minWidth: OV_W, position: 'relative' }}>

                                    {/* SVG line chart */}
                                    <svg
                                        viewBox={`0 -8 ${OV_W} ${OV_H + 8}`}
                                        width={OV_W}
                                        height={OV_H + 8}
                                        style={{ display: 'block', overflow: 'visible' }}
                                        preserveAspectRatio="none"
                                    >
                                        <defs>
                                            <linearGradient id="ovGP5" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#2563eb" stopOpacity="0.2" />
                                                <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
                                            </linearGradient>
                                            <linearGradient id="ovGR5" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#f87171" stopOpacity="0.15" />
                                                <stop offset="100%" stopColor="#f87171" stopOpacity="0" />
                                            </linearGradient>
                                        </defs>

                                        {/* Gridlines */}
                                        {[0, 0.25, 0.5, 0.75, 1].map((t, gi) => (
                                            <line key={gi}
                                                x1={OV_PAD_X} y1={OV_H * t}
                                                x2={OV_W - OV_PAD_X} y2={OV_H * t}
                                                stroke="currentColor" strokeOpacity="0.05" strokeWidth="1"
                                                strokeDasharray={gi > 0 ? '3 5' : '0'} />
                                        ))}

                                        {/* Area fills */}
                                        {paidPath && <path d={`${paidPath} L ${paidCoords[paidCoords.length-1]?.x} ${OV_H} L ${paidCoords[0]?.x} ${OV_H} Z`} fill="url(#ovGP5)" />}
                                        {remPath && <path d={`${remPath} L ${remCoords[remCoords.length-1]?.x} ${OV_H} L ${remCoords[0]?.x} ${OV_H} Z`} fill="url(#ovGR5)" />}

                                        {/* Lines */}
                                        {paidPath && <path d={paidPath} fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
                                        {remPath && <path d={remPath} fill="none" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}

                                        {/* Dots only — labels live in HTML below */}
                                        {paidCoords.map((c, i) => {
                                            const mq = mqs[i];
                                            if (!mq) return null;
                                            const isSelected = selectedDot === i;
                                            return (
                                                <g key={`dot-${i}`} style={{ cursor: 'pointer' }}
                                                    onClick={() => { setSelectedDot(isSelected ? null : i); setExpandedMqDetail(false); }}>
                                                    {isSelected && <circle cx={c.x} cy={c.y} r={12} fill="#2563eb" fillOpacity="0.15" />}
                                                    <circle cx={c.x} cy={c.y} r={isSelected ? 6 : 4}
                                                        fill={isSelected ? '#fff' : '#2563eb'}
                                                        stroke="#2563eb" strokeWidth={isSelected ? 2.5 : 1.5} />
                                                    {/* Tick down to label row */}
                                                    <line x1={c.x} y1={OV_H} x2={c.x} y2={OV_H + 6}
                                                        stroke="currentColor" strokeOpacity="0.15" strokeWidth="1" />
                                                </g>
                                            );
                                        })}
                                    </svg>

                                    {/* HTML labels row — one per MQ, perfectly aligned with dots */}
                                    <div style={{ display: 'flex', width: OV_W }}>
                                        {mqs.map((mq, i) => {
                                            const isSelected = selectedDot === i;
                                            const pct = mq.paymentPercentage;
                                            const pctColor = pct >= 90 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#ef4444';
                                            return (
                                                <button
                                                    key={mq.id}
                                                    onClick={() => { setSelectedDot(isSelected ? null : i); setExpandedMqDetail(false); }}
                                                    style={{ width: COL_W, flexShrink: 0 }}
                                                    className={`flex flex-col items-center pt-1 pb-2 transition-all ${
                                                        isSelected
                                                            ? 'bg-primary/8 rounded-xl'
                                                            : 'hover:bg-muted/60 rounded-xl'
                                                    }`}
                                                >
                                                    <span
                                                        className="text-[9px] font-bold leading-tight"
                                                        style={{ color: isSelected ? '#2563eb' : undefined, opacity: isSelected ? 1 : 0.65 }}
                                                    >
                                                        {mq.label}
                                                    </span>
                                                    <span
                                                        className="text-[10px] font-black leading-tight mt-0.5"
                                                        style={{ color: pctColor }}
                                                    >
                                                        {Math.round(pct)}%
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>

                                </div>{/* end inner */}
                            </div>{/* end scroll container */}

                            {/* Right-edge fade — visual hint that content scrolls */}
                            <div className="pointer-events-none absolute top-0 right-0 bottom-0 w-10 rounded-r-xl"
                                style={{ background: 'linear-gradient(to right, transparent, var(--card, #fff) 90%)' }} />
                        </div>

                        {/* ── Detail panel — appears when a dot is tapped ── */}
                        {selectedDot !== null && mqs[selectedDot] && (() => {
                            const mq = mqs[selectedDot];
                            const pct = mq.paymentPercentage;
                            const pctColor = pct >= 90 ? 'text-emerald-500' : pct >= 60 ? 'text-amber-500' : 'text-red-500';
                            const barColor = pct >= 90 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-500';
                            const debtCustomers = mq.customers.filter((c: any) => c.remaining > 0);
                            return (
                                <div className="mt-1 rounded-2xl border border-primary/30 bg-gradient-to-b from-primary/5 to-transparent overflow-hidden animate-in slide-in-from-top-2 duration-200">
                                    {/* Panel header */}
                                    <div className="flex items-center justify-between px-4 pt-3 pb-2">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-base font-black text-foreground">{mq.label}</span>
                                                {mq.dateRange && (
                                                    <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                                                        📅 {mq.dateRange}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className="text-[10px] font-semibold text-muted-foreground">⚖️ {fmtKg(mq.kg)}</span>
                                                <span className="text-[10px] font-semibold text-muted-foreground">•</span>
                                                <span className="text-[10px] font-semibold text-muted-foreground">{mq.customerCount} customers</span>
                                            </div>
                                        </div>
                                        <button onClick={() => { setSelectedDot(null); setExpandedMqDetail(false); }}
                                            className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors text-xs font-black">✕</button>
                                    </div>

                                    {/* Progress bar */}
                                    <div className="px-4 mb-3">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-[10px] font-semibold text-muted-foreground">Payment Progress</span>
                                            <span className={`text-sm font-black ${pctColor}`}>{pct}%</span>
                                        </div>
                                        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                                            <div className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${pct}%` }} />
                                        </div>
                                    </div>

                                    {/* Money stats grid */}
                                    <div className="grid grid-cols-3 gap-2 px-4 mb-3">
                                        <div className="bg-card rounded-xl p-2.5 border border-border/40 text-center">
                                            <p className="text-[9px] font-semibold text-muted-foreground mb-0.5">Expected</p>
                                            <p className="text-xs font-black text-foreground tabular-nums">{fmtMoney(mq.expected)}</p>
                                        </div>
                                        <button
                                            onClick={() => setPaymentDrillDown({ mqLabel: mq.label, mqDateRange: mq.dateRange || '', customers: mq.customers })}
                                            className="bg-card rounded-xl p-2.5 border border-primary/40 text-center hover:bg-primary/5 active:scale-95 transition-all cursor-pointer group"
                                            title="Tap to see payment breakdown"
                                        >
                                            <p className="text-[9px] font-semibold text-muted-foreground mb-0.5 group-hover:text-primary transition-colors">Collected 👆</p>
                                            <p className="text-xs font-black text-blue-500 tabular-nums">{fmtMoney(mq.paid)}</p>
                                        </button>
                                        <div className="bg-card rounded-xl p-2.5 border border-border/40 text-center">
                                            <p className="text-[9px] font-semibold text-muted-foreground mb-0.5">Remaining</p>
                                            <p className={`text-xs font-black tabular-nums ${mq.remaining > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>{fmtMoney(mq.remaining)}</p>
                                        </div>
                                    </div>

                                    {/* Customer section */}
                                    <div className="border-t border-border/40 px-4 py-3">
                                        <button
                                            onClick={() => setExpandedMqDetail(!expandedMqDetail)}
                                            className="w-full flex items-center justify-between"
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="text-[11px] font-bold text-foreground">
                                                    {debtCustomers.length > 0
                                                        ? `${debtCustomers.length} customers with debt`
                                                        : '✅ All customers paid in full'}
                                                </span>
                                                {debtCustomers.length > 0 && (
                                                    <span className="text-[10px] font-bold text-amber-500">{fmtMoney(mq.remaining)} total owed</span>
                                                )}
                                            </div>
                                            {debtCustomers.length > 0 && (
                                                <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${expandedMqDetail ? 'rotate-90' : ''}`} />
                                            )}
                                        </button>

                                        {expandedMqDetail && debtCustomers.length > 0 && (
                                            <div className="mt-2 space-y-1.5">
                                                {debtCustomers.map((c: any) => {
                                                    const cPct = c.expected > 0 ? Math.min(100, Math.round((c.paid / c.expected) * 100)) : (c.paid > 0 ? 100 : 0);
                                                    const cBarColor = cPct >= 90 ? 'bg-emerald-500' : cPct >= 60 ? 'bg-amber-500' : 'bg-red-500';
                                                    const cTextColor = cPct >= 90 ? 'text-emerald-500' : cPct >= 60 ? 'text-amber-500' : 'text-red-500';
                                                    return (
                                                        <Link key={c.id} href={`/customers/${c.id}`}
                                                            className="flex items-center gap-2.5 p-2.5 rounded-xl bg-card border border-border/40 hover:border-primary/40 transition-colors group">
                                                            <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0 text-[10px] font-black text-muted-foreground">
                                                                {c.name.charAt(0).toUpperCase()}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <p className="text-[11px] font-bold text-foreground truncate">{c.name}</p>
                                                                <div className="flex items-center gap-1.5 mt-0.5">
                                                                    <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                                                                        <div className={`h-full ${cBarColor} rounded-full`} style={{ width: `${cPct}%` }} />
                                                                    </div>
                                                                    <span className={`text-[9px] font-black shrink-0 ${cTextColor}`}>{cPct}%</span>
                                                                </div>
                                                            </div>
                                                            <div className="text-right shrink-0">
                                                                <p className="text-[10px] font-bold text-blue-500">{fmtMoney(c.paid)}</p>
                                                                <p className="text-[9px] font-bold text-amber-500">{fmtMoney(c.remaining)} owed</p>
                                                            </div>
                                                            <ChevronRight className="w-3 h-3 text-muted-foreground/30 group-hover:text-primary shrink-0" />
                                                        </Link>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })()}

                        {/* ── Payment drill-down bottom sheet ── */}
                        {paymentDrillDown && (
                            <div
                                className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
                                onClick={() => setPaymentDrillDown(null)}
                            >
                                <div
                                    className="w-full max-w-lg bg-card rounded-t-3xl border-t border-border shadow-2xl max-h-[80vh] flex flex-col animate-in slide-in-from-bottom-4 duration-300"
                                    onClick={e => e.stopPropagation()}
                                >
                                    {/* Sheet header */}
                                    <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border/50 shrink-0">
                                        <div>
                                            <p className="text-base font-black text-foreground">{paymentDrillDown.mqLabel} — Collected Payments</p>
                                            {paymentDrillDown.mqDateRange && (
                                                <p className="text-[11px] text-muted-foreground">📅 {paymentDrillDown.mqDateRange}</p>
                                            )}
                                        </div>
                                        <button onClick={() => setPaymentDrillDown(null)}
                                            className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors text-sm font-black">
                                            ✕
                                        </button>
                                    </div>

                                    {/* Payment list */}
                                    <div className="overflow-y-auto flex-1 px-5 py-3 space-y-4">
                                        {paymentDrillDown.customers
                                            .filter((c: any) => c.payments && c.payments.length > 0)
                                            .map((c: any) => (
                                                <div key={c.id}>
                                                    {/* Customer header */}
                                                    <div className="flex items-center justify-between mb-1.5">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center text-[10px] font-black text-primary shrink-0">
                                                                {c.name.charAt(0).toUpperCase()}
                                                            </div>
                                                            <span className="text-[12px] font-bold text-foreground">{c.name}</span>
                                                        </div>
                                                        <span className="text-[11px] font-black text-blue-500">
                                                            {fmtMoney(c.payments.reduce((s: number, p: any) => s + p.amount, 0))}
                                                        </span>
                                                    </div>
                                                    {/* Payment rows */}
                                                    <div className="space-y-1 pl-8">
                                                        {c.payments.map((pay: any) => (
                                                            <div key={pay.id} className="flex items-start justify-between gap-2 text-[10px] py-1 border-b border-border/30">
                                                                <div className="min-w-0">
                                                                    <p className="font-semibold text-foreground">
                                                                        {new Date(pay.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                                    </p>
                                                                    <p className="text-muted-foreground">
                                                                        {pay.maqalId ? `MQ ID: ${pay.maqalId}` : pay.receiptId ? `Receipt: ${String(pay.receiptId).slice(0, 8)}…` : 'No link'}
                                                                    </p>
                                                                    {pay.note && <p className="text-muted-foreground italic truncate">{pay.note}</p>}
                                                                </div>
                                                                <span className="font-black text-blue-500 shrink-0">{fmtMoney(pay.amount)}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        {paymentDrillDown.customers.every((c: any) => !c.payments || c.payments.length === 0) && (
                                            <p className="text-sm text-muted-foreground text-center py-8">No payments recorded for this Maqal yet.</p>
                                        )}
                                    </div>

                                    {/* Sheet footer — total */}
                                    <div className="px-5 py-4 border-t border-border/50 shrink-0 flex items-center justify-between bg-muted/30">
                                        <span className="text-xs font-bold text-muted-foreground">Total Collected</span>
                                        <span className="text-base font-black text-blue-500">
                                            {fmtMoney(paymentDrillDown.customers.reduce((s: number, c: any) => s + (c.payments || []).reduce((ps: number, p: any) => ps + p.amount, 0), 0))}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}
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
