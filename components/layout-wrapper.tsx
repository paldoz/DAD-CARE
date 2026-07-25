'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import { AppSidebar } from './app-sidebar';
import { MobileNav } from './mobile-nav';
import { LogOut, ChevronDown } from 'lucide-react';
import { logout } from '@/lib/session';
import { subscribeToDailyDates } from '@/lib/hijri-date';
import { IdleMonitor } from './idle-monitor';
import { SecurityBell } from '@/components/security-bell';

export function LayoutWrapper({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
    const [currentUser, setCurrentUser] = useState<any>(null);
    const [dates, setDates] = useState({ standard: '', hijri: '' });
    const [showProfileMenu, setShowProfileMenu] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    // Guard: only run SUPER_ADMIN background prefetch once per session mount
    const hasFetchedAdminDataRef = useRef(false);

    useEffect(() => {
        const storedUser = localStorage.getItem('currentUser');
        if (storedUser) {
            try {
                setCurrentUser(JSON.parse(storedUser));
            } catch (e) { }
        }
        const loggedIn = !!storedUser;
        setIsAuthenticated(loggedIn);

        if (!loggedIn && pathname !== '/login') {
            router.replace('/login');
        } else if (loggedIn && pathname === '/login') {
            router.replace('/dashboard');
        }

        // Compute dates — updates automatically at midnight
        const unsub = subscribeToDailyDates((standard, hijri) => {
            setDates({ standard, hijri });
        });
        return () => unsub();
    }, [pathname, router]);

    // ── Global Heartbeat Completely Disabled ──
    // Eliminates all background egress and network calls
    useEffect(() => {
        // Disabled to guarantee 0.00 Egress in background.
    }, [currentUser]);

    // Close popup when clicking outside
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setShowProfileMenu(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const handleLogout = async () => {
        setShowProfileMenu(false);
        await logout();
        // Note: supabase.auth.signOut() removed — this app uses a custom session system,
        // not Supabase Auth, so the call was hitting the Auth API unnecessarily.
        window.location.href = '/login';
    };

    const isLoginPage = pathname === '/login';

    // Show a premium themed security verification screen during state changes/checks
    if (isAuthenticated === null || (!isAuthenticated && !isLoginPage) || (isAuthenticated && isLoginPage)) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-background">
                <div className="flex flex-col items-center gap-4">
                    <div className="relative">
                        <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
                        <div className="relative w-16 h-16 rounded-2xl overflow-hidden bg-primary/10 shadow-lg">
                            <img src="/icons/icon-192.png" alt="DADWORK" className="w-full h-full object-cover" />
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground uppercase font-black tracking-widest animate-pulse">
                        Securing session...
                    </p>
                </div>
            </div>
        );
    }

    if (isLoginPage) {
        return <>{children}</>;
    }

    return (
        <div className="flex h-full bg-background">
            {/* Desktop Sidebar */}
            <aside className="hidden md:block">
                <AppSidebar />
            </aside>

            {/* Main Content */}
            <main className="flex-1 min-w-0 overflow-y-auto p-4 md:p-8 pb-safe">
                {/* Mobile Header Profile */}
                {currentUser && (
                    <div className="md:hidden flex items-center justify-between mb-4 border-b border-border/50 pb-3">
                        <div className="flex items-center gap-3">
                            {/* Clickable Avatar → Logout Popup */}
                            <div className="relative" ref={menuRef}>
                                <button
                                    onClick={() => setShowProfileMenu(v => !v)}
                                    className="w-10 h-10 rounded-xl border-2 border-primary/20 shadow-sm shrink-0 overflow-hidden bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center active:scale-95 transition-transform"
                                >
                                    {currentUser?.avatar_url ? (
                                        <img src={currentUser.avatar_url} alt={currentUser.name} className="w-full h-full object-cover" />
                                    ) : (
                                        <span className="text-primary-foreground font-black text-sm">
                                            {currentUser?.name ? currentUser.name.charAt(0).toUpperCase() : 'D'}
                                        </span>
                                    )}
                                </button>

                                {/* Logout Popup */}
                                {showProfileMenu && (
                                    <div className="absolute top-12 left-0 z-[100] bg-card border border-border rounded-2xl shadow-2xl p-3 min-w-[200px] animate-in fade-in slide-in-from-top-2 duration-200">
                                        {/* User info inside popup */}
                                        <div className="px-2 pb-2 mb-2 border-b border-border/50">
                                            <p className="text-xs font-black uppercase tracking-widest text-foreground">{currentUser?.name || 'DADWORK'}</p>
                                            <p className="text-[9px] font-bold tracking-widest uppercase text-muted-foreground mt-0.5">
                                                {currentUser?.role ? currentUser.role.replace('_', ' ') : 'Admin'}
                                            </p>
                                        </div>
                                        <button
                                            onClick={handleLogout}
                                            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-red-500 hover:bg-red-500/10 transition-colors active:scale-[0.98]"
                                        >
                                            <LogOut className="h-4 w-4 shrink-0" />
                                            <span className="text-sm font-bold">Logout</span>
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Name, Role, and Dates */}
                            <div className="flex flex-col">
                                <h1 className="text-sm font-black tracking-tight text-foreground uppercase leading-tight">
                                    {currentUser?.name || 'DADWORK'}
                                </h1>
                                <p className="text-[9px] text-muted-foreground font-bold tracking-widest uppercase flex items-center gap-1 mt-0.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 animate-pulse"></span>
                                    {currentUser?.role ? currentUser.role.replace('_', ' ') : 'Admin'}
                                </p>
                                {dates.standard && (
                                    <div className="relative w-full max-w-[130px] h-[28px] overflow-hidden mt-0.5 border-t border-border/40 pt-1">
                                        <div className="animate-kinetic !flex-col !items-start !justify-center gap-0 w-max">
                                            <p className="text-[9px] font-black tracking-widest uppercase text-primary/80 whitespace-nowrap animate-lightning">
                                                📅 {dates.standard}
                                            </p>
                                            <p className="text-[8px] font-bold tracking-widest uppercase text-emerald-600/80 dark:text-emerald-400/80 whitespace-nowrap">
                                                🌙 {dates.hijri}
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                        {currentUser?.role === 'SUPER_ADMIN' && <SecurityBell />}
                    </div>
                )}
                <IdleMonitor />
                {children}
            </main>

            {/* Mobile Bottom Nav */}
            <MobileNav />
        </div>
    );
}

