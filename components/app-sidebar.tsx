'use client';

import { useState, useEffect } from 'react';
import {
    LayoutDashboard,
    BookOpen,
    Library,
    Users,
    CreditCard,
    BarChart3,
    Settings,
    LogOut,
    Sun,
    Moon,
    ChevronRight
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { logout } from '@/lib/session';
import { subscribeToDailyDates } from '@/lib/hijri-date';

const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/daily-book', label: 'Daily Book', icon: BookOpen },
    { href: '/ledger', label: 'Buuga Maqalka', icon: Library },
    { href: '/customers', label: 'Customers', icon: Users },
    { href: '/payments', label: 'Lacagaha', icon: CreditCard },
    { href: '/reports', label: 'Reports', icon: BarChart3 },
    { href: '/settings', label: 'Settings', icon: Settings },
];

export function AppSidebar() {
    const pathname = usePathname();
    const router = useRouter();
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    const [currentUser, setCurrentUser] = useState<any>(null);
    const [dates, setDates] = useState({ standard: '', hijri: '' });

    useEffect(() => {
        setMounted(true);
        const storedUser = localStorage.getItem('currentUser');
        if (storedUser) {
            try {
                setCurrentUser(JSON.parse(storedUser));
            } catch (e) {
                console.error("Failed to parse currentUser", e);
            }
        }

        const unsub = subscribeToDailyDates((standard, hijri) => {
            setDates({ standard, hijri });
        });
        return () => unsub();
    }, []);

    const handleLogout = async () => {
        await logout();
        // Note: supabase.auth.signOut() removed — this app uses a custom session system,
        // not Supabase Auth, so the call was hitting the Supabase Auth API unnecessarily.
        window.location.href = '/login';
    };


    return (
        <div className="flex h-full w-[260px] flex-col bg-sidebar/80 backdrop-blur-xl border-r border-sidebar-border/50 z-20 transition-colors duration-300">
            {/* Header - Current Admin Profile */}
            <div className="flex py-4 items-center px-4 border-b border-sidebar-border/50">
                <div className="flex items-center gap-3 w-full">
                    <Avatar className="w-11 h-11 rounded-xl border-2 border-primary/20 shadow-sm transition-transform hover:scale-105 shrink-0">
                        {currentUser?.avatar_url && <AvatarImage src={currentUser.avatar_url} alt={currentUser.name} className="object-cover" />}
                        <AvatarFallback className="bg-gradient-to-br from-primary to-blue-600 text-primary-foreground font-black text-sm rounded-xl">
                            {currentUser?.name ? currentUser.name.charAt(0).toUpperCase() : 'D'}
                        </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col overflow-hidden">
                        <h1 className="text-sm font-black tracking-tight text-sidebar-foreground truncate uppercase">
                            {currentUser?.name || 'DADWORK'}
                        </h1>
                        <p className="text-[9px] text-muted-foreground font-bold tracking-widest uppercase truncate flex items-center gap-1 mt-0.5 mb-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                            {currentUser?.role ? currentUser.role.replace('_', ' ') : 'Business Ledger'}
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
            </div>

            {/* Navigation */}
            <nav className="flex-1 space-y-0.5 px-3 py-4 overflow-y-auto">
                {navItems.map((item) => {
                    const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            prefetch={false}
                            className={cn(
                                'group flex items-center rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-200',
                                isActive
                                    ? 'bg-primary/10 text-primary shadow-sm'
                                    : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                            )}
                        >
                            <div className={cn(
                                'mr-3 p-1.5 rounded-lg transition-colors',
                                isActive ? 'bg-primary/15' : 'bg-transparent group-hover:bg-muted'
                            )}>
                                <item.icon className={cn(
                                    "h-4 w-4 flex-shrink-0 transition-all",
                                    isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                                )} />
                            </div>
                            <span className="flex-1">{item.label}</span>
                            {isActive && (
                                <ChevronRight className="h-3.5 w-3.5 text-primary/60" />
                            )}
                        </Link>
                    );
                })}
            </nav>

            {/* Footer */}
            <div className="border-t border-sidebar-border/50 p-3 space-y-1">

                {/* Theme Toggle */}
                <Button
                    variant="ghost"
                    className="w-full justify-start text-muted-foreground hover:bg-muted/80 hover:text-foreground rounded-xl text-[13px] h-10"
                    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                >
                    <div className="mr-3 p-1.5 rounded-lg bg-muted">
                        {mounted && theme === 'dark' ? (
                            <Sun className="h-4 w-4 text-amber-400" />
                        ) : (
                            <Moon className="h-4 w-4 text-indigo-400" />
                        )}
                    </div>
                    {mounted ? (theme === 'dark' ? 'Light Mode' : 'Dark Mode') : 'Toggle Theme'}
                </Button>

                {/* Logout */}
                <Button
                    variant="ghost"
                    className="w-full justify-start text-muted-foreground hover:bg-red-500/10 hover:text-red-500 rounded-xl text-[13px] h-10 transition-colors"
                    onClick={handleLogout}
                >
                    <div className="mr-3 p-1.5 rounded-lg">
                        <LogOut className="h-4 w-4" />
                    </div>
                    Logout
                </Button>
            </div>
        </div>
    );
}
