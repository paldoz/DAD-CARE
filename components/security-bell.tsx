'use client';

import { useState, useRef, useEffect } from 'react';
import useSWR, { mutate } from 'swr';
import { Bell, AlertTriangle, Check, X, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function SecurityBell() {
    const { data, error, isLoading } = useSWR('/api/security', fetcher, {
        revalidateOnFocus: true, 
        revalidateOnReconnect: true,
        refreshInterval: 0, 
    });

    const [isOpen, setIsOpen] = useState(false);
    const [processingId, setProcessingId] = useState<string | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    if (error || data?.error) return null;

    const alerts = data?.alerts || [];
    const hasAlerts = alerts.length > 0;

    const handleAction = async (id: string, action: 'approve' | 'reject') => {
        setProcessingId(id);
        try {
            const res = await fetch(`/api/security/${action}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `Failed to ${action}`);
            
            toast.success(`Action successfully ${action}d`);
            
            // Revalidate bell data and dashboard data
            mutate('/api/security');
            localStorage.setItem('dadwork_customers_stale', Date.now().toString());
            mutate('/api/dashboard');
            
            // Globally mutate any ledger data currently active on the page
            mutate(
                (key: any) => typeof key === 'string' && key.startsWith('/api/ledger'),
                undefined,
                { revalidate: true }
            );
            
            if (alerts.length === 1) {
                setIsOpen(false);
            }
        } catch (err: any) {
            toast.error(err.message);
        } finally {
            setProcessingId(null);
        }
    };

    return (
        <div className="relative" ref={menuRef}>
            <button
                onClick={() => setIsOpen((prev) => !prev)}
                className="relative flex items-center justify-center w-10 h-10 rounded-xl transition-all hover:bg-muted/50 focus:outline-none"
            >
                <Bell className="w-5 h-5 text-muted-foreground hover:text-foreground transition-colors" />
                {hasAlerts && (
                    <span className="absolute top-2 right-2.5 w-2 h-2 rounded-full bg-red-500 animate-pulse ring-2 ring-background shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
                )}
            </button>

            {isOpen && (
                <div className="absolute right-[-10px] sm:right-0 top-12 z-50 w-[260px] max-w-[calc(100vw-20px)] rounded-[20px] bg-background/50 dark:bg-background/40 backdrop-blur-[40px] border border-white/20 dark:border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.15)] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="p-3 border-b border-border/50 bg-gradient-to-r from-red-500/10 to-transparent">
                        <h3 className="text-sm font-black uppercase tracking-widest text-red-500 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4" /> Pending Approvals
                        </h3>
                        <p className="text-[10px] text-muted-foreground mt-0.5 font-medium tracking-wide">Review edits and overrides</p>
                    </div>
                    
                    <div className="max-h-[350px] overflow-y-auto">
                        {isLoading ? (
                            <div className="p-4 flex justify-center">
                                <div className="w-4 h-4 rounded-full border-2 border-red-500 border-t-transparent animate-spin" />
                            </div>
                        ) : alerts.length === 0 ? (
                            <div className="p-4 text-center text-xs text-muted-foreground font-medium uppercase tracking-widest">
                                No pending approvals
                            </div>
                        ) : (
                            <div className="flex flex-col divide-y divide-border/30">
                                {alerts.map((alert: any) => {
                                    const isProcessing = processingId === alert.id;
                                    let payloadText = '';
                                    if (alert.action_type === 'EDIT_PAYMENT') payloadText = `Change payment to $${alert.payload.amount}`;
                                    else if (alert.action_type === 'ADD_LATE_PAYMENT') payloadText = `Add late payment of $${alert.payload.amount}`;
                                    else if (alert.action_type === 'UNDO_LEDGER') payloadText = `Undo payment of $${alert.payload.amount}`;
                                    else payloadText = `Action: ${alert.action_type}`;

                                    return (
                                        <div key={alert.id} className="p-3 hover:bg-muted/30 transition-colors flex flex-col gap-2">
                                            <div className="flex justify-between items-start gap-2">
                                                <p className="text-xs font-bold text-foreground">
                                                    <span className="text-blue-500 capitalize">{alert.username}</span> 
                                                </p>
                                                <span className="text-[9px] text-muted-foreground font-bold shrink-0 uppercase tracking-wider">
                                                    {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
                                                </span>
                                            </div>
                                            <div className="bg-muted/40 p-2 rounded-lg border border-border/30">
                                                <p className="text-[11px] font-medium text-foreground">{payloadText}</p>
                                            </div>
                                            
                                            <div className="flex gap-2 mt-1">
                                                <button
                                                    disabled={isProcessing}
                                                    onClick={() => handleAction(alert.id, 'approve')}
                                                    className="flex-1 flex items-center justify-center gap-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 text-[10px] font-black uppercase tracking-widest py-1.5 rounded-lg transition-colors disabled:opacity-50"
                                                >
                                                    {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                                    Approve
                                                </button>
                                                <button
                                                    disabled={isProcessing}
                                                    onClick={() => handleAction(alert.id, 'reject')}
                                                    className="flex-1 flex items-center justify-center gap-1 bg-red-500/10 hover:bg-red-500/20 text-red-500 text-[10px] font-black uppercase tracking-widest py-1.5 rounded-lg transition-colors disabled:opacity-50"
                                                >
                                                    {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                                                    Reject
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
