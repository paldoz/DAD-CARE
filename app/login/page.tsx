'use client';

import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { KeyRound, User, LogIn, Loader2, Shield } from 'lucide-react';

export default function LoginPage() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [userFocused, setUserFocused] = useState(false);
    const [passFocused, setPassFocused] = useState(false);
    const router = useRouter();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        if (!username || !password) {
            toast.error('Please enter both username and password');
            setLoading(false);
            return;
        }

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: username.trim().toLowerCase(), password })
            });

            let data;
            try {
                const text = await res.text();
                try {
                    data = JSON.parse(text);
                } catch (e) {
                    toast.error('Server error: ' + text.substring(0, 100));
                    setLoading(false);
                    return;
                }
            } catch (e) {
                toast.error('Network connection failed');
                setLoading(false);
                return;
            }

            if (res.ok) {
                const { sessionToken, ...userProfile } = data;
                localStorage.setItem('currentUser', JSON.stringify(userProfile));
                if (sessionToken) {
                    localStorage.setItem('dadwork_session_token', sessionToken);
                }
                toast.success(`Welcome back, ${data.name || data.username}!`);
                setLoading(false);
                router.push('/dashboard');
            } else {
                toast.error(data.error || 'Invalid username or password');
                setLoading(false);
            }
        } catch (error: any) {
            toast.error('Unexpected error: ' + (error?.message || 'Unknown'));
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen w-full flex bg-background">

            {/* ── LEFT PANEL — Brand showcase ── */}
            <div className="hidden lg:flex flex-col items-center justify-center flex-1 relative overflow-hidden"
                style={{ background: 'linear-gradient(145deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)' }}>

                {/* Animated tiny grid pattern with shine */}
                <div className="absolute inset-0 opacity-20"
                    style={{ 
                        backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(to right, rgba(255,255,255,0.1) 1px, transparent 1px)', 
                        backgroundSize: '24px 24px',
                        maskImage: 'radial-gradient(circle at center, black, transparent 70%)',
                        WebkitMaskImage: 'radial-gradient(circle at center, black, transparent 70%)'
                    }} />

                {/* Glowing orbs */}
                <div className="absolute top-1/4 left-1/4 w-80 h-80 rounded-full opacity-20 blur-3xl"
                    style={{ background: 'radial-gradient(circle, #6366f1, transparent)' }} />
                <div className="absolute bottom-1/4 right-1/4 w-64 h-64 rounded-full opacity-15 blur-3xl"
                    style={{ background: 'radial-gradient(circle, #8b5cf6, transparent)' }} />

                {/* Brand content */}
                <div className="relative z-10 flex flex-col items-center text-center px-12">
                    <div className="w-24 h-24 rounded-2xl overflow-hidden mb-8 border-2 border-white/20 shadow-2xl"
                        style={{ boxShadow: '0 0 60px rgba(99,102,241,0.4), 0 20px 40px rgba(0,0,0,0.5)' }}>
                        <img src="/icons/icon-192.png" alt="DADWORK" className="w-full h-full object-cover" />
                    </div>

                    <h1 className="text-5xl font-black text-white tracking-tight mb-3">
                        DAD<span style={{ color: '#818cf8' }}>WORK</span>
                    </h1>
                    <p className="text-white/50 text-sm font-semibold uppercase tracking-[0.3em] mb-12">
                        Precision Ledger System
                    </p>

                    {/* Feature bullets */}
                    <div className="space-y-4 w-full max-w-xs">
                        {[
                            { icon: '📒', text: 'Daily Book Management' },
                            { icon: '💳', text: 'Customer Ledger & Debt Tracking' },
                            { icon: '📊', text: 'Real-time Reports & Analytics' },
                        ].map((item, i) => (
                            <div key={i} className="flex items-center gap-3 text-left px-4 py-3 rounded-xl"
                                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                                <span className="text-xl">{item.icon}</span>
                                <span className="text-white/70 text-sm font-medium">{item.text}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Bottom copyright */}
                <p className="absolute bottom-6 text-white/20 text-xs tracking-widest">
                    © {new Date().getFullYear()} DADWORK. All rights reserved.
                </p>
            </div>

            {/* ── RIGHT PANEL — Login form ── */}
            <div className="flex-1 flex items-center justify-center p-6 lg:p-12 relative">

                {/* Background enhancements */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    {/* Glowing orb for mobile */}
                    <div className="absolute top-0 right-0 w-80 h-80 rounded-full opacity-[0.15] blur-[80px] lg:hidden"
                        style={{ background: '#6366f1' }} />
                    <div className="absolute bottom-0 left-0 w-80 h-80 rounded-full opacity-[0.15] blur-[80px] lg:hidden"
                        style={{ background: '#8b5cf6' }} />
                    
                    {/* Premium Tiny Grid Background with Shine (Light & Dark Mode) */}
                    <div className="absolute inset-0 opacity-50">
                        {/* Light Mode Grid */}
                        <div className="absolute inset-0 dark:hidden" 
                             style={{ 
                                 backgroundImage: 'linear-gradient(to right, rgba(0,0,0,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.06) 1px, transparent 1px)', 
                                 backgroundSize: '24px 24px',
                                 maskImage: 'radial-gradient(circle at center, black, transparent 80%)',
                                 WebkitMaskImage: 'radial-gradient(circle at center, black, transparent 80%)'
                             }} 
                        />
                        {/* Dark Mode Grid */}
                        <div className="absolute inset-0 hidden dark:block" 
                             style={{ 
                                 backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)', 
                                 backgroundSize: '24px 24px',
                                 maskImage: 'radial-gradient(circle at center, black, transparent 80%)',
                                 WebkitMaskImage: 'radial-gradient(circle at center, black, transparent 80%)'
                             }} 
                        />
                    </div>
                    {/* Shining light sweep effect */}
                    <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-primary/5 to-transparent animate-[shimmer_8s_infinite] dark:via-primary/10 opacity-60" />
                </div>

                <div className="w-full max-w-md relative z-10">

                    {/* Mobile logo */}
                    <div className="flex flex-col items-center mb-10 lg:hidden animate-in fade-in slide-in-from-top-4 duration-700">
                        <div className="w-20 h-20 rounded-3xl overflow-hidden mb-5 border border-primary/20 bg-white/5 backdrop-blur-sm p-1 shadow-2xl"
                             style={{ boxShadow: '0 10px 40px -10px rgba(99,102,241,0.5)' }}>
                            <img src="/icons/icon-192.png" alt="DADWORK" className="w-full h-full object-cover rounded-2xl" />
                        </div>
                        <h1 className="text-3xl font-black text-foreground tracking-tight">
                            DAD<span className="text-primary">WORK</span>
                        </h1>
                        <p className="text-muted-foreground text-xs font-semibold uppercase tracking-widest mt-1">
                            Precision Ledger System
                        </p>
                    </div>

                    {/* Desktop greeting */}
                    <div className="mb-10 hidden lg:block">
                        <p className="text-muted-foreground text-sm font-semibold uppercase tracking-widest mb-2">Welcome back</p>
                        <h2 className="text-4xl font-black text-foreground tracking-tight">Sign In</h2>
                        <p className="text-muted-foreground text-sm mt-2">Enter your credentials to access your account.</p>
                    </div>

                    {/* Form Card */}
                    <div className="glass-panel p-8 space-y-6 relative overflow-hidden animate-in fade-in zoom-in-95 duration-500 delay-150 fill-mode-both">

                        <form onSubmit={handleLogin} className="space-y-5">

                            {/* Username Field */}
                            <div className="relative">
                                <label
                                    htmlFor="username"
                                    className={`absolute left-11 transition-all duration-200 pointer-events-none font-semibold
                                        ${userFocused || username
                                            ? 'top-1 text-[10px] text-primary uppercase tracking-widest'
                                            : 'top-1/2 -translate-y-1/2 text-sm text-muted-foreground'}`}
                                >
                                    Username
                                </label>
                                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10" />
                                <input
                                    id="username"
                                    type="text"
                                    value={username}
                                    onChange={e => setUsername(e.target.value)}
                                    onFocus={() => setUserFocused(true)}
                                    onBlur={() => setUserFocused(false)}
                                    className="w-full h-14 pl-10 pr-4 pt-4 pb-1 rounded-xl border border-white/20 bg-white/40 dark:bg-white/5 backdrop-blur-md text-foreground text-sm outline-none transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20 shadow-inner"
                                    autoComplete="username"
                                    autoFocus
                                />
                            </div>

                            {/* Password Field */}
                            <div className="relative">
                                <label
                                    htmlFor="password"
                                    className={`absolute left-11 transition-all duration-200 pointer-events-none font-semibold
                                        ${passFocused || password
                                            ? 'top-1 text-[10px] text-primary uppercase tracking-widest'
                                            : 'top-1/2 -translate-y-1/2 text-sm text-muted-foreground'}`}
                                >
                                    Password
                                </label>
                                <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10" />
                                <input
                                    id="password"
                                    type="password"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    onFocus={() => setPassFocused(true)}
                                    onBlur={() => setPassFocused(false)}
                                    className="w-full h-14 pl-10 pr-4 pt-4 pb-1 rounded-xl border border-white/20 bg-white/40 dark:bg-white/5 backdrop-blur-md text-foreground text-sm outline-none transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20 shadow-inner"
                                    autoComplete="current-password"
                                />
                            </div>

                            {/* Submit */}
                            <Button
                                type="submit"
                                disabled={loading}
                                className="w-full h-13 text-base font-bold rounded-xl shadow-lg mt-2 transition-all duration-300 hover:scale-[1.03] active:scale-[0.97] hover:shadow-[0_0_30px_rgba(99,102,241,0.6)] relative overflow-hidden group"
                                style={{ height: '52px', background: loading ? undefined : 'linear-gradient(135deg, #6366f1, #8b5cf6)', boxShadow: '0 4px 20px rgba(99,102,241,0.35)' }}
                            >
                                {/* Sweeping shine effect on hover */}
                                <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                                
                                <div className="relative flex items-center justify-center gap-2">
                                    {loading ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                            Signing in...
                                        </>
                                    ) : (
                                        <>
                                            <LogIn className="w-5 h-5 group-hover:scale-110 transition-transform duration-300" />
                                            Sign In
                                        </>
                                    )}
                                </div>
                            </Button>
                        </form>

                    </div>

                    {/* Bottom mobile copyright */}
                    <p className="text-center text-[10px] text-muted-foreground mt-6 font-medium lg:hidden">
                        © {new Date().getFullYear()} DADWORK · All rights reserved
                    </p>
                </div>
            </div>
        </div>
    );
}
