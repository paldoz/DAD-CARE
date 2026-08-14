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

import { SecurityBell } from '@/components/security-bell';

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
        <div className="flex h-full w-[220px] flex-col bg-sidebar border-r border-sidebar-border z-20">
            {/* Header — User Profile */}
            <div className="flex items-center gap-3 px-4 py-4 border-b border-sidebar-border">
                <Avatar className="w-9 h-9 rounded-xl border border-primary/20 shrink-0">
                    {currentUser?.avatar_url && <AvatarImage src={currentUser.avatar_url} alt={currentUser.name} className="object-cover" />}
                    <AvatarFallback className="bg-primary text-primary-foreground font-bold text-sm rounded-xl">
                        {currentUser?.name ? currentUser.name.charAt(0).toUpperCase() : 'D'}
                    </AvatarFallback>
                </Avatar>
                <div className="flex flex-col overflow-hidden min-w-0">
                    <p className="text-[13px] font-semibold text-sidebar-foreground truncate leading-tight">
                        {currentUser?.name || 'DADWORK'}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1 mt-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                        {currentUser?.role ? currentUser.role.replace('_', ' ') : 'Admin'}
                    </p>
                </div>
                {currentUser?.role === 'SUPER_ADMIN' && <SecurityBell />}
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
                {navItems.map((item) => {
                    const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            prefetch={false}
                            className={cn(
                                'flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors',
                                isActive
                                    ? 'bg-primary/10 text-primary'
                                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                            )}
                        >
                            <item.icon className={cn(
                                'h-4 w-4 shrink-0',
                                isActive ? 'text-primary' : 'text-muted-foreground'
                            )} />
                            <span className="flex-1 truncate">{item.label}</span>
                            {isActive && <ChevronRight className="h-3 w-3 text-primary/50 shrink-0" />}
                        </Link>
                    );
                })}
            </nav>

            {/* Footer */}
            <div className="border-t border-sidebar-border p-2 space-y-0.5">
                <Button
                    variant="ghost"
                    className="w-full justify-start text-muted-foreground hover:bg-muted hover:text-foreground rounded-xl text-[13px] h-9 px-3 gap-2.5"
                    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                >
                    <div className="h-4 w-4 shrink-0 flex items-center justify-center">
                        {mounted && theme === 'dark' ? (
                            <Sun className="h-4 w-4 text-amber-400" />
                        ) : (
                            <Moon className="h-4 w-4 text-slate-400" />
                        )}
                    </div>
                    {mounted ? (theme === 'dark' ? 'Light Mode' : 'Dark Mode') : 'Toggle Theme'}
                </Button>

                <Button
                    variant="ghost"
                    className="w-full justify-start text-muted-foreground hover:bg-red-500/10 hover:text-red-500 rounded-xl text-[13px] h-9 px-3 gap-2.5 transition-colors"
                    onClick={handleLogout}
                >
                    <LogOut className="h-4 w-4 shrink-0" />
                    Logout
                </Button>
            </div>
        </div>
    );
}
