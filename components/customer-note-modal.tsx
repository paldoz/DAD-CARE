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
    Save, 
    ShieldAlert,
    X,
    ChevronDown,
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
    isSuperAdmin = true,
    onSaveSuccess,
    onClearAllSuccess,
}: CustomerNoteModalProps) {
    const [priorityEnabled, setPriorityEnabled] = useState(false);
    const [busyEnabled, setBusyEnabled] = useState(false);
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);
    const [clearingCustomer, setClearingCustomer] = useState(false);
    const [clearingAll, setClearingAll] = useState(false);
    const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
    const [showClearMenu, setShowClearMenu] = useState(false);

    // Sync form state whenever modal opens or customer changes
    useEffect(() => {
        if (isOpen && customer) {
            setShowClearMenu(false);
            const hasPriority = Boolean(currentStatus?.priority_enabled);
            const hasBusy = Boolean(currentStatus?.busy_enabled);
            
            // In case existing data has both, prioritize Sax Saar
            if (hasPriority) {
                setPriorityEnabled(true);
                setBusyEnabled(false);
                setNote('');
            } else if (hasBusy) {
                setPriorityEnabled(false);
                setBusyEnabled(true);
                setNote(currentStatus?.note || '');
            } else {
                setPriorityEnabled(false);
                setBusyEnabled(false);
                setNote(currentStatus?.note || '');
            }
        }
    }, [isOpen, customer, currentStatus]);

    if (!customer) return null;

    // Toggle Sax Saar: If selected, Mashquul cannot be selected & note cannot be typed
    const handleToggleSaxSaar = () => {
        if (busyEnabled) {
            toast.info('Fadlan marka hore dami Mashquul si aad Sax Saar u doorato');
            return;
        }
        if (priorityEnabled) {
            setPriorityEnabled(false);
        } else {
            setPriorityEnabled(true);
            setBusyEnabled(false);
            setNote(''); // Sax Saar does not take a note
        }
    };

    // Toggle Mashquul: If selected, Sax Saar cannot be selected, but note CAN be typed
    const handleToggleMashquul = () => {
        if (priorityEnabled) {
            toast.info('Fadlan marka hore dami Sax Saar si aad Mashquul u doorato');
            return;
        }
        setBusyEnabled(!busyEnabled);
    };

    // Save current settings (Sax Saar, Mashquul, Note)
    const handleSave = async () => {
        setSaving(true);
        try {
            const token = typeof window !== 'undefined' ? localStorage.getItem('dadwork_session_token') || '' : '';
            
            // Enforce business rules before sending
            const finalPriority = priorityEnabled;
            const finalBusy = !finalPriority && busyEnabled;
            const finalNote = finalPriority ? '' : note.trim();

            const res = await fetch('/api/customer-note-status', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'x-session-token': token } : {}),
                },
                body: JSON.stringify({
                    customerId: customer.id,
                    priorityEnabled: finalPriority,
                    busyEnabled: finalBusy,
                    note: finalNote,
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

    // Check if this customer currently has any active status or note
    const hasCustomerData = Boolean(
        priorityEnabled || 
        busyEnabled || 
        note.trim() || 
        currentStatus?.priority_enabled || 
        currentStatus?.busy_enabled || 
        (currentStatus?.note && currentStatus.note.trim())
    );

    // Clear Customer: Clears Sax Saar, Mashquul, and Note completely for THIS customer
    const handleClearCustomer = async () => {
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
            if (!res.ok) throw new Error(data.error || 'Failed to clear customer status');

            setPriorityEnabled(false);
            setBusyEnabled(false);
            setNote('');
            toast.success(`Xaaladaha ${customer.name} waa la tirtiray (Sax Saar, Mashquul, Note)`);
            onSaveSuccess(null);
            onClose();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Khalad ayaa dhacay markii la tirtirayay xaaladda';
            toast.error(message);
        } finally {
            setClearingCustomer(false);
        }
    };

    // Clear All: Bulk clears all customer notes, Sax Saar, and Mashquul statuses
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

            toast.success(`Macaamiishaada priority ah waa la nadiifiyay (${data.count || 0} macmiil)`);
            setShowClearAllConfirm(false);
            if (onClearAllSuccess) {
                onClearAllSuccess();
            }
            onClose();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Khalad ayaa dhacay markii la tirtirayay dhammaan xaaladaha';
            toast.error(message);
        } finally {
            setClearingAll(false);
        }
    };

    return (
        <>
            <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
                <DialogContent className="sm:max-w-[440px] p-5 glass-panel border border-border/60 shadow-2xl rounded-2xl">
                    <DialogHeader className="space-y-1 pb-2.5 border-b border-border/40">
                        <div className="flex items-center gap-2 text-primary">
                            <BookOpen className="w-4 h-4 text-primary shrink-0" />
                            <DialogTitle className="text-base font-black tracking-tight text-foreground truncate">
                                {customer.name}
                            </DialogTitle>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 shrink-0 font-bold">
                                ID: {customer.customer_code}
                            </span>
                        </div>
                        <DialogDescription className="text-[11px] text-muted-foreground">
                            Dooro midkood: Sax Saar AMA Mashquul. Xisaabaadka waxba kama badalo.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3 py-2">
                        {/* ✓ 📞 Sax Saar Toggle Card */}
                        <div 
                            onClick={handleToggleSaxSaar}
                            className={cn(
                                "flex items-center justify-between p-2.5 rounded-xl border transition-all select-none",
                                busyEnabled 
                                    ? "opacity-35 cursor-not-allowed bg-muted/15 border-border/20" 
                                    : "cursor-pointer",
                                priorityEnabled 
                                    ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-950 dark:text-emerald-100 shadow-[0_0_10px_rgba(16,185,129,0.12)]" 
                                    : (!busyEnabled && "bg-muted/30 border-border/40 hover:bg-muted/50")
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
                                        {busyEnabled && (
                                            <span className="text-[9px] text-muted-foreground font-normal italic">
                                                (Xiran yahay)
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground">
                                        Sax saar haddii aad wacday 📞
                                    </div>
                                </div>
                            </div>
                            <Switch 
                                checked={priorityEnabled} 
                                disabled={busyEnabled}
                                onCheckedChange={handleToggleSaxSaar}
                                className="data-[state=checked]:bg-emerald-500"
                                onClick={(e) => e.stopPropagation()}
                            />
                        </div>

                        {/* 🕒 Mashquul Toggle Card (Red Theme) */}
                        <div 
                            onClick={handleToggleMashquul}
                            className={cn(
                                "flex items-center justify-between p-2.5 rounded-xl border transition-all select-none",
                                priorityEnabled 
                                    ? "opacity-35 cursor-not-allowed bg-muted/15 border-border/20" 
                                    : "cursor-pointer",
                                busyEnabled 
                                    ? "bg-red-500/10 border-red-500/40 text-red-950 dark:text-red-100 shadow-[0_0_10px_rgba(239,68,68,0.15)]" 
                                    : (!priorityEnabled && "bg-muted/30 border-border/40 hover:bg-muted/50")
                            )}
                        >
                            <div className="flex items-center gap-2.5">
                                <div className={cn(
                                    "w-7 h-7 rounded-full flex items-center justify-center font-black transition-colors",
                                    busyEnabled ? "bg-red-500 text-white shadow-[0_0_8px_rgba(239,68,68,0.5)]" : "bg-muted text-muted-foreground"
                                )}>
                                    <Clock className="w-3.5 h-3.5" />
                                </div>
                                <div>
                                    <div className="text-xs font-bold flex items-center gap-1.5">
                                        <span>🕒 Mashquul</span>
                                        {busyEnabled && (
                                            <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-red-500/20 text-red-600 dark:text-red-400 font-black">
                                                Active
                                            </span>
                                        )}
                                        {priorityEnabled && (
                                            <span className="text-[9px] text-muted-foreground font-normal italic">
                                                (Xiran yahay)
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground">
                                        Saar haddii uu telka ka qaban waayo 📞
                                    </div>
                                </div>
                            </div>
                            <Switch 
                                checked={busyEnabled} 
                                disabled={priorityEnabled}
                                onCheckedChange={handleToggleMashquul}
                                className="data-[state=checked]:bg-red-500"
                                onClick={(e) => e.stopPropagation()}
                            />
                        </div>

                        {/* Note Input (Max 23 Characters) — Disabled when Sax Saar is active */}
                        <div className={cn("space-y-1 transition-opacity", priorityEnabled && "opacity-50")}>
                            <div className="flex justify-between items-center text-xs font-bold text-foreground">
                                <label htmlFor="customer-note-input" className="flex items-center gap-1">
                                    <span>Note</span>
                                    {priorityEnabled && (
                                        <span className="text-[10px] text-muted-foreground font-normal italic">
                                            (Sax Saar uma baahna qoraal)
                                        </span>
                                    )}
                                </label>
                                <span className={cn(
                                    "text-[10px] font-mono",
                                    note.length >= 20 ? "text-amber-500 font-bold" : "text-muted-foreground"
                                )}>
                                    {note.length}/23
                                </span>
                            </div>
                            <div className="relative">
                                <input
                                    id="customer-note-input"
                                    type="text"
                                    maxLength={23}
                                    value={note}
                                    disabled={priorityEnabled}
                                    onChange={(e) => setNote(e.target.value.slice(0, 23))}
                                    placeholder={
                                        priorityEnabled 
                                            ? "Sax Saar qoraal uma baahna" 
                                            : "Ku qor wuxuu ku yiri sida: hadhow i soo wac..."
                                    }
                                    className={cn(
                                        "w-full text-xs rounded-xl pl-3 pr-8 py-2.5 border outline-none transition-all font-medium",
                                        priorityEnabled 
                                            ? "bg-muted/30 border-border/30 text-muted-foreground cursor-not-allowed placeholder:text-muted-foreground/40"
                                            : "bg-background/60 border-border/60 focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/60"
                                    )}
                                />
                                {!priorityEnabled && note.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setNote('')}
                                        title="Clear text note"
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground p-0.5 rounded-full cursor-pointer"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Metadata if updated previously */}
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
                        {/* Left: Clear button with tiny two options */}
                        <div className="relative">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setShowClearMenu(!showClearMenu)}
                                disabled={saving || clearingCustomer || clearingAll}
                                className={cn(
                                    "h-8 px-2.5 text-xs font-bold gap-1 rounded-xl shadow-xs transition-all active:scale-95 border-red-500/30 text-red-500 hover:text-red-600 hover:bg-red-500/10 cursor-pointer touch-manipulation",
                                    showClearMenu && "bg-red-500/15 border-red-500/50"
                                )}
                            >
                                {clearingCustomer || clearingAll ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                    <Trash2 className="w-3.5 h-3.5" />
                                )}
                                <span>Clear</span>
                                <ChevronDown className={cn("w-3 h-3 transition-transform duration-200", showClearMenu && "rotate-180")} />
                            </Button>

                            {/* Tiny Two Options Menu */}
                            {showClearMenu && (
                                <>
                                    {/* Backdrop for closing menu on outside click or touch */}
                                    <div 
                                        className="fixed inset-0 z-40 touch-manipulation" 
                                        onClick={() => setShowClearMenu(false)}
                                        onTouchStart={() => setShowClearMenu(false)}
                                    />
                                    <div className="absolute bottom-full left-0 mb-1.5 z-50 min-w-[180px] p-1.5 bg-popover/95 backdrop-blur-md border border-border/70 shadow-2xl rounded-xl space-y-1 animate-in fade-in zoom-in-95 duration-150">
                                        {/* Option 1: Clear this customer */}
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setShowClearMenu(false);
                                                handleClearCustomer();
                                            }}
                                            disabled={!hasCustomerData || clearingCustomer}
                                            className={cn(
                                                "w-full flex items-center gap-2 px-2.5 py-2 text-xs font-bold rounded-lg text-left transition-colors touch-manipulation",
                                                hasCustomerData 
                                                    ? "hover:bg-red-500/10 active:bg-red-500/20 text-red-500 hover:text-red-600 cursor-pointer" 
                                                    : "opacity-40 text-muted-foreground cursor-not-allowed pointer-events-none"
                                            )}
                                        >
                                            <Trash2 className="w-3.5 h-3.5 shrink-0" />
                                            <span>Clear this customer</span>
                                        </button>

                                        {/* Option 2: Clear all */}
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setShowClearMenu(false);
                                                setShowClearAllConfirm(true);
                                            }}
                                            disabled={clearingAll}
                                            className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-bold rounded-lg text-left hover:bg-red-500/10 active:bg-red-500/20 text-red-600 dark:text-red-400 hover:text-red-700 transition-colors cursor-pointer border-t border-border/30 pt-2 touch-manipulation"
                                        >
                                            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                                            <span>Clear all</span>
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Right: Cancel & Save */}
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

            {/* CONFIRMATION DIALOG FOR CLEAR ALL */}
            <Dialog open={showClearAllConfirm} onOpenChange={setShowClearAllConfirm}>
                <DialogContent className="sm:max-w-[420px] p-6 glass-panel border border-red-500/40 shadow-2xl rounded-2xl">
                    <DialogHeader className="space-y-2">
                        <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center mx-auto border border-red-500/20">
                            <ShieldAlert className="w-6 h-6" />
                        </div>
                        <DialogTitle className="text-center text-lg font-black text-foreground">
                            Nadiifi macaamiishaada priority ah?
                        </DialogTitle>
                        <DialogDescription className="text-center text-xs text-muted-foreground space-y-2">
                            <span className="block text-red-600 dark:text-red-400 font-bold bg-red-500/10 p-2.5 rounded-xl border border-red-500/20">
                                ⚠️ Digniin: Tani waxay tirtiri doontaa Sax Saar, Mashquul, iyo Qoraalada <strong>macaamiishaada priority ah oo kaliya</strong> — macaamiisha kale ma saameyn doonto.
                            </span>
                            <span className="block text-[11px] text-muted-foreground/90 font-medium">
                                Xisaabaadka, hadhaaga, lacag-bixinta, iyo buugaagta xisaabta waxba kama badali doonto.
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
                            className="w-full sm:w-1/2 h-10 rounded-xl font-black text-xs bg-red-600 hover:bg-red-700 text-white gap-1.5 shadow-lg shadow-red-600/30 cursor-pointer"
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
