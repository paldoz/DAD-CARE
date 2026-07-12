'use client';

import {
    LayoutDashboard,
    BookOpen,
    Library,
    CreditCard,
    Menu,
    Users,
    BarChart3,
    Settings,
    LogOut,
    X,
    Sun,
    Moon,
    Sparkles
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { logout } from '@/lib/session';

const mainTabs = [
    { href: '/dashboard', label: 'Home', icon: LayoutDashboard },
    { href: '/daily-book', label: 'Maalinle', icon: BookOpen },
    { href: '/ledger', label: 'Maqalka', icon: Library },
    { href: '/customers', label: 'Customers', icon: Users },
];

const moreItems = [
    { href: '/payments', label: 'Lacagaha', icon: CreditCard, desc: 'Manage payments' },
    { href: '/reports', label: 'Reports', icon: BarChart3, desc: 'Analytics & insights' },
    { href: '/settings', label: 'Settings', icon: Settings, desc: 'App preferences' },
];

export function MobileNav() {
    const pathname = usePathname();
    const router = useRouter();
    const { theme, setTheme } = useTheme();
    const [showMore, setShowMore] = useState(false);
    const supabase = createClient();

    const handleLogout = async () => {
        await logout();
        await supabase.auth.signOut();
        router.push('/login');
    };

    const isMoreActive = moreItems.some(
        item => pathname === item.href || pathname?.startsWith(`${item.href}/`)
    );

    return (
        <>
            {/* Bottom Tab Bar - Premium Glass Design */}
            <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden">
                {/* Glass background */}
                <div className="bg-card/90 backdrop-blur-2xl border-t border-border/50 shadow-[0_-4px_30px_rgba(0,0,0,0.1)]">
                    <div className="flex items-center justify-around h-[68px] px-2 max-w-md mx-auto">
                        {mainTabs.map((tab) => {
                            const isActive = pathname === tab.href || pathname?.startsWith(`${tab.href}/`);
                            return (
                                <Link
                                    key={tab.href}
                                    href={tab.href}
                                    prefetch={false}
                                    className={cn(
                                        'relative flex flex-col items-center justify-center gap-1 w-full h-full rounded-2xl transition-all duration-300 active:scale-90',
                                        isActive
                                            ? 'text-primary'
                                            : 'text-muted-foreground/70'
                                    )}
                                >
                                    {/* Active indicator glow */}
                                    {isActive && (
                                        <div className="absolute -top-[1px] left-1/2 -translate-x-1/2 w-8 h-[3px] bg-gradient-to-r from-primary/0 via-primary to-primary/0 rounded-full" />
                                    )}
                                    <div className={cn(
                                        'relative p-1.5 rounded-xl transition-all duration-300',
                                        isActive && 'bg-primary/10'
                                    )}>
                                        <tab.icon className={cn(
                                            'h-[22px] w-[22px] transition-all duration-300',
                                            isActive && 'scale-110'
                                        )} />
                                    </div>
                                    <span className={cn(
                                        'text-[10px] leading-none transition-all duration-300',
                                        isActive ? 'font-bold' : 'font-medium'
                                    )}>
                                        {tab.label}
                                    </span>
                                </Link>
                            );
                        })}

                        {/* More Button */}
                        <button
                            onClick={() => setShowMore(true)}
                            className={cn(
                                'relative flex flex-col items-center justify-center gap-1 w-full h-full rounded-2xl transition-all duration-300 active:scale-90',
                                isMoreActive
                                    ? 'text-primary'
                                    : 'text-muted-foreground/70'
                            )}
                        >
                            {isMoreActive && (
                                <div className="absolute -top-[1px] left-1/2 -translate-x-1/2 w-8 h-[3px] bg-gradient-to-r from-primary/0 via-primary to-primary/0 rounded-full" />
                            )}
                            <div className={cn(
                                'relative p-1.5 rounded-xl transition-all duration-300',
                                isMoreActive && 'bg-primary/10'
                            )}>
                                <Menu className={cn(
                                    'h-[22px] w-[22px]',
                                    isMoreActive && 'scale-110'
                                )} />
                            </div>
                            <span className={cn(
                                'text-[10px] leading-none',
                                isMoreActive ? 'font-bold' : 'font-medium'
                            )}>
                                More
                            </span>
                        </button>
                    </div>
                </div>
            </nav>

            {/* More Menu Overlay - Premium Sheet */}
            {showMore && (
                <div className="fixed inset-0 z-[60] md:hidden">
                    {/* Backdrop */}
                    <div
                        className="absolute inset-0 bg-black/5 dark:bg-black/20 backdrop-blur-[2px]"
                        onClick={() => setShowMore(false)}
                    />

                    {/* Sheet */}
                    <div className="absolute bottom-0 left-0 right-0 bg-white/60 dark:bg-black/50 backdrop-blur-xl border-t border-white/40 dark:border-white/10 rounded-t-[28px] p-6 pb-10 animate-in slide-in-from-bottom duration-300 shadow-[0_-10px_40px_rgba(0,0,0,0.1)]">
                        {/* Handle */}
                        <div className="w-12 h-1.5 bg-muted-foreground/20 rounded-full mx-auto mb-6" />

                        {/* Close */}
                        <button
                            onClick={() => setShowMore(false)}
                            className="absolute top-5 right-5 p-2 rounded-full hover:bg-muted text-muted-foreground transition-colors"
                        >
                            <X className="h-5 w-5" />
                        </button>

                        {/* Title */}
                        <div className="flex items-center gap-2 mb-5">
                            <Sparkles className="h-4 w-4 text-primary" />
                            <h3 className="text-sm font-bold text-foreground">More Options</h3>
                        </div>

                        {/* Menu Items */}
                        <div className="space-y-1.5">
                            {moreItems.map((item) => {
                                const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        prefetch={false}
                                        onClick={() => setShowMore(false)}
                                        className={cn(
                                            'flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all active:scale-[0.98]',
                                            isActive
                                                ? 'bg-primary/10 text-primary'
                                                : 'text-foreground hover:bg-muted/80'
                                        )}
                                    >
                                        <div className={cn(
                                            'p-2.5 rounded-xl',
                                            isActive ? 'bg-primary/15' : 'bg-muted'
                                        )}>
                                            <item.icon className="h-5 w-5" />
                                        </div>
                                        <div className="flex-1">
                                            <span className="font-semibold text-sm">{item.label}</span>
                                            <p className="text-[11px] text-muted-foreground mt-0.5">{item.desc}</p>
                                        </div>
                                        {isActive && (
                                            <div className="w-2 h-2 rounded-full bg-primary animate-pulse-glow" />
                                        )}
                                    </Link>
                                );
                            })}
                        </div>

                        {/* Divider */}
                        <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent my-5" />

                        {/* Theme Toggle */}
                        <button
                            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                            className="flex items-center gap-4 px-4 py-3.5 rounded-2xl text-foreground hover:bg-muted/80 w-full transition-all active:scale-[0.98]"
                        >
                            <div className="p-2.5 rounded-xl bg-muted">
                                {theme === 'dark' ? (
                                    <Sun className="h-5 w-5 text-amber-400" />
                                ) : (
                                    <Moon className="h-5 w-5 text-indigo-400" />
                                )}
                            </div>
                            <div className="flex-1 text-left">
                                <span className="font-semibold text-sm">
                                    {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                                </span>
                                <p className="text-[11px] text-muted-foreground mt-0.5">Switch appearance</p>
                            </div>
                        </button>

                        {/* Logout */}
                        <button
                            onClick={handleLogout}
                            className="flex items-center gap-4 px-4 py-3.5 rounded-2xl text-red-500 hover:bg-red-500/10 w-full transition-all mt-1.5 active:scale-[0.98]"
                        >
                            <div className="p-2.5 rounded-xl bg-red-500/10">
                                <LogOut className="h-5 w-5" />
                            </div>
                            <div className="flex-1 text-left">
                                <span className="font-semibold text-sm">Logout</span>
                                <p className="text-[11px] text-red-400/70 mt-0.5">Sign out of account</p>
                            </div>
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
