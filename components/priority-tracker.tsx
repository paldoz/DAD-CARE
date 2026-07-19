'use client';

import { useEffect, useState } from 'react';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { CheckCircle2, ListTodo, Loader2 } from 'lucide-react';

interface MaqalCustomer {
    id: string;
    name: string;
    customer_code: string;
    avatar_url?: string;
    has_payment: boolean;
}

interface PerUserMaqal {
    user_id: string;
    username: string;
    total: number;
    solved: number;
    customers: MaqalCustomer[];
}

interface MaqalData {
    users: PerUserMaqal[];
    date1: string | null;
    date2: string | null;
    waitingDate1: string | null;
    waitingDate2: string | null;
    autoAdvanced?: boolean;
}

function fmtDate(d: string | null) {
    if (!d) return '';
    try {
        const dt = new Date(d + 'T00:00:00Z');
        return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    } catch { return d; }
}

export function PriorityTracker() {
    const [data, setData] = useState<MaqalData | null>(null);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);

    const fetchData = async () => {
        try {
            const token = typeof window !== 'undefined' ? localStorage.getItem('dadwork_session_token') || '' : '';
            const res = await fetch('/api/maqal-per-user', { headers: token ? { 'x-session-token': token } : {} });
            if (res.ok) setData(await res.json());
        } catch { /* silent */ }
        finally { setLoading(false); }
    };

    useEffect(() => {
        fetchData();
        
        // Listen for customer deletions/restores to update the priority count instantly
        const handleStorage = (e: StorageEvent) => {
            if (e.key === 'dadwork_customers_stale') {
                fetchData();
            }
        };
        window.addEventListener('storage', handleStorage);
        
        // Also listen for same-tab custom events if triggered manually
        const handleCustom = () => fetchData();
        window.addEventListener('dadwork_customers_stale', handleCustom);
        
        return () => {
            window.removeEventListener('storage', handleStorage);
            window.removeEventListener('dadwork_customers_stale', handleCustom);
        };
    }, []);

    const allUsers = data?.users || [];
    const totalAssigned = allUsers.reduce((s, u) => s + u.total, 0);
    const totalSolved   = allUsers.reduce((s, u) => s + u.solved, 0);
    const totalLeft     = totalAssigned - totalSolved;
    const allDone       = !loading && totalLeft === 0 && totalAssigned > 0;
    const totalPct      = totalAssigned > 0 ? Math.round((totalSolved / totalAssigned) * 100) : 0;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    className="relative h-8 px-2.5 bg-background border-primary/20 hover:bg-primary/10 hover:border-primary/40 transition-all shadow-sm overflow-hidden group text-xs"
                >
                    <div className="absolute inset-0 bg-primary/8 translate-y-full group-hover:translate-y-0 transition-transform duration-200 ease-out" />
                    <ListTodo className="w-3.5 h-3.5 mr-1.5 text-primary relative z-10 shrink-0" />
                    {loading
                        ? <Loader2 className="w-3 h-3 animate-spin relative z-10" />
                        : <span className="font-black relative z-10 tabular-nums">{totalSolved}/{totalAssigned}</span>
                    }
                    {/* Status dot */}
                    {!loading && totalAssigned > 0 && (
                        <span className="absolute top-0.5 right-0.5 flex h-1.5 w-1.5">
                            {allDone
                                ? <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                                : <>
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500" />
                                </>
                            }
                        </span>
                    )}
                </Button>
            </PopoverTrigger>

            <PopoverContent
                className="w-64 p-0 bg-card border-border shadow-xl rounded-xl overflow-hidden"
                align="end"
                sideOffset={6}
            >
                {/* ── Header ── */}
                <div className="px-3 py-2 border-b border-border/50 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                            <ListTodo className="w-3 h-3 text-primary shrink-0" />
                            <span className="text-[11px] font-black text-foreground uppercase tracking-tight">Priority</span>
                            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${allDone ? 'bg-emerald-500/15 text-emerald-500' : 'bg-amber-500/15 text-amber-500'}`}>
                                {allDone ? '✅ Done' : `${totalLeft} left`}
                            </span>
                        </div>
                        {data?.date1 && (
                            <p className="text-[9px] text-muted-foreground font-semibold leading-tight mt-0.5">
                                📌 {fmtDate(data.date1)} &amp; {fmtDate(data.date2)}
                                {data.waitingDate1 && <span className="opacity-50 ml-1">· ⏳ {fmtDate(data.waitingDate1)} &amp; {fmtDate(data.waitingDate2)}</span>}
                            </p>
                        )}
                    </div>
                    {/* Mini total progress */}
                    <div className="shrink-0 text-right">
                        <span className={`text-sm font-black tabular-nums ${allDone ? 'text-emerald-500' : 'text-amber-500'}`}>
                            {totalSolved}/{totalAssigned}
                        </span>
                        <div className="h-1 w-14 bg-border/50 rounded-full overflow-hidden mt-0.5">
                            <div
                                className={`h-full rounded-full transition-all ${allDone ? 'bg-emerald-500' : 'bg-amber-500'}`}
                                style={{ width: `${totalPct}%` }}
                            />
                        </div>
                    </div>
                </div>

                {/* ── Per-admin rows ── */}
                <div className="divide-y divide-border/30 max-h-[260px] overflow-y-auto">
                    {loading ? (
                        <div className="flex items-center justify-center py-6">
                            <Loader2 className="w-4 h-4 animate-spin text-primary" />
                        </div>
                    ) : allUsers.length === 0 ? (
                        <p className="text-center text-[11px] text-muted-foreground py-5">No priority assignments</p>
                    ) : (
                        allUsers.map((user) => {
                            const left   = user.total - user.solved;
                            const done   = left === 0 && user.total > 0;
                            const pct    = user.total > 0 ? Math.round((user.solved / user.total) * 100) : 0;
                            const pending = user.customers.filter(c => !c.has_payment);

                            return (
                                <div key={user.user_id} className="px-3 py-2">
                                    {/* Row: avatar initial + username + score */}
                                    <div className="flex items-center gap-2">
                                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black shrink-0 ${done ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white'}`}>
                                            {user.username.charAt(0).toUpperCase()}
                                        </div>
                                        <span className="text-[11px] font-bold text-foreground flex-1 truncate">@{user.username}</span>
                                        <span className={`text-[11px] font-black tabular-nums shrink-0 ${done ? 'text-emerald-500' : 'text-amber-500'}`}>
                                            {user.solved}/{user.total}
                                        </span>
                                        <span className={`text-[9px] font-bold px-1 py-0.5 rounded shrink-0 ${
                                            pct >= 80 ? 'bg-emerald-500/15 text-emerald-500'
                                            : pct >= 50 ? 'bg-amber-500/15 text-amber-500'
                                            : 'bg-red-500/15 text-red-400'
                                        }`}>{pct}%</span>
                                    </div>

                                    {/* Progress bar */}
                                    <div className="h-[3px] bg-border/40 rounded-full overflow-hidden mt-1.5 mb-1">
                                        <div
                                            className={`h-full rounded-full transition-all duration-500 ${done ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                                            style={{ width: `${pct}%` }}
                                        />
                                    </div>

                                    {/* Pending customer initials (compact) */}
                                    {done ? (
                                        <div className="flex items-center gap-1 text-[9px] text-emerald-500 font-bold">
                                            <CheckCircle2 className="w-2.5 h-2.5" /> All done
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-0.5 flex-wrap">
                                            {pending.slice(0, 10).map((c) => (
                                                <span
                                                    key={c.id}
                                                    title={`${c.name} #${c.customer_code}`}
                                                    className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500/90 text-white text-[7px] font-black border border-amber-400/60 shrink-0"
                                                >
                                                    {c.avatar_url
                                                        ? <img src={c.avatar_url} className="w-full h-full rounded-full object-cover" alt="" />
                                                        : c.name.charAt(0).toUpperCase()
                                                    }
                                                </span>
                                            ))}
                                            {left > 10 && (
                                                <span className="text-[8px] font-black text-amber-500 ml-0.5">+{left - 10}</span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}
