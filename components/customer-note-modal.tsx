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
    AlertTriangle, 
    Loader2, 
    Save, 
    ShieldAlert
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
    onClearAllSuccess: () => void;
}

export function CustomerNoteModal({
    isOpen,
    onClose,
    customer,
    currentStatus,
    isSuperAdmin = false,
    onSaveSuccess,
    onClearAllSuccess,
}: CustomerNoteModalProps) {
    const [priorityEnabled, setPriorityEnabled] = useState(false);
    const [busyEnabled, setBusyEnabled] = useState(false);
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
    const [clearingAll, setClearingAll] = useState(false);

    // Sync form state whenever modal opens or customer changes
    useEffect(() => {
        if (isOpen && customer) {
            setPriorityEnabled(Boolean(currentStatus?.priority_enabled));
            setBusyEnabled(Boolean(currentStatus?.busy_enabled));
            setNote(currentStatus?.note || '');
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
            if (!res.ok) throw new Error(data.error || 'Failed to save note');

            toast.success(
                data.cleared
                    ? `Qoraalka ${customer.name} waa la tirtiray`
                    : `Qoraalka ${customer.name} si guul leh ayaa loo badbaadiyay`
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

    const handleClearThisCustomer = async () => {
        setClearing(true);
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
            const message = err instanceof Error ? err.message : 'Khalad ayaa dhacay markii la nadiifinayay';
            toast.error(message);
        } finally {
            setClearing(false);
        }
    };

    const handleExecuteClearAll = async () => {
        setClearingAll(true);
        try {
            const token = typeof window !== 'undefined' ? localStorage.getItem('dadwork_session_token') || '' : '';
            // Strictly passes explicit confirmation token required by server safeguard
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
            onClearAllSuccess();
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
                <DialogContent className="sm:max-w-[480px] p-6 glass-panel border border-border/60 shadow-2xl rounded-2xl">
                    <DialogHeader className="space-y-1.5 pb-3 border-b border-border/40">
                        <div className="flex items-center gap-2 text-primary">
                            <BookOpen className="w-5 h-5 text-primary shrink-0" />
                            <DialogTitle className="text-lg font-black tracking-tight text-foreground truncate">
                                {customer.name.toUpperCase()}
                            </DialogTitle>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-bold shrink-0">
                                ID: {customer.customer_code}
                            </span>
                        </div>
                        <DialogDescription className="text-xs text-muted-foreground">
                            Maamul qoraalada iyo heerarka gaarka ah (Priority & Busy). Xisaabaadka ma taabanayo.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-3">
                        {/* Priority Toggle Card */}
                        <div 
                            onClick={() => setPriorityEnabled(!priorityEnabled)}
                            className={cn(
                                "flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer select-none",
                                priorityEnabled 
                                    ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-950 dark:text-emerald-100 shadow-[0_0_12px_rgba(16,185,129,0.15)]" 
                                    : "bg-muted/30 border-border/40 hover:bg-muted/50"
                            )}
                        >
                            <div className="flex items-center gap-3">
                                <div className={cn(
                                    "w-8 h-8 rounded-full flex items-center justify-center font-black transition-colors",
                                    priorityEnabled ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"
                                )}>
                                    <Check className="w-4 h-4" />
                                </div>
                                <div>
                                    <div className="text-sm font-bold flex items-center gap-1.5">
                                        Mudnaan Gaar ah (Priority)
                                        {priorityEnabled && (
                                            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-black">
                                                Active
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-[11px] text-muted-foreground">
                                        Waxay u yeelaysaa calaamadda cagaaran ee ✓ liiska
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

                        {/* Busy Toggle Card */}
                        <div 
                            onClick={() => setBusyEnabled(!busyEnabled)}
                            className={cn(
                                "flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer select-none",
                                busyEnabled 
                                    ? "bg-amber-500/10 border-amber-500/40 text-amber-950 dark:text-amber-100 shadow-[0_0_12px_rgba(245,158,11,0.15)]" 
                                    : "bg-muted/30 border-border/40 hover:bg-muted/50"
                            )}
                        >
                            <div className="flex items-center gap-3">
                                <div className={cn(
                                    "w-8 h-8 rounded-full flex items-center justify-center font-black transition-colors",
                                    busyEnabled ? "bg-amber-500 text-white shadow-[0_0_8px_rgba(245,158,11,0.5)]" : "bg-muted text-muted-foreground"
                                )}>
                                    <Clock className="w-4 h-4" />
                                </div>
                                <div>
                                    <div className="text-sm font-bold flex items-center gap-1.5">
                                        Mashquul (Busy)
                                        {busyEnabled && (
                                            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 font-black">
                                                Active
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-[11px] text-muted-foreground">
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

                        {/* Custom Note Textarea */}
                        <div className="space-y-1.5">
                            <div className="flex justify-between items-center text-xs font-bold text-foreground">
                                <label htmlFor="customer-note-input" className="flex items-center gap-1">
                                    <span>Qoraal Gaar ah (Custom Note)</span>
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
                                placeholder="Tusaale: Wac galabta 4:00, lacagta ha ka qaadin maanta, qiimo gaar ah sii..."
                                rows={3}
                                className="w-full text-sm rounded-xl p-3 bg-background/60 border border-border/60 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-muted-foreground/60 resize-none font-medium"
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

                    <DialogFooter className="flex-col sm:flex-row gap-2 pt-3 border-t border-border/40">
                        {/* Left Side: Danger / Clearing actions */}
                        <div className="flex items-center gap-1 w-full sm:w-auto justify-between sm:justify-start">
                            {(currentStatus?.priority_enabled || currentStatus?.busy_enabled || currentStatus?.note) && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleClearThisCustomer}
                                    disabled={clearing || saving}
                                    className="h-9 px-2 text-xs font-bold text-red-500 hover:text-red-600 hover:bg-red-500/10 gap-1 rounded-xl"
                                >
                                    {clearing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                    Tirtir Macmiilkan
                                </Button>
                            )}
                            {isSuperAdmin && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setShowClearAllConfirm(true)}
                                    disabled={clearing || saving}
                                    className="h-9 px-2 text-[11px] font-bold text-muted-foreground hover:text-red-500 hover:bg-red-500/10 gap-1 rounded-xl ml-auto sm:ml-0"
                                >
                                    <AlertTriangle className="w-3 h-3 text-amber-500" />
                                    Nadiifi Dhammaan
                                </Button>
                            )}
                        </div>

                        {/* Right Side: Primary Actions */}
                        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={onClose}
                                disabled={saving || clearing}
                                className="h-9 rounded-xl text-xs font-bold px-4"
                            >
                                Ka noqo
                            </Button>
                            <Button
                                type="button"
                                onClick={handleSave}
                                disabled={saving || clearing}
                                className="h-9 rounded-xl text-xs font-black px-5 bg-primary text-primary-foreground hover:bg-primary/90 gap-1.5 shadow-md shadow-primary/20"
                            >
                                {saving ? (
                                    <>
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        Keydinayaa...
                                    </>
                                ) : (
                                    <>
                                        <Save className="w-3.5 h-3.5" />
                                        Badbaadi
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
                                ⚠️ Digniin: Tani waxay tirtiri doontaa QORAALADA iyo HEERARKA (Priority & Busy) ee dhammaan macaamiisha.
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
