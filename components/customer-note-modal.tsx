'use client';

import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { 
    BookOpen, 
    Check, 
    Clock, 
    Trash2, 
    Loader2, 
    Save
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CustomerNoteStatusRecord } from '@/app/api/customer-note-status/route';

interface CustomerNoteModalProps {
    isOpen: boolean;
    onClose: () => void;
    customer: {
        id: string;
        name: string;
        customer_code: string;
    } | null;
    currentStatus?: CustomerNoteStatusRecord | null;
    isSuperAdmin?: boolean;
    onSaveSuccess: (updatedStatus: CustomerNoteStatusRecord | null) => void;
}

export function CustomerNoteModal({
    isOpen,
    onClose,
    customer,
    currentStatus,
    onSaveSuccess,
}: CustomerNoteModalProps) {
    const [priorityEnabled, setPriorityEnabled] = useState(false);
    const [busyEnabled, setBusyEnabled] = useState(false);
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);
    const [clearingCustomer, setClearingCustomer] = useState(false);

    // Sync form state whenever modal opens or customer changes
    useEffect(() => {
        if (isOpen && customer) {
            setPriorityEnabled(Boolean(currentStatus?.priority_enabled));
            setBusyEnabled(Boolean(currentStatus?.busy_enabled));
            setNote(currentStatus?.note || '');
        }
    }, [isOpen, customer, currentStatus]);

    if (!customer) return null;

    const handleSave = async () => {
        setSaving(true);
        try {
            const token = typeof window !== 'undefined' ? localStorage.getItem('dadwork_session_token') || '' : '';
            const res = await fetch('/api/customer-note-status', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'x-session-token': token } : {}),
                },
                body: JSON.stringify({
                    customerId: customer.id,
                    priorityEnabled,
                    busyEnabled,
                    note: note.trim(),
                }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to save');

            toast.success(
                data.cleared
                    ? `Xaaladda ${customer.name} waa la tirtiray`
                    : `Xaaladda ${customer.name} si guul leh ayaa loo keydiyay`
            );

            onSaveSuccess(data.status || null);
            onClose();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Khalad ayaa dhacay markii la keydinayay';
            toast.error(message);
        } finally {
            setSaving(false);
        }
    };

    // Clear This Customer: Clears notes and status for the currently selected customer only
    const handleClearThisCustomer = async () => {
        setClearingCustomer(true);
        try {
            const token = typeof window !== 'undefined' ? localStorage.getItem('dadwork_session_token') || '' : '';
            const res = await fetch(`/api/customer-note-status?customerId=${encodeURIComponent(customer.id)}`, {
                method: 'DELETE',
                headers: {
                    ...(token ? { 'x-session-token': token } : {}),
                },
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to clear customer notes');

            toast.success(`Qoraalka & heerarka ${customer.name} waa la nadiifiyay`);
            setPriorityEnabled(false);
            setBusyEnabled(false);
            setNote('');
            onSaveSuccess(null);
            onClose();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Khalad ayaa dhacay markii la nadiifinayay macmiilkan';
            toast.error(message);
        } finally {
            setClearingCustomer(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="sm:max-w-[440px] p-5 glass-panel border border-border/60 shadow-2xl rounded-2xl">
                <DialogHeader className="space-y-1 pb-2.5 border-b border-border/40">
                    <div className="flex items-center gap-2 text-primary">
                        <BookOpen className="w-4 h-4 text-primary shrink-0" />
                        <DialogTitle className="text-base font-black tracking-tight text-foreground truncate">
                            {customer.name.toUpperCase()}
                        </DialogTitle>
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-bold shrink-0">
                            ID: {customer.customer_code}
                        </span>
                    </div>
                    <DialogDescription className="text-[11px] text-muted-foreground">
                        Maamul Sax Saar, Mashquul, iyo Qoraal. Xisaabaadka waxba kama badalo.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3 py-2">
                    {/* ✓ 📞 Sax Saar Toggle Card */}
                    <div 
                        onClick={() => setPriorityEnabled(!priorityEnabled)}
                        className={cn(
                            "flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer select-none",
                            priorityEnabled 
                                ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-950 dark:text-emerald-100 shadow-[0_0_10px_rgba(16,185,129,0.12)]" 
                                : "bg-muted/30 border-border/40 hover:bg-muted/50"
                        )}
                    >
                        <div className="flex items-center gap-2.5">
                            <div className={cn(
                                "w-7 h-7 rounded-full flex items-center justify-center font-black transition-colors",
                                priorityEnabled ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"
                            )}>
                                <Check className="w-3.5 h-3.5" />
                            </div>
                            <div>
                                <div className="text-xs font-bold flex items-center gap-1.5">
                                    <span>✓ 📞 Sax Saar</span>
                                    {priorityEnabled && (
                                        <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-black">
                                            Active
                                        </span>
                                    )}
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                    Calaamadda 🟢 ✓ 📞 ku dar macmiilkan
                                </div>
                            </div>
                        </div>
                        <Switch 
                            checked={priorityEnabled} 
                            onCheckedChange={setPriorityEnabled}
                            className="data-[state=checked]:bg-emerald-500"
                            onClick={(e) => e.stopPropagation()}
                        />
                    </div>

                    {/* 🕒 Busy Toggle Card */}
                    <div 
                        onClick={() => setBusyEnabled(!busyEnabled)}
                        className={cn(
                            "flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer select-none",
                            busyEnabled 
                                ? "bg-amber-500/10 border-amber-500/40 text-amber-950 dark:text-amber-100 shadow-[0_0_10px_rgba(245,158,11,0.12)]" 
                                : "bg-muted/30 border-border/40 hover:bg-muted/50"
                        )}
                    >
                        <div className="flex items-center gap-2.5">
                            <div className={cn(
                                "w-7 h-7 rounded-full flex items-center justify-center font-black transition-colors",
                                busyEnabled ? "bg-amber-500 text-white shadow-[0_0_8px_rgba(245,158,11,0.5)]" : "bg-muted text-muted-foreground"
                            )}>
                                <Clock className="w-3.5 h-3.5" />
                            </div>
                            <div>
                                <div className="text-xs font-bold flex items-center gap-1.5">
                                    <span>🕒 Busy</span>
                                    {busyEnabled && (
                                        <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 font-black">
                                            Active
                                        </span>
                                    )}
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                    Waxay u yeelaysaa dhibicda huruudda ah ee • liiska
                                </div>
                            </div>
                        </div>
                        <Switch 
                            checked={busyEnabled} 
                            onCheckedChange={setBusyEnabled}
                            className="data-[state=checked]:bg-amber-500"
                            onClick={(e) => e.stopPropagation()}
                        />
                    </div>

                    {/* Note Textarea */}
                    <div className="space-y-1">
                        <div className="flex justify-between items-center text-xs font-bold text-foreground">
                            <label htmlFor="customer-note-input" className="flex items-center gap-1">
                                <span>Note</span>
                            </label>
                            <span className={cn(
                                "text-[10px] font-mono",
                                note.length >= 450 ? "text-red-500 font-bold" : "text-muted-foreground"
                            )}>
                                {note.length}/500
                            </span>
                        </div>
                        <textarea
                            id="customer-note-input"
                            value={note}
                            onChange={(e) => setNote(e.target.value.slice(0, 500))}
                            placeholder="Write a short note..."
                            rows={3}
                            className="w-full text-xs rounded-xl p-2.5 bg-background/60 border border-border/60 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-muted-foreground/60 resize-none font-medium"
                        />
                    </div>

                    {/* Metadata if already updated previously */}
                    {currentStatus?.updated_at && (
                        <div className="text-[10px] text-muted-foreground/70 flex justify-between items-center pt-1 border-t border-border/20">
                            <span>
                                Ugu dambeeyay: {new Date(currentStatus.updated_at).toLocaleDateString('so-SO', {
                                    month: 'short',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                })}
                            </span>
                            {currentStatus.updated_by && (
                                <span className="font-semibold text-primary/80">
                                    By: {currentStatus.updated_by}
                                </span>
                            )}
                        </div>
                    )}
                </div>

                <DialogFooter className="flex flex-row items-center justify-between gap-2 pt-2.5 border-t border-border/40 sm:justify-between">
                    {/* Left: Clear This Customer button (clears only the current customer) */}
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleClearThisCustomer}
                        disabled={saving || clearingCustomer}
                        className="h-8 px-2.5 text-xs font-bold text-red-500 hover:text-red-600 hover:bg-red-500/10 gap-1.5 rounded-xl border border-red-500/20"
                    >
                        {clearingCustomer ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                        )}
                        <span>Clear This Customer</span>
                    </Button>

                    {/* Right: Cancel & Save buttons */}
                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onClose}
                            disabled={saving || clearingCustomer}
                            className="h-8 rounded-xl text-xs font-bold px-3"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            onClick={handleSave}
                            disabled={saving || clearingCustomer}
                            className="h-8 rounded-xl text-xs font-black px-4 bg-primary text-primary-foreground hover:bg-primary/90 gap-1.5 shadow-md shadow-primary/20"
                        >
                            {saving ? (
                                <>
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    Save...
                                </>
                            ) : (
                                <>
                                    <Save className="w-3 h-3" />
                                    Save
                                </>
                            )}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
