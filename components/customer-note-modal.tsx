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
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { 
    BookOpen, 
    Check, 
    Clock, 
    Trash2, 
    Loader2, 
    Save, 
    UserMinus, 
    AlertTriangle,
    ShieldAlert,
    ChevronDown
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
    onClearAllSuccess?: () => void;
}

export function CustomerNoteModal({
    isOpen,
    onClose,
    customer,
    currentStatus,
    onSaveSuccess,
    onClearAllSuccess,
}: CustomerNoteModalProps) {
    const [priorityEnabled, setPriorityEnabled] = useState(false);
    const [busyEnabled, setBusyEnabled] = useState(false);
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);
    const [clearingCustomer, setClearingCustomer] = useState(false);
    const [clearPopoverOpen, setClearPopoverOpen] = useState(false);
    const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
    const [clearingAll, setClearingAll] = useState(false);

    // Sync form state whenever modal opens or customer changes
    useEffect(() => {
        if (isOpen && customer) {
            setPriorityEnabled(Boolean(currentStatus?.priority_enabled));
            setBusyEnabled(Boolean(currentStatus?.busy_enabled));
            setNote(currentStatus?.note || '');
            setClearPopoverOpen(false);
            setShowClearAllConfirm(false);
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

    // Option 1: Clear This Customer
    const handleClearThisCustomer = async () => {
        setClearingCustomer(true);
        setClearPopoverOpen(false);
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

    // Option 2: Clear All (bulk clear all notes/statuses)
    const handleExecuteClearAll = async () => {
        setClearingAll(true);
        try {
            const token = typeof window !== 'undefined' ? localStorage.getItem('dadwork_session_token') || '' : '';
            const res = await fetch('/api/customer-note-status?all=true&confirm=CONFIRM_CLEAR_ALL', {
                method: 'DELETE',
                headers: {
                    ...(token ? { 'x-session-token': token } : {}),
                },
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to clear all customer notes');

            toast.success(data.message || 'Dhammaan qoraalada iyo heerarka waa la wada nadiifiyay');
            setShowClearAllConfirm(false);
            if (onClearAllSuccess) {
                onClearAllSuccess();
            }
            onClose();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Khalad ayaa dhacay markii la nadiifinayay dhammaan';
            toast.error(message);
        } finally {
            setClearingAll(false);
        }
    };

    return (
        <>
            <Dialog open={isOpen && !showClearAllConfirm} onOpenChange={(open) => { if (!open) onClose(); }}>
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

                        {/* Note Input (Max 23 Characters) */}
                        <div className="space-y-1">
                            <div className="flex justify-between items-center text-xs font-bold text-foreground">
                                <label htmlFor="customer-note-input" className="flex items-center gap-1">
                                    <span>Note</span>
                                </label>
                                <span className={cn(
                                    "text-[10px] font-mono",
                                    note.length >= 20 ? "text-amber-500 font-bold" : "text-muted-foreground"
                                )}>
                                    {note.length}/23
                                </span>
                            </div>
                            <input
                                id="customer-note-input"
                                type="text"
                                maxLength={23}
                                value={note}
                                onChange={(e) => setNote(e.target.value.slice(0, 23))}
                                placeholder="Write a short note..."
                                className="w-full text-xs rounded-xl px-3 py-2.5 bg-background/60 border border-border/60 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-muted-foreground/60 font-medium"
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
                        {/* Left: Clear button with high-transparency floating options popover */}
                        <Popover open={clearPopoverOpen} onOpenChange={setClearPopoverOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={saving || clearingCustomer || clearingAll}
                                    className="h-8 px-2.5 text-xs font-bold text-red-500 hover:text-red-600 hover:bg-red-500/10 border-red-500/30 gap-1.5 rounded-xl shadow-xs transition-all active:scale-95"
                                >
                                    {clearingCustomer || clearingAll ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                        <Trash2 className="w-3.5 h-3.5" />
                                    )}
                                    <span>Clear</span>
                                    <ChevronDown className="w-3 h-3 opacity-60" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent 
                                align="start" 
                                side="top" 
                                sideOffset={8}
                                className="w-56 p-2 rounded-2xl bg-background/85 backdrop-blur-2xl border border-white/25 dark:border-white/10 shadow-2xl z-50 space-y-1.5 animate-in fade-in-0 zoom-in-95"
                            >
                                <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/80 px-2 py-0.5">
                                    Dooro Nooca Nadiifinta
                                </div>

                                {/* Option 1: Clear This Customer */}
                                <button
                                    type="button"
                                    onClick={handleClearThisCustomer}
                                    disabled={clearingCustomer}
                                    className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-bold text-foreground hover:text-red-600 bg-background/50 hover:bg-red-500/15 rounded-xl transition-all active:scale-95 border border-border/30 hover:border-red-500/30 text-left cursor-pointer shadow-xs"
                                >
                                    <div className="w-6 h-6 rounded-lg bg-red-500/10 text-red-500 flex items-center justify-center shrink-0">
                                        <UserMinus className="w-3.5 h-3.5" />
                                    </div>
                                    <div className="truncate">
                                        <div className="font-bold text-xs truncate">Clear This Customer</div>
                                        <div className="text-[10px] font-normal text-muted-foreground">Tirtir macmiilkan kaliya</div>
                                    </div>
                                </button>

                                {/* Option 2: Clear All */}
                                <button
                                    type="button"
                                    onClick={() => {
                                        setClearPopoverOpen(false);
                                        setShowClearAllConfirm(true);
                                    }}
                                    disabled={clearingAll}
                                    className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-bold text-red-600 hover:text-red-700 bg-red-500/10 hover:bg-red-500/20 rounded-xl transition-all active:scale-95 border border-red-500/25 hover:border-red-500/40 text-left cursor-pointer shadow-xs"
                                >
                                    <div className="w-6 h-6 rounded-lg bg-red-500/20 text-red-600 flex items-center justify-center shrink-0">
                                        <AlertTriangle className="w-3.5 h-3.5" />
                                    </div>
                                    <div className="truncate">
                                        <div className="font-bold text-xs truncate">Clear All</div>
                                        <div className="text-[10px] font-normal text-muted-foreground">Tirtir dhammaan macaamiisha</div>
                                    </div>
                                </button>
                            </PopoverContent>
                        </Popover>

                        {/* Right: Cancel & Save buttons */}
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={onClose}
                                disabled={saving || clearingCustomer || clearingAll}
                                className="h-8 rounded-xl text-xs font-bold px-3"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                onClick={handleSave}
                                disabled={saving || clearingCustomer || clearingAll}
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

            {/* SAFEGUARDED CONFIRMATION DIALOG FOR CLEAR ALL */}
            <Dialog open={showClearAllConfirm} onOpenChange={setShowClearAllConfirm}>
                <DialogContent className="sm:max-w-[420px] p-6 glass-panel border border-red-500/40 shadow-2xl rounded-2xl">
                    <DialogHeader className="space-y-2">
                        <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center mx-auto border border-red-500/20">
                            <ShieldAlert className="w-6 h-6" />
                        </div>
                        <DialogTitle className="text-center text-lg font-black text-foreground">
                            Ma hubtaa inaad nadiifiso dhammaan qoraalada?
                        </DialogTitle>
                        <DialogDescription className="text-center text-xs text-muted-foreground space-y-2">
                            <span className="block text-red-600 dark:text-red-400 font-bold bg-red-500/10 p-2.5 rounded-xl border border-red-500/20">
                                ⚠️ Digniin: Tani waxay tirtiri doontaa QORAALADA iyo HEERARKA (Sax Saar & Busy) ee dhammaan macaamiisha.
                            </span>
                            <span className="block text-[11px] text-muted-foreground/90 font-medium">
                                Xisaabaadka macmiilka, hadhaaga, taariikhaha Maqalka, lacag-bixinta, iyo buugaagta xisaabta waxba kama badali doonto.
                            </span>
                        </DialogDescription>
                    </DialogHeader>

                    <DialogFooter className="flex sm:flex-row gap-2 pt-4">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setShowClearAllConfirm(false)}
                            disabled={clearingAll}
                            className="w-full sm:w-1/2 h-10 rounded-xl font-bold text-xs"
                        >
                            Ka noqo
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            onClick={handleExecuteClearAll}
                            disabled={clearingAll}
                            className="w-full sm:w-1/2 h-10 rounded-xl font-black text-xs bg-red-600 hover:bg-red-700 text-white gap-1.5 shadow-lg shadow-red-600/30"
                        >
                            {clearingAll ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Nadiifinayaa...
                                </>
                            ) : (
                                <>
                                    <Trash2 className="w-4 h-4" />
                                    Haa, Nadiifi Dhammaan
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
