'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, User, Phone, Hash, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useClickAway } from '@/lib/hooks/use-click-away'; // I will check if this exists or just write click away logic
import useSWR from 'swr';

const fetcher = async (url: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('dadwork_session_token') || '' : '';
    const res = await fetch(url, { headers: token ? { 'x-session-token': token } : {}, credentials: 'include' });
    if (!res.ok) throw new Error('Fetch error');
    return res.json();
};

export function GlobalSearch() {
    const [query, setQuery] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const router = useRouter();
    const { resolvedTheme } = useTheme();
    const searchRef = useRef<HTMLDivElement>(null);

    const { data: customers, isLoading: loading } = useSWR<any[]>('/api/customers?lite=true', fetcher, {
        revalidateOnFocus: false,
        dedupingInterval: 300000,
        revalidateIfStale: false
    });

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const filtered = query.trim() === '' ? [] : (customers || []).filter(c => {
        const term = query.toLowerCase().trim();
        const cleanTerm = term.replace(/[^a-z0-9]/g, '');
        const cleanPhoneQuery = query.replace(/[^0-9]/g, '');
        
        const nameMatch = c.name && c.name.toLowerCase().includes(term);
        const cleanNameMatch = c.name && cleanTerm && c.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(cleanTerm);
        const phoneMatch = c.phone && cleanPhoneQuery && c.phone.replace(/[^0-9]/g, '').includes(cleanPhoneQuery);
        const codeMatch = c.customer_code && c.customer_code.toString().toLowerCase().includes(term);
        
        return nameMatch || cleanNameMatch || phoneMatch || codeMatch;
    });

    return (
        <div ref={searchRef} className="relative w-full max-w-2xl mx-auto mb-6 z-50">
            <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Search className="h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
                </div>
                <Input
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setIsOpen(true);
                    }}
                    onFocus={() => setIsOpen(true)}
                    placeholder="Search by name, phone number, or ID..."
                    className="pl-11 h-14 bg-white/40 dark:bg-black/40 backdrop-blur-2xl border-2 border-primary/20 hover:border-primary/40 focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/20 text-base shadow-sm rounded-2xl transition-all"
                />
                {loading && (
                    <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                )}
            </div>

            {isOpen && query.trim() !== '' && (
                <div 
                    className="absolute top-full left-0 right-0 mt-2 border border-white/40 dark:border-white/10 shadow-[0_8px_32px_0_rgba(0,0,0,0.15)] dark:shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] rounded-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200"
                    style={{
                        backgroundColor: resolvedTheme === 'dark' ? 'rgba(0, 0, 0, 0.15)' : 'rgba(255, 255, 255, 0.15)',
                        backdropFilter: 'blur(30px) saturate(150%)',
                        WebkitBackdropFilter: 'blur(30px) saturate(150%)'
                    }}
                >
                    {filtered.length > 0 ? (
                        <div className="max-h-[60vh] overflow-y-auto p-2 relative">
                            {/* Animated glowing orb behind results for mirroring effect */}
                            <div className="absolute top-0 right-1/4 w-40 h-40 bg-primary/30 dark:bg-primary/40 rounded-full blur-[40px] -z-10 pointer-events-none animate-pulse" />
                            <div className="absolute bottom-0 left-1/4 w-40 h-40 bg-blue-500/30 dark:bg-blue-500/40 rounded-full blur-[40px] -z-10 pointer-events-none animate-pulse delay-700" />
                            
                            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 px-2 pt-2 relative z-10">Search Results</p>
                            {filtered.map(customer => (
                                <button
                                    key={customer.id}
                                    onClick={() => {
                                        setIsOpen(false);
                                        setQuery('');
                                        router.push(`/customers/${customer.id}`);
                                    }}
                                    className="w-full text-left flex items-center justify-between p-3 rounded-xl hover:bg-primary/5 transition-colors group"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                                            <User className="h-5 w-5" />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <p className={`font-bold text-sm transition-colors ${customer.is_inactive ? 'text-muted-foreground line-through' : 'text-foreground group-hover:text-primary'}`}>{customer.name}</p>
                                                {customer.is_inactive && (
                                                    <span className="text-[9px] font-black uppercase bg-red-500/10 text-red-500 px-1.5 py-0.5 rounded">Inactive</span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground font-medium">
                                                <span className="flex items-center gap-1"><Hash className="h-3 w-3"/>{customer.customer_code}</span>
                                                {customer.phone && (
                                                    <span className="flex items-center gap-1"><Phone className="h-3 w-3"/>{customer.phone}</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs font-bold text-muted-foreground uppercase">Balance</p>
                                        <p className={`text-sm font-black ${customer.current_balance > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                                            ${Math.round(customer.current_balance || 0).toLocaleString()}
                                        </p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="p-8 text-center text-muted-foreground">
                            <Search className="h-8 w-8 mx-auto mb-3 opacity-20" />
                            <p className="font-medium">No customers found</p>
                            <p className="text-xs mt-1 opacity-70">Try searching with a different name or number</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
