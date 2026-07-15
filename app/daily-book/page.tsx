'use client';

import { useState, useEffect } from 'react';
import { mutate as swrMutate } from 'swr';
import { format, addDays, parseISO, isSameDay } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AddCustomerDialog } from '@/components/add-customer-dialog';
import { CalendarIcon, Save, Plus, FileText, Edit, ChevronDown, ChevronRight, Search, BookOpen, Trash2, User, Loader2, Package, MessageSquare, Maximize2, Minimize2, Download, ShieldAlert, X, Scale, ArrowRightLeft } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Switch } from '@/components/ui/switch';
import { SecurityVerificationDialog } from '@/components/security-verification-dialog';
import { useDailyBookInit, useDailyBookDate, useLedgerStatusForDate, useDailyBookHistory } from '@/hooks/useDailyBook';
import { DailyBookErrorBoundary } from './error-boundary';
import { useSession } from '@/hooks/useSession';
import { AnimatedBackground } from '@/components/animated-background';

interface Customer {
    id: string;
    name: string;
    customer_code: string;
    gender?: string;
    phone?: string;
    avatar_url?: string;
}

interface DailyBookItem {
    customer_id: string;
    kg: number;
    present?: boolean;
    note?: string;
    customer?: {
        id: string;
        name: string;
        customer_code: string;
        gender?: string;
        avatar_url?: string;
    };
}

interface SavedEntry {
    date: string;
    totalKg: number;
    items: DailyBookItem[];
}

function getVipCount(note: string | undefined, fallbackKg: number = 0): number {
    if (!note) return 0;
    const lower = note.toLowerCase();
    if (!lower.includes('vip')) return 0;
    
    const regex = /(\d+(?:\.\d+)?)\s*vip/g;
    let match;
    let totalCount = 0;
    let found = false;
    while ((match = regex.exec(lower)) !== null) {
        found = true;
        totalCount += parseFloat(match[1]);
    }
    return found ? totalCount : fallbackKg;
}

function getFormattedNoteBadges(note: string | undefined): { text: string, isVip: boolean }[] {
    if (!note) return [];
    const parts = note.split(',').map(s => s.trim()).filter(s => s);
    const badges = [];
    for (const part of parts) {
        const isVip = part.toLowerCase().includes('vip');
        const match = part.match(/^(\d+)\s+([a-zA-Z]+)(?:\s+(\d+))?$/);
        if (match) {
            const count = match[1];
            const label = match[2];
            const price = match[3];
            badges.push({ text: price ? `${count} ${label.toUpperCase()} @ $${price}` : `${count} ${label.toUpperCase()}`, isVip });
        } else {
            badges.push({ text: part, isVip });
        }
    }
    return badges;
}


function DailyBookPageInner() {
    const [date, setDate] = useState<Date>(new Date());
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [entries, setEntries] = useState<{ [key: string]: { kg: number, present: boolean, note: string } }>({});
    const [saving, setSaving] = useState(false);
    const [savedEntries, setSavedEntries] = useState<SavedEntry[]>([]);
    const [viewMode, setViewMode] = useState<'edit' | 'details'>('edit');
    const [editingDate, setEditingDate] = useState<string | null>(null);
    const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
    const [focusedEntry, setFocusedEntry] = useState<SavedEntry | null>(null);
    const [searchDate, setSearchDate] = useState<Date | undefined>(undefined);
    const [searchTerm, setSearchTerm] = useState('');
    const [latestSavedDateStr, setLatestSavedDateStr] = useState<string | null>(null);
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [visibleEntriesCount, setVisibleEntriesCount] = useState(10);
    const [processedCustomerIds, setProcessedCustomerIds] = useState<Set<string>>(new Set());
    const [loadingLedgerStatus, setLoadingLedgerStatus] = useState(false);
    const [historyLedgerStatus, setHistoryLedgerStatus] = useState<Record<string, Set<string>>>({});
    const [deleteConfirmDate, setDeleteConfirmDate] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const [pendingDeleteCustomerId, setPendingDeleteCustomerId] = useState<string | null>(null);
    const [isDeletingCustomer, setIsDeletingCustomer] = useState(false);
    const [openNoteForCustomerId, setOpenNoteForCustomerId] = useState<string | null>(null);
    const [absentPopupData, setAbsentPopupData] = useState<{ date: string; items: DailyBookItem[] } | null>(null);
    const [vipPopupData, setVipPopupData] = useState<{ date: string; items: DailyBookItem[] } | null>(null);
    const [compareModalOpen, setCompareModalOpen] = useState(false);
    const [compareDate1, setCompareDate1] = useState<string | null>(null);
    const [compareDate2, setCompareDate2] = useState<string | null>(null);
    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const pageSize = 50; // fixed page size for fastest UI response

    // Debounce hook for search input (300 ms)
    const useDebounce = <T,>(value: T, delay: number): T => {
        const [debounced, setDebounced] = useState(value);
        useEffect(() => {
            const handler = setTimeout(() => setDebounced(value), delay);
            return () => clearTimeout(handler);
        }, [value, delay]);
        return debounced;
    };
    const debouncedSearchTerm = useDebounce(searchTerm, 300);

    const { session } = useSession();
    const isSuperAdmin = session?.role === 'SUPER_ADMIN';

    // ⚡ SWR Hooks for Lightning Fast Caching
    const { data: initData, isError: initError, mutate: mutateInit } = useDailyBookInit();
    const loadInit = () => mutateInit(); // Used by AddCustomerDialog to refresh after adding a customer
    const dateStr = format(date, 'yyyy-MM-dd');
    const { data: bookData } = useDailyBookDate(isInitialized ? dateStr : null);
    const { processedCustomerIds: swrLedgerIds, isLoading: swrLedgerLoading, mutate: mutateLedger } = useLedgerStatusForDate(dateStr);
    const { data: historyData, mutate: mutateHistory, size, setSize, isLoadingMore, isReachingEnd } = useDailyBookHistory();

    // Sync SWR Init Data to Local State (Protects Optimistic UI)
    useEffect(() => {
        if (initData && typeof initData === 'object' && initData.customers) {
            setCustomers(initData.customers);
            
            if (!isInitialized) {
                // Only load history from initData ONCE on initial load.
                // Subsequent updates will rely on useDailyBookHistory's SWR or optimistic UI.
                if (Array.isArray(initData.history)) {
                    setSavedEntries(initData.history);
                }
                
                if (initData.latestDate) {
                    setLatestSavedDateStr(initData.latestDate);
                    if (!editingDate) {
                        setDate(addDays(parseISO(initData.latestDate), 1));
                    }
                }
                setIsInitialized(true);
            }
        } else if (initData === undefined) {
             // Still loading, do nothing
        } else {
             // null (error) or empty — safely release the initialized lock
             setIsInitialized(true);
        }
    }, [initData, editingDate, isInitialized]);

    // Sync SWR Book Data to Local Entries — only while in edit mode to avoid overwriting optimistic UI
    useEffect(() => {
        if (!editingDate && viewMode !== 'edit') return; // only sync when actively editing
        if (bookData && bookData.items) {
            const loadedEntries: { [key: string]: { kg: number, present: boolean, note: string } } = {};
            bookData.items.forEach((item: DailyBookItem) => {
                loadedEntries[item.customer_id] = { kg: item.kg || 0, present: item.present ?? true, note: item.note || '' };
            });
            setEntries(loadedEntries);
        } else if (bookData === null) {
            setEntries({});
        }
    }, [bookData, editingDate, viewMode]);

    // Helper to attach customer objects locally to save massive API bandwidth
    const populateHistoryWithCustomers = (historyArray: any[]) => {
        if (!historyArray || !Array.isArray(historyArray)) return [];
        return historyArray.map(entry => ({
            ...entry,
            items: entry.items.map((item: any) => ({
                ...item,
                customer: customers.find(c => c.id === item.customer_id) || item.customer
            }))
        }));
    };

    // Sync SWR History Data to Local State
    // IMPORTANT: Do NOT sync while saving — the server data might be stale
    // and would overwrite the confirmed local entry we just set.
    useEffect(() => {
        if (saving) return; // Never overwrite during an active save
        if (Array.isArray(historyData)) {
            setSavedEntries(populateHistoryWithCustomers(historyData));
        }
    }, [historyData, customers]); // do NOT add `saving` here — we want it to fire on data change only



    // Sync SWR Ledger Status to Local State
    useEffect(() => {
        setProcessedCustomerIds(swrLedgerIds);
        setLoadingLedgerStatus(swrLedgerLoading);
    }, [swrLedgerIds, swrLedgerLoading]);

    const fetchLatestDate = async () => {
        try {
            const res = await fetch('/api/daily-book-dates');
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
                const latest = data[0].date;
                setLatestSavedDateStr(latest);
                if (!editingDate) {
                    const nextDate = addDays(parseISO(latest), 1);
                    setDate(nextDate);
                }
            }
        } catch (err) {
            console.error('Failed to fetch latest date', err);
        }
    };



    const handleSave = async () => {
        setSaving(true);
        const dateStr = format(date, 'yyyy-MM-dd');

        const items = Object.entries(entries)
            .filter(([_, data]) => data.kg > 0 || data.present === false || data.note.trim() !== '')
            .map(([customer_id, data]) => ({
                customer_id,
                kg: data.kg,
                present: data.present,
                note: data.note,
                customer: customers.find(c => c.id === customer_id)
            }));

        const previousEntries = [...savedEntries];
        const isNewEntry = !previousEntries.some(e => e.date.substring(0, 10) === dateStr);

        // We do NOT reset the form UI here. We leave it in 'edit' mode so the sticky bar 
        // stays visible and shows the "Saving..." / "Updating..." spinner.

        try {
            // Handle date change: delete old entry first
            const cleanEditingDate = editingDate ? editingDate.substring(0, 10) : null;
            if (cleanEditingDate && cleanEditingDate !== dateStr) {
                try {
                    const delRes = await fetch(`/api/daily-book?date=${cleanEditingDate}`, { method: 'DELETE' });
                    if (!delRes.ok && delRes.status !== 404) {
                        console.error('Failed to delete old entry:', await delRes.text());
                    }
                } catch (delErr) {
                    console.error('Error deleting old entry:', delErr);
                }
            }

            // WAIT for the real server response
            const res = await fetch('/api/daily-book', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: dateStr, items })
            });

            if (!res.ok) {
                setSavedEntries(previousEntries); // Rollback optimistic update
                const errData = await res.json().catch(() => ({}));
                toast.error(errData.error || 'Failed to save entry');
                setSaving(false);
                return;
            }

            // Build the real confirmed entry from what was sent
            const confirmedEntry: SavedEntry = {
                date: dateStr,
                totalKg: items.reduce((sum, item) => sum + item.kg, 0),
                items: items.map(item => ({
                    ...item,
                    customer: customers.find(c => c.id === item.customer_id)
                }))
            };

            // Update local list with the REAL confirmed data
            setSavedEntries(prev => {
                const filtered = prev.filter(e => e.date.substring(0, 10) !== dateStr);
                return [confirmedEntry, ...filtered].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            });

            // NOW reset form and show results (Sticky bar will close gracefully)
            setEntries({});
            setEditingDate(null);
            setLatestSavedDateStr(dateStr);
            setViewMode('details');
            setFocusedEntry(confirmedEntry);

            toast.success(editingDate ? 'Entry updated!' : 'Entry saved!', { description: `${Math.round(confirmedEntry.totalKg)} KG recorded for ${dateStr}` });

        } catch (e: any) {
            console.error('Save error:', e);
            toast.error(e.message || 'Network error while saving');
        } finally {
            setSaving(false);
            // Force fresh REAL data from server — no optimistic cache
            await mutateHistory(undefined, { revalidate: true });
            await mutateInit();
            mutateLedger();
        }
    };

    const handleCancelEdit = () => {
        setEntries({});
        setEditingDate(null);
        if (latestSavedDateStr) {
            setDate(addDays(parseISO(latestSavedDateStr), 1));
        } else {
            setDate(new Date());
        }
        setViewMode('details');
    };

    const handleEditEntry = (entry: SavedEntry) => {
        const selectedDate = parseISO(entry.date);
        const editDateStr = entry.date.substring(0, 10);
        setDate(selectedDate);
        setEntries({}); // Clear entries while it fetches the specific day
        setEditingDate(entry.date);
        setViewMode('edit');
        // Force-revalidate the exact date key in SWR global cache so edit always loads fresh data
        swrMutate(`/api/daily-book?date=${editDateStr}`);
    };

    const handleDeleteEntry = async () => {
        if (!deleteConfirmDate) return;
        setIsDeleting(true);
        const deleteDateStr = deleteConfirmDate.substring(0, 10);
        try {
            const res = await fetch(`/api/daily-book?date=${deleteDateStr}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(await res.text());
            // Remove from local list using date prefix match (handles timestamps vs plain dates)
            setSavedEntries(prev => prev.filter(e => e.date.substring(0, 10) !== deleteDateStr));
            toast.success('Moved to Recycle Bin');
            setDeleteConfirmDate(null);
            mutateHistory(undefined, { revalidate: true }); // Force fresh fetch after delete
        } catch (err: any) {
            toast.error('Failed to move to trash: ' + (err.message || 'Server error'));
        } finally {
            setIsDeleting(false);
        }
    };

    const handleSoftDeleteCustomer = async () => {
        if (!pendingDeleteCustomerId) return;
        setIsDeletingCustomer(true);
        try {
            const token = localStorage.getItem('dadwork_session_token') || '';
            const res = await fetch(`/api/customers?id=${pendingDeleteCustomerId}`, {
                method: 'DELETE',
                headers: { 'x-session-token': token },
            });
            if (!res.ok) throw new Error(await res.text());
            
            // AUTOMATICALLY FIX IDs right after deleting so there are no gaps
            const fixRes = await fetch('/api/resequence-customers', {
                method: 'POST',
                headers: { 'x-session-token': token }
            });
            if (!fixRes.ok) throw new Error('Customer removed, but failed to re-sequence IDs.');

            toast.success('Customer removed & IDs re-sequenced automatically.');
            setPendingDeleteCustomerId(null);
            mutateInit(); // Refresh the init data so the new IDs show up immediately
        } catch (err: any) {
            toast.error('Failed to remove customer: ' + (err.message || 'Server error'));
        } finally {
            setIsDeletingCustomer(false);
        }
    };

    const handleExportBackup = async () => {
        try {
            toast.loading('Fetching full history for backup...', { id: 'pdf-export' });
            const res = await fetch('/api/daily-book-history-full');
            if (!res.ok) throw new Error('Failed to fetch full history');
            const fullHistory = await res.json();
            
            const { downloadDailyBookBackupPDF } = await import('@/lib/export-pdf');
            const populatedHistory = populateHistoryWithCustomers(fullHistory);
            downloadDailyBookBackupPDF(populatedHistory);
            toast.success('Buuga Maalinlaha PDF backup downloaded successfully', { id: 'pdf-export' });
        } catch (e) {
            toast.error('Failed to generate PDF backup', { id: 'pdf-export' });
            console.error(e);
        }
    };

    const handleDateChange = (newDate: Date) => {
        // Mode bypass
        if (editingDate) {
            setDate(newDate);
            return;
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const selected = new Date(newDate);
        selected.setHours(0, 0, 0, 0);

        if (selected > today) {
            toast.error("You cannot enter a date in the future!");
            return;
        }

        if (latestSavedDateStr) {
            const nextRequired = addDays(parseISO(latestSavedDateStr), 1);
            if (!isSameDay(newDate, nextRequired)) {
                toast.error(`Real-life sequence required! The next date must be ${format(nextRequired, 'MMMM dd, yyyy')} because ${format(parseISO(latestSavedDateStr), 'MMMM dd')} was the last entry.`);
                return;
            }
        }
        
        setDate(newDate);
    };

    const totalKg = Object.values(entries).reduce((sum, data) => sum + (parseFloat(String(data.kg)) || 0), 0);
    // Sum ALL vip quantities across all customers based on note
    const totalVip = Object.values(entries).reduce((sum, entry) => sum + getVipCount(entry.note, entry.kg), 0);
    const filteredEntries = searchDate
        ? savedEntries.filter(e => e.date && e.date.substring(0, 10) === format(searchDate, 'yyyy-MM-dd'))
        : savedEntries;

    // sortedEntries: filteredEntries sorted newest-first (API already returns DESC, but ensure it here)
    const sortedEntries = [...filteredEntries].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Use debounced search term for filtering to reduce re‑renders
    const filteredCustomers = customers.filter(c =>
      c.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
      c.customer_code.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
    );

    // Sort by numeric customer_code (fast numeric sort)
    const sortedCustomers = filteredCustomers.sort((a, b) => {
      const codeA = parseInt(a.customer_code.replace(/\D/g, ''), 10) || 0;
      const codeB = parseInt(b.customer_code.replace(/\D/g, ''), 10) || 0;
      return codeA - codeB;
    });

    // Show all customers without pagination slice
    const totalCustomers = sortedCustomers.length;
    const paginatedCustomers = sortedCustomers;



    const handleKeyPress = (e: React.KeyboardEvent, index: number) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            // Find all number inputs in the ledger box
            const ledgerBox = e.currentTarget.closest('[role="region"]'); // Using container if needed or just global
            const inputs = document.querySelectorAll('.ledger-input');
            const nextInput = inputs[index + 1] as HTMLInputElement;
            if (nextInput) {
                nextInput.focus();
                nextInput.select();
                nextInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    };

    if (initError && !initData) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[300px] gap-4">
                <div className="p-4 rounded-full bg-red-100 text-red-600">
                    <ShieldAlert className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-bold text-foreground">Failed to load data</h3>
                <p className="text-sm text-muted-foreground text-center">There was a problem loading the Daily Book.</p>
                <Button onClick={() => window.location.reload()} variant="outline" className="mt-2">
                    Try Again
                </Button>
            </div>
        );
    }

    if (!initData) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[200px] animate-pulse">
                <div className="h-8 w-32 bg-gray-200 rounded mb-2" />
                <div className="h-4 w-48 bg-gray-200 rounded" />
            </div>
        );
    }
return (
        <div className="space-y-6 max-w-4xl mx-auto px-1 md:px-0">
            {/* Customer Soft-Delete Security Verification */}
            <SecurityVerificationDialog
                isOpen={!!pendingDeleteCustomerId}
                onOpenChange={(open) => { if (!open) setPendingDeleteCustomerId(null); }}
                onConfirm={handleSoftDeleteCustomer}
                isProcessing={isDeletingCustomer}
                title="Remove Customer"
                description={`⚠️ Are you sure you want to DELETE "${customers.find(c => c.id === pendingDeleteCustomerId)?.name || 'this customer'}"? This will remove them from Daily Book, Ledger, and all priority lists. This action cannot be undone!`}
            />
            {/* Header / Cover */}
            <div className="relative p-6 md:p-8 rounded-2xl bg-card overflow-hidden border border-border flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-sm">
                <AnimatedBackground />
                
                <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2.5 rounded-xl bg-primary/20 text-primary shadow-inner">
                            <BookOpen className="w-6 h-6" />
                        </div>
                        <h2 className="text-2xl md:text-3xl font-black text-foreground tracking-tight uppercase">Buuga Maalinlaha</h2>
                    </div>
                    <p className="text-muted-foreground text-sm font-medium max-w-md ml-1">
                        Record and manage daily product entries, attendance, and notes for all customers in one centralized location.
                    </p>
                </div>
                
                <div className="relative z-10 flex gap-3 self-start md:self-center">
                    {isSuperAdmin && (
                        <Button
                            variant={viewMode === 'edit' ? 'default' : 'outline'}
                            onClick={() => setViewMode('edit')}
                            className={`h-11 rounded-xl px-5 font-black uppercase tracking-wider text-xs transition-all ${viewMode === 'edit' ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90 hover:-translate-y-0.5' : 'border-border/60 bg-background/50 backdrop-blur-sm text-foreground hover:bg-accent'}`}
                        >
                            <Plus className="w-4 h-4 mr-2 text-current opacity-80" />
                            New Entry
                        </Button>
                    )}
                    <Button
                        variant={viewMode === 'details' ? 'default' : 'outline'}
                        onClick={() => setViewMode('details')}
                        className={`h-11 rounded-xl px-5 font-black uppercase tracking-wider text-xs transition-all ${viewMode === 'details' ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90 hover:-translate-y-0.5' : 'border-border/60 bg-background/50 backdrop-blur-sm text-foreground hover:bg-accent'}`}
                    >
                        <FileText className="w-4 h-4 mr-2 text-current opacity-80" />
                        History <span className="ml-1.5 opacity-70">({Math.max(initData?.historyCount || 0, savedEntries.length)})</span>
                    </Button>
                </div>
            </div>

            {viewMode === 'edit' ? (
                <>
                {/* TRUE FULLSCREEN OVERLAY — covers sidebar + everything */}
                {isFullScreen && (
                    <div className="fixed inset-0 z-[9990] bg-background flex flex-col animate-in fade-in duration-150">
                        {/* Fullscreen Top Bar */}
                        <div className="shrink-0 flex items-center justify-between gap-3 px-3 py-2 border-b border-border bg-card/90 backdrop-blur-sm">
                            <div className="flex items-center gap-2 min-w-0">
                                <BookOpen className="w-4 h-4 text-primary shrink-0" />
                                <span className="font-black text-sm uppercase tracking-tight truncate text-foreground">{format(date, 'MMM dd, yyyy')}</span>
                                {totalKg > 0 && <span className="text-[10px] font-black text-primary bg-primary/10 px-2 py-0.5 rounded-full shrink-0">{Math.round(totalKg)} KG</span>}
                                {totalVip > 0 && <span className="text-[10px] font-black text-amber-600 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full shrink-0">{totalVip} VIP</span>}
                                {editingDate && (
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button variant="outline" size="sm" className="h-7 px-2 text-[10px] font-bold border-primary/30 text-primary bg-primary/5 hover:bg-primary/10 shrink-0">
                                                <CalendarIcon className="w-3 h-3 mr-1" />
                                                Change Date
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0 bg-popover border-border shadow-xl z-[10000]">
                                            <Calendar mode="single" selected={date} onSelect={(newDate) => newDate && handleDateChange(newDate)} className="rounded-md border-0" />
                                        </PopoverContent>
                                    </Popover>
                                )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                {editingDate && (
                                    <Button variant="ghost" size="sm" onPointerDown={(e) => e.preventDefault()} onClick={() => { setEntries({}); setEditingDate(null); setDate(new Date()); }} className="h-8 px-3 text-[10px] font-bold uppercase text-muted-foreground">Cancel</Button>
                                )}
                                <Button onClick={handleSave} onPointerDown={(e) => e.preventDefault()} disabled={saving || totalKg === 0} size="sm" className="h-8 px-4 text-[10px] font-black uppercase bg-primary text-primary-foreground shadow-md">
                                    {saving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
                                    {editingDate ? 'Update' : 'Save'}
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => setIsFullScreen(false)} className="h-8 w-8 text-muted-foreground hover:text-foreground">
                                    <Minimize2 className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>

                        {/* Search bar */}
                        <div className="shrink-0 px-3 py-2 border-b border-border bg-card/50">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input placeholder="Search customers..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 h-10 bg-background border-input focus:border-primary shadow-sm w-full" autoFocus />
                            </div>
                        </div>

                        {/* Scrollable customer table — fills all remaining space */}
                        <div className="flex-1 overflow-hidden relative">
                            <div className="h-full bg-[#fcf8f1] dark:bg-slate-900 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 scrollbar-track-transparent">
                                {/* Vertical Ledger Margin Line */}
                                <div className="absolute left-[50px] md:left-[70px] top-0 bottom-0 w-[1px] bg-red-400 dark:bg-red-900/50 pointer-events-none z-20" />
                                {/* Sticky col headers */}
                                <div className="sticky top-0 z-30 grid grid-cols-12 px-2 md:px-4 py-2 bg-[#f4ece0] dark:bg-slate-950 border-b-2 border-slate-300 dark:border-slate-700 shadow-sm">
                                    <div className="col-span-2 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-tighter">ID</div>
                                    <div className="col-span-5 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-tighter pl-4">Customer Name</div>
                                    <div className="col-span-2 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-tighter text-center">Status</div>
                                    <div className="col-span-3 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-tighter text-right">KG</div>
                                </div>
                                <div className="divide-y divide-blue-200/30 dark:divide-slate-800/50">
                                    {paginatedCustomers.map((customer, index) => (
                                        <div key={customer.id} className="grid grid-cols-12 items-center px-2 md:px-4 py-1.5 transition-colors hover:bg-blue-100/20 dark:hover:bg-slate-800/30 group border-b border-blue-50/50 dark:border-slate-800/30 last:border-0">
                                            <div className="col-span-2 flex items-center justify-start gap-1">
                                                <span className="text-[10px] md:text-[11px] font-mono font-bold text-slate-400 dark:text-slate-500 group-hover:text-primary transition-colors">#{customer.customer_code}</span>
                                                {isSuperAdmin && (
                                                    <button
                                                        title="Remove customer from Daily Book (history preserved)"
                                                        onClick={() => setPendingDeleteCustomerId(customer.id)}
                                                        className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 h-4 w-4 flex items-center justify-center rounded text-red-400/60 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 shrink-0"
                                                    >
                                                        <Trash2 className="w-2.5 h-2.5" />
                                                    </button>
                                                )}
                                            </div>
                                            <div className="col-span-5 flex flex-col justify-center pl-4 border-l border-red-200/50 dark:border-red-900/30">
                                                <div className="relative inline-flex items-center gap-1.5 w-fit max-w-full">
                                                    <span className="font-bold text-[11px] md:text-sm text-slate-700 dark:text-slate-300 uppercase truncate">{customer.name}</span>
                                                    {entries[customer.id]?.kg > 0 && (
                                                        processedCustomerIds.has(customer.id) ? (
                                                            <span title="Processed in Buuga Maqalka" className="shrink-0 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[8px] font-black leading-none">✓</span>
                                                        ) : (
                                                            <span title="Not yet in Buuga Maqalka" className="shrink-0 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 text-[8px] font-black leading-none animate-pulse">!</span>
                                                        )
                                                    )}
                                                    <div className="absolute -bottom-0.5 left-0 w-full h-[1px] bg-blue-200/50 dark:bg-slate-700 pointer-events-none" />
                                                </div>
                                            </div>
                                            <div className="col-span-2 flex items-center justify-center gap-1.5 px-1">
                                                <button onClick={() => setEntries({ ...entries, [customer.id]: { kg: entries[customer.id]?.kg || 0, note: entries[customer.id]?.note || '', present: !(entries[customer.id]?.present ?? true) } })} className={`h-5 w-5 md:h-6 md:w-6 rounded flex items-center justify-center text-[10px] md:text-[11px] font-black transition-colors border ${entries[customer.id]?.present !== false ? 'bg-green-100/50 border-green-200 text-green-700 hover:bg-green-100 dark:bg-green-900/20 dark:border-green-900/50 dark:text-green-400' : 'bg-red-100/50 border-red-200 text-red-700 hover:bg-red-100 dark:bg-red-900/20 dark:border-red-900/50 dark:text-red-400'}`}>
                                                    {entries[customer.id]?.present !== false ? 'P' : 'A'}
                                                </button>
                                                <Popover open={openNoteForCustomerId === customer.id} onOpenChange={(o) => setOpenNoteForCustomerId(o ? customer.id : null)}>
                                                    <PopoverTrigger asChild>
                                                        <Button variant="ghost" size="sm" className={`h-5 w-5 md:h-6 md:w-6 p-0 rounded-md hover:bg-blue-100 dark:hover:bg-slate-800 ${entries[customer.id]?.note ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'text-slate-300 dark:text-slate-600'}`}>
                                                            <MessageSquare className="w-3 h-3 md:w-3.5 md:h-3.5" />
                                                        </Button>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-60 p-3 bg-popover border-border shadow-xl rounded-xl z-[10000]">
                                                        <div className="space-y-2">
                                                            <h4 className="font-medium text-xs text-muted-foreground leading-none">Note for {customer.name}</h4>
                                                            <p className="text-[10px] text-muted-foreground/60">Tip: <span className="font-bold text-amber-600">10 vip 38, 10 vip 37</span> for split VIP prices</p>
                                                            <Input placeholder="e.g. 10 vip 38, 10 vip 37" value={entries[customer.id]?.note || ''} onChange={(e) => setEntries({ ...entries, [customer.id]: { kg: entries[customer.id]?.kg || 0, present: entries[customer.id]?.present ?? true, note: e.target.value } })} className="h-8 text-xs bg-background border-input focus-visible:ring-1 focus-visible:ring-primary shadow-none" autoFocus />
                                                            <Button size="sm" className="w-full h-7 text-xs" onClick={() => setOpenNoteForCustomerId(null)}>Done</Button>
                                                        </div>
                                                    </PopoverContent>
                                                </Popover>
                                            </div>
                                            <div className="col-span-3 flex items-center justify-end gap-1">
                                                <div className="flex items-center justify-end gap-1 relative w-full">
                                                    {(() => {
                                                        const note = entries[customer.id]?.note || '';
                                                        const isVip = note.toLowerCase().includes('vip');
                                                        return isVip ? (
                                                            <button onClick={() => setOpenNoteForCustomerId(customer.id)} title="Click to edit VIP note" className="inline-flex flex-col items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 text-yellow-950 shadow-[0_0_12px_rgba(251,191,36,0.6)] border border-yellow-200 whitespace-nowrap animate-pulse cursor-pointer hover:scale-105 active:scale-95 transition-transform gap-0.5">
                                                                <span>👑 VIP</span>
                                                            </button>
                                                        ) : null;
                                                    })()}
                                                    <Input type="number" step="1" placeholder="0" inputMode="decimal" value={entries[customer.id]?.kg || ''} disabled={entries[customer.id]?.present === false} onChange={(e) => setEntries({ ...entries, [customer.id]: { present: entries[customer.id]?.present ?? true, note: entries[customer.id]?.note || '', kg: parseInt(e.target.value, 10) || 0 } })} onKeyDown={(e) => handleKeyPress(e, index)} className={`ledger-input h-7 w-16 md:w-20 text-right font-black text-sm md:text-base border-0 border-b border-transparent rounded-none bg-transparent transition-all px-1 focus-visible:ring-0 shadow-none hover:border-blue-300 ${entries[customer.id]?.kg > 0 ? 'border-primary text-primary bg-primary/5 dark:bg-primary/10' : 'text-slate-400 dark:text-slate-500'} ${entries[customer.id]?.present === false ? 'opacity-50' : ''}`} />
                                                </div>
                                                {(entries[customer.id]?.kg > 0 || entries[customer.id]?.present === false || entries[customer.id]?.note) && (
                                                    <Button variant="ghost" size="sm" onClick={() => { const n = { ...entries }; delete n[customer.id]; setEntries(n); }} className="h-8 w-8 md:h-6 md:w-6 p-0 text-red-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">
                                                        <Trash2 className="w-4 h-4 md:w-3 md:h-3" />
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* NORMAL CARD (shown when not fullscreen) */}
                {!isFullScreen && (
                <Card className="glass-card">
                    <CardHeader className="border-b border-border bg-muted/20">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div>
                                <CardTitle className="text-foreground flex items-center gap-2">
                                    <BookOpen className="w-5 h-5 text-primary" />
                                    {editingDate ? 'Updating' : 'New'} Entry
                                </CardTitle>
                                <CardDescription className="text-muted-foreground">
                                    {format(date, 'MMMM dd, yyyy')}
                                </CardDescription>
                            </div>
                            <div className="flex gap-2">
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant="outline" className="border-border text-foreground hover:bg-accent hover:text-accent-foreground">
                                            <CalendarIcon className="mr-2 h-4 w-4" />
                                            Select Date
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0 bg-popover border-border shadow-xl">
                                        <Calendar mode="single" selected={date} onSelect={(newDate) => newDate && handleDateChange(newDate)} className="rounded-md border-0" />
                                    </PopoverContent>
                                </Popover>
                                <AddCustomerDialog onSuccess={loadInit} nextId={(Math.max(0, ...customers.map(c => parseInt(c.customer_code.replace(/\D/g, '')) || 0)) + 1).toString()} />
                                <Button variant="outline" size="icon" onClick={() => setIsFullScreen(true)} className="h-10 w-10 text-muted-foreground hover:text-primary border-border" title="Enter Full Screen">
                                    <Maximize2 className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        {/* Search bar */}
                        <div className="p-3 border-b border-border bg-card/50 flex items-center gap-2">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input placeholder="Search customers..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 h-10 bg-background border-input focus:border-primary shadow-sm" />
                            </div>
                        </div>

                        {customers.length === 0 ? (
                            <div className="text-center py-12 text-muted-foreground">
                                <div className="bg-muted w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"><BookOpen className="w-8 h-8 text-primary" /></div>
                                <p className="font-medium">No customers found</p>
                                <p className="text-sm mt-1">Add a new customer to start recording entries</p>
                            </div>
                        ) : (
                            <div className="bg-[#fcf8f1] dark:bg-slate-900 relative overflow-hidden rounded-sm border border-slate-300 dark:border-slate-800 shadow-inner pb-48 md:pb-0 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 scrollbar-track-transparent h-[60vh] md:h-[480px]">
                                <div className="absolute left-[50px] md:left-[70px] top-0 bottom-0 w-[1px] bg-red-400 dark:bg-red-900/50 pointer-events-none z-20" />
                                <div className="sticky top-0 z-30 grid grid-cols-12 px-2 md:px-4 py-2 bg-[#f4ece0] dark:bg-slate-950 border-b-2 border-slate-300 dark:border-slate-700 shadow-sm">
                                    <div className="col-span-2 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-tighter">ID</div>
                                    <div className="col-span-5 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-tighter pl-4">Customer Name</div>
                                    <div className="col-span-2 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-tighter text-center">Status</div>
                                    <div className="col-span-3 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-tighter text-right">KG</div>
                                </div>
                                <div className="divide-y divide-blue-200/30 dark:divide-slate-800/50">
                                    {paginatedCustomers.map((customer, index) => (
                                        <div key={customer.id} className="grid grid-cols-12 items-center px-2 md:px-4 py-1 transition-colors hover:bg-blue-100/20 dark:hover:bg-slate-800/30 group border-b border-blue-50/50 dark:border-slate-800/30 last:border-0 relative">
                                            <div className="col-span-2 flex items-center justify-start gap-1">
                                                <span className="text-[10px] md:text-[11px] font-mono font-bold text-slate-400 dark:text-slate-500 group-hover:text-primary transition-colors">#{customer.customer_code}</span>
                                                {isSuperAdmin && (
                                                    <button
                                                        title="Remove customer from Daily Book (history preserved)"
                                                        onClick={() => setPendingDeleteCustomerId(customer.id)}
                                                        className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 h-4 w-4 flex items-center justify-center rounded text-red-400/60 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 shrink-0"
                                                    >
                                                        <Trash2 className="w-2.5 h-2.5" />
                                                    </button>
                                                )}
                                            </div>
                                            <div className="col-span-5 flex flex-col justify-center pl-4 border-l border-red-200/50 dark:border-red-900/30">
                                                <div className="relative inline-flex items-center gap-1.5 w-fit max-w-full">
                                                    <span className="font-bold text-[11px] md:text-sm text-slate-700 dark:text-slate-300 uppercase truncate">{customer.name}</span>
                                                    {entries[customer.id]?.kg > 0 && (
                                                        processedCustomerIds.has(customer.id) ? (
                                                            <span title="Processed in Buuga Maqalka" className="shrink-0 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[8px] font-black leading-none">✓</span>
                                                        ) : (
                                                            <span title="Not yet in Buuga Maqalka" className="shrink-0 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 text-[8px] font-black leading-none animate-pulse">!</span>
                                                        )
                                                    )}
                                                    <div className="absolute -bottom-0.5 left-0 w-full h-[1px] bg-blue-200/50 dark:bg-slate-700 pointer-events-none" />
                                                </div>
                                            </div>
                                            <div className="col-span-2 flex items-center justify-center gap-1.5 px-1">
                                                <button onPointerDown={(e) => e.preventDefault()} onClick={() => setEntries({ ...entries, [customer.id]: { kg: entries[customer.id]?.kg || 0, note: entries[customer.id]?.note || '', present: !(entries[customer.id]?.present ?? true) } })} className={`h-8 w-8 md:h-9 md:w-9 rounded flex items-center justify-center text-xs md:text-sm font-black transition-all border shadow-sm active:scale-95 ${entries[customer.id]?.present !== false ? 'bg-green-100 border-green-300 text-green-700 hover:bg-green-200 dark:bg-green-900/40 dark:border-green-700/50 dark:text-green-400' : 'bg-red-100 border-red-300 text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:border-red-700/50 dark:text-red-400'}`}>
                                                    {entries[customer.id]?.present !== false ? 'P' : 'A'}
                                                </button>
                                                <Popover open={openNoteForCustomerId === customer.id} onOpenChange={(o) => setOpenNoteForCustomerId(o ? customer.id : null)}>
                                                    <PopoverTrigger asChild>
                                                        <Button variant="ghost" size="sm" onPointerDown={(e) => e.preventDefault()} className={`h-5 w-5 md:h-6 md:w-6 p-0 rounded-md hover:bg-blue-100 dark:hover:bg-slate-800 ${entries[customer.id]?.note ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'text-slate-300 dark:text-slate-600'}`}>
                                                            <MessageSquare className="w-3 h-3 md:w-3.5 md:h-3.5" />
                                                        </Button>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-60 p-3 bg-popover border-border shadow-xl rounded-xl z-[10000]">
                                                        <div className="space-y-2">
                                                            <h4 className="font-medium text-xs text-muted-foreground leading-none">Note for {customer.name}</h4>
                                                            <p className="text-[10px] text-muted-foreground/60">Tip: <span className="font-bold text-amber-600">10 vip 38, 10 vip 37</span> for split VIP prices</p>
                                                            <Input placeholder="e.g. 10 vip 38, 10 vip 37" value={entries[customer.id]?.note || ''} onChange={(e) => setEntries({ ...entries, [customer.id]: { kg: entries[customer.id]?.kg || 0, present: entries[customer.id]?.present ?? true, note: e.target.value } })} className="h-8 text-xs bg-background border-input focus-visible:ring-1 focus-visible:ring-primary shadow-none" autoFocus />
                                                            <Button size="sm" className="w-full h-7 text-xs" onClick={() => setOpenNoteForCustomerId(null)}>Done</Button>
                                                        </div>
                                                    </PopoverContent>
                                                </Popover>
                                            </div>
                                            <div className="col-span-3 flex items-center justify-end gap-1">
                                                <div className="flex items-center justify-end gap-1 relative w-full">
                                                    {(() => {
                                                        const note = entries[customer.id]?.note || '';
                                                        const isVip = note.toLowerCase().includes('vip');
                                                        return isVip ? (
                                                            <button onPointerDown={(e) => e.preventDefault()} onClick={() => setOpenNoteForCustomerId(customer.id)} title="Click to edit VIP note" className="inline-flex flex-col items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 text-yellow-950 shadow-[0_0_12px_rgba(251,191,36,0.6)] border border-yellow-200 whitespace-nowrap animate-pulse cursor-pointer hover:scale-105 active:scale-95 transition-transform gap-0.5">
                                                                <span>👑 VIP</span>
                                                            </button>
                                                        ) : null;
                                                    })()}
                                                    <Input type="number" step="1" placeholder="0" inputMode="decimal" value={entries[customer.id]?.kg || ''} disabled={entries[customer.id]?.present === false} onChange={(e) => setEntries({ ...entries, [customer.id]: { present: entries[customer.id]?.present ?? true, note: entries[customer.id]?.note || '', kg: parseInt(e.target.value, 10) || 0 } })} onKeyDown={(e) => handleKeyPress(e, index)} className={`ledger-input h-7 w-16 md:w-20 text-right font-black text-sm md:text-base border-0 border-b border-transparent rounded-none bg-transparent transition-all px-1 focus-visible:ring-0 shadow-none hover:border-blue-300 ${entries[customer.id]?.kg > 0 ? 'border-primary text-primary bg-primary/5 dark:bg-primary/10' : 'text-slate-400 dark:text-slate-500'} ${entries[customer.id]?.present === false ? 'opacity-50' : ''}`} />
                                                </div>
                                                {(entries[customer.id]?.kg > 0 || entries[customer.id]?.present === false || entries[customer.id]?.note) && (
                                                    <Button variant="ghost" size="sm" onPointerDown={(e) => e.preventDefault()} onClick={() => { const n = { ...entries }; delete n[customer.id]; setEntries(n); }} className="h-8 w-8 md:h-6 md:w-6 p-0 text-red-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">
                                                        <Trash2 className="w-4 h-4 md:w-3 md:h-3" />
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Totals Section — hidden on mobile (shown only in sticky bar below) */}
                        <div className="hidden md:block mt-2 pt-2 border-t-[2px] border-double border-primary/20 bg-primary/5 dark:bg-primary/10 rounded-sm p-2 shadow-inner">
                            <div className="flex flex-row items-center justify-between gap-2">
                                <div className="flex items-center gap-2 bg-background dark:bg-slate-900 px-2 py-1.5 rounded-sm border border-primary/10 shadow-sm">
                                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center border border-primary/10"><Package className="h-4 w-4 text-primary" /></div>
                                    <div>
                                        <p className="text-[8px] font-black uppercase tracking-tighter text-muted-foreground leading-none mb-0.5">Summary</p>
                                        <div className="flex items-baseline gap-2">
                                            <span className="text-xl font-black text-primary tracking-tighter tabular-nums">{Math.round(totalKg)}</span>
                                            <span className="text-[9px] font-black text-primary uppercase opacity-60">Total KG</span>
                                            {totalVip > 0 && (
                                                <>
                                                    <span className="text-xl font-black text-amber-600 tracking-tighter tabular-nums ml-2">{totalVip}</span>
                                                    <span className="text-[9px] font-black text-amber-600 uppercase opacity-60">VIP</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    {editingDate && (
                                        <Button 
                                            variant="outline" 
                                            size="sm" 
                                            onPointerDown={(e) => e.preventDefault()}
                                            onClick={handleCancelEdit} 
                                            className="h-10 px-4 border border-border text-muted-foreground font-bold uppercase tracking-tight text-[10px] hover:bg-muted/50"
                                        >
                                            Cancel
                                        </Button>
                                    )}
                                    <Button 
                                        onClick={handleSave} 
                                        onPointerDown={(e) => {
                                            // PREVENT DEFAULT stops the mobile keyboard from closing instantly. 
                                            // If it closes instantly, the screen resizes, the button moves, 
                                            // and the browser cancels the click!
                                            e.preventDefault();
                                        }}
                                        disabled={saving || totalKg === 0} 
                                        size="sm" 
                                        className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold uppercase tracking-tight text-[10px] h-10 px-8 shadow-md shadow-primary/20 active:translate-y-0.5 transition-all"
                                    >
                                        {saving ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : <Save className="mr-2 h-3 w-3" />}
                                        {editingDate ? 'Update' : 'Save Entry'}
                                    </Button>
                                </div>
                            </div>
                        </div>

                        {/* Mobile save bar — sits at the bottom of the list */}
                        {(viewMode === 'edit' || saving) && (
                            <div className="mt-6 md:hidden animate-in fade-in duration-200">
                                <div className="flex items-center gap-2">
                                    {/* X cancel button — always in-row so it can never be clipped or hidden */}
                                    {editingDate && !saving && (
                                        <Button 
                                            variant="outline" 
                                            size="icon"
                                            onClick={handleCancelEdit} 
                                            className="shrink-0 w-12 h-12 rounded-xl border-border text-muted-foreground hover:bg-muted hover:text-foreground shadow-sm active:scale-95 transition-all"
                                        >
                                            <X className="w-5 h-5" />
                                        </Button>
                                    )}
                                    <Button 
                                        onClick={handleSave} 
                                        disabled={saving} 
                                        className="flex-1 h-12 rounded-xl bg-primary text-primary-foreground font-black uppercase tracking-widest text-sm shadow-lg hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-70"
                                    >
                                        {saving ? (
                                            <div className="flex items-center justify-center gap-2 w-full">
                                                <Loader2 className="w-5 h-5 animate-spin" />
                                                <span>{editingDate ? 'Updating...' : 'Saving...'}</span>
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-between w-full px-2">
                                                <div className="text-left">
                                                    <p className="text-[10px] opacity-70 leading-none mb-1">Total KG</p>
                                                    <p className="text-xl leading-none">{Math.round(totalKg)} KG</p>
                                                </div>
                                                <div className="flex items-center gap-2 bg-black/10 px-4 py-2 rounded-lg">
                                                    <Save className="w-4 h-4" />
                                                    <span>{editingDate ? 'UPDATE' : 'SAVE'}</span>
                                                </div>
                                            </div>
                                        )}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
                )}
                </>
            ) : (
                <>
                {/* ── HISTORY FOCUS OVERLAY ── */}
                {focusedEntry && (() => {
                    const entry = focusedEntry;
                    const ledgerSet = historyLedgerStatus[entry.date];
                    const withKg = entry.items.filter(i => i.kg > 0);
                    const processedCount = ledgerSet ? withKg.filter(i => ledgerSet.has(i.customer_id)).length : 0;
                    const totalWithKg = withKg.length;
                    const allProcessed = ledgerSet && processedCount === totalWithKg && totalWithKg > 0;
                    return (
                        <div className="fixed inset-0 z-[9999] bg-background flex flex-col animate-in fade-in duration-150">
                            {/* Top bar */}
                            <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-card/90 backdrop-blur-sm">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                                        <BookOpen className="w-4 h-4" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground leading-none mb-0.5">Buuga Maalinlaha</p>
                                        <p className="font-black text-base text-foreground tracking-tight leading-none">{format(new Date(entry.date), 'MMMM dd, yyyy')}</p>
                                    </div>
                                    {ledgerSet && (
                                        allProcessed ? (
                                            <span className="hidden sm:flex items-center gap-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wide border border-emerald-500/20">✓ All in Maqalka</span>
                                        ) : (
                                            <span className="hidden sm:flex items-center gap-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wide border border-amber-500/20 animate-pulse">⚠ {processedCount}/{totalWithKg} Maqalka</span>
                                        )
                                    )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    {isSuperAdmin && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-8 px-3 text-[10px] font-bold uppercase border-border text-foreground"
                                            onClick={(e) => { e.stopPropagation(); handleEditEntry(entry); setFocusedEntry(null); }}
                                        >
                                            <Edit className="w-3 h-3 mr-1" /> Edit
                                        </Button>
                                    )}
                                    {/* Back button — large and prominent on mobile */}
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setFocusedEntry(null)}
                                        className="h-10 px-3 font-black text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-xl flex items-center gap-1.5 active:scale-95 transition-all"
                                    >
                                        <X className="h-5 w-5" />
                                        <span className="text-sm md:hidden">Back</span>
                                    </Button>
                                </div>
                            </div>

                            {/* Stats row */}
                            <div className="shrink-0 flex items-center gap-4 px-4 py-2.5 border-b border-border bg-muted/20">
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <BookOpen className="w-3.5 h-3.5" />
                                    <span className="font-bold">{entry.items.length}</span> customers
                                </div>
                                <div className="h-3 w-px bg-border" />
                                <div className="flex items-center gap-1.5">
                                    <span className="font-black text-primary text-sm">{Math.round(entry.totalKg)}</span>
                                    <span className="text-[10px] font-bold text-muted-foreground uppercase">Total KG</span>
                                </div>
                                {(() => {
                                    // Sum all VIP quantities based on note
                                    const entryVipCount = entry.items.reduce((sum, i) => sum + getVipCount(i.note, i.kg), 0);
                                    if (entryVipCount > 0) {
                                        return (
                                            <>
                                                <div className="h-3 w-px bg-border" />
                                                <div className="flex items-center gap-1.5">
                                                    <span className="font-black text-amber-600 text-sm">{entryVipCount}</span>
                                                    <span className="text-[10px] font-bold text-muted-foreground uppercase">VIP</span>
                                                </div>
                                            </>
                                        );
                                    }
                                    return null;
                                })()}
                            </div>

                            {/* Scrollable content — book style */}
                            <div className="flex-1 overflow-y-auto bg-[#fcf8f1] dark:bg-slate-900 relative">
                                {/* Vertical margin line */}
                                <div className="absolute left-[50px] md:left-[70px] top-0 bottom-0 w-[1px] bg-red-400 dark:bg-red-900/50 pointer-events-none z-10" />
                                {/* Sticky header */}
                                <div className="sticky top-0 z-20 grid grid-cols-12 px-3 md:px-5 py-2 bg-[#f4ece0] dark:bg-slate-950 border-b-2 border-slate-300 dark:border-slate-700 shadow-sm">
                                    <div className="col-span-2 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-tighter">ID</div>
                                    <div className="col-span-6 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-tighter pl-4">Customer Name</div>
                                    <div className="col-span-4 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-tighter text-right">KG / Status</div>
                                </div>
                                <div className="divide-y divide-blue-200/30 dark:divide-slate-800/50">
                                    {entry.items.map((item) => {
                                        const isProcessed = ledgerSet ? ledgerSet.has(item.customer_id) : null;
                                        return (
                                            <div key={item.customer_id} className="grid grid-cols-12 items-center px-3 md:px-5 py-2 hover:bg-blue-100/20 dark:hover:bg-slate-800/30">
                                                <div className="col-span-2">
                                                    <span className="text-[10px] md:text-[11px] font-mono font-bold text-slate-400 dark:text-slate-500">#{item.customer?.customer_code || '—'}</span>
                                                </div>
                                                <div className="col-span-6 pl-4 border-l border-red-200/50 dark:border-red-900/30 flex items-center gap-1.5">
                                                    <span className="font-bold text-[11px] md:text-sm text-slate-700 dark:text-slate-300 uppercase truncate">{item.customer?.name || 'Unknown'}</span>
                                                    {item.kg > 0 && isProcessed !== null && (
                                                        isProcessed ? (
                                                            <span title="In Buuga Maqalka" className="shrink-0 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[8px] font-black">✓</span>
                                                        ) : (
                                                            <span title="Not in Buuga Maqalka yet" className="shrink-0 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 text-[8px] font-black animate-pulse">!</span>
                                                        )
                                                    )}
                                                </div>
                                                <div className="col-span-4 text-right">
                                                    {item.present === false ? (
                                                        <span className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 text-[10px] font-bold uppercase">Absent</span>
                                                    ) : (
                                                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                                            {(() => {
                                                                if (!item.note) return null;
                                                                const badges = getFormattedNoteBadges(item.note);
                                                                return badges.map((badge, bIdx) => (
                                                                    <div key={`n-${item.customer_id}-${bIdx}`} className={`flex items-center justify-between border-b last:border-0 py-0.5 ${badge.isVip ? 'border-amber-200/30' : 'border-slate-200/30 dark:border-slate-700/50'}`}>
                                                                        <span className={`text-[10px] font-bold truncate max-w-[120px] ${badge.isVip ? 'text-amber-600/90' : 'text-slate-600 dark:text-slate-400'}`} title={badge.text}>
                                                                            {badge.isVip ? '👑 ' : '🏷️ '}{badge.text}
                                                                        </span>
                                                                    </div>
                                                                ));
                                                            })()}
                                                            <span className="font-black text-primary text-sm md:text-base">{Math.round(item.kg)} <span className="text-[9px] opacity-60">KG</span></span>
                                                        </div>
                                                    )}
                                                    {item.note && !item.note.toLowerCase().trim().match(/^\d*\s*vip$/i) && <div className="text-[9px] text-muted-foreground truncate max-w-[90px] ml-auto mt-0.5">{item.note}</div>}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                {/* Footer total */}
                                <div className="sticky bottom-0 bg-[#f4ece0]/95 dark:bg-slate-950/95 border-t-2 border-double border-primary/20 backdrop-blur-sm flex items-center justify-between px-4 md:px-6 py-3">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Total Quantity</span>
                                    <div className="flex items-center gap-4">
                                        {(() => {
                                            // Sum the actual count of any customer whose note contains 'vip'
                                            const entryVipCount = entry.items.reduce((sum, i) => {
                                                if (i.note && i.note.toLowerCase().includes('vip')) {
                                                    return sum + getVipCount(i.note, i.kg);
                                                }
                                                return sum;
                                            }, 0);
                                            return entryVipCount > 0 ? (
                                                <span className="font-black text-amber-600 text-xl">{entryVipCount} <span className="text-xs opacity-60">VIP</span></span>
                                            ) : null;
                                        })()}
                                        <span className="font-black text-primary text-xl">{Math.round(entry.totalKg)} <span className="text-xs opacity-60">KG</span></span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })()}

                <SecurityVerificationDialog
                    isOpen={!!deleteConfirmDate}
                    onOpenChange={(open) => {
                        if (!open) setDeleteConfirmDate(null);
                    }}
                    onConfirm={handleDeleteEntry}
                    title="Move to Trash"
                    description={`Move the entry for ${deleteConfirmDate ? format(new Date(deleteConfirmDate), 'MMMM dd, yyyy') : ''} to the Recycle Bin?`}
                    isProcessing={isDeleting}
                />

                <Card className="glass-card">
                    <CardHeader className="border-b border-border">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-foreground flex items-center gap-2">
                                <FileText className="w-5 h-5 text-primary" />
                                Saved Entries
                            </CardTitle>
                            <div className="flex items-center gap-2">
                                {/* Tiny Compare (Isbarbardhig) Button */}
                                <button
                                    onClick={() => setCompareModalOpen(true)}
                                    className="w-6 h-6 flex items-center justify-center rounded-lg text-muted-foreground opacity-30 hover:opacity-100 hover:bg-primary/10 hover:text-primary transition-all duration-300"
                                    title="Isbarbardhig (Compare Dates)"
                                >
                                    <Scale className="w-3.5 h-3.5" />
                                </button>
                                {savedEntries.length > 0 && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handleExportBackup}
                                        className="h-8 px-3 text-[11px] font-bold border-border text-muted-foreground hover:text-primary hover:border-primary/40 gap-1.5"
                                        title="Download full backup as PDF"
                                    >
                                        <Download className="w-3.5 h-3.5" />
                                        Backup
                                    </Button>
                                )}
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant="outline" className="border-border text-primary hover:bg-accent hover:text-accent-foreground">
                                            <Search className="mr-2 h-4 w-4" />
                                            {searchDate ? format(searchDate, 'MMM dd') : 'Filter Date'}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0 z-[100] bg-popover border-border shadow-lg">
                                        <Calendar
                                            mode="single"
                                            selected={searchDate}
                                            onSelect={(newDate) => { setSearchDate(newDate); setVisibleEntriesCount(10); }}
                                        />
                                        <div className="p-2 border-t border-border">
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => { setSearchDate(undefined); setVisibleEntriesCount(10); }}
                                                className="w-full text-muted-foreground hover:text-primary"
                                            >
                                                Clear Filter
                                            </Button>
                                        </div>
                                    </PopoverContent>
                                </Popover>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        {sortedEntries.length === 0 ? (
                            <div className="text-center py-16 bg-muted/20">
                                <FileText className="w-16 h-16 mx-auto mb-4 text-muted-foreground/50" />
                                <h3 className="text-lg font-medium text-foreground">No entries found</h3>
                                        <p className="text-muted-foreground text-sm mt-1">
                                    {searchDate ? 'Try selecting a different date' : 'Your saved entries will appear here'}
                                </p>
                            </div>
                        ) : (
                            <>
                                <div className="divide-y divide-border">
                                {sortedEntries.slice(0, visibleEntriesCount).map((entry) => (
                                    <div
                                        key={entry.date}
                                        className="group transition-all hover:bg-muted/30"
                                        onClick={async () => {
                                            // Fetch ledger status for this date if not already cached
                                            if (!historyLedgerStatus[entry.date]) {
                                                try {
                                                    const res = await fetch(`/api/ledger-by-date?date=${entry.date}`);
                                                    if (res.ok) {
                                                        const ids: string[] = await res.json();
                                                        setHistoryLedgerStatus(prev => ({ ...prev, [entry.date]: new Set(ids) }));
                                                    }
                                                } catch (e) {
                                                    console.error('Failed to fetch history ledger status', e);
                                                }
                                            }
                                            setFocusedEntry(entry);
                                        }}
                                    >
                                        {/* Entry Header - Clickable */}
                                            <div className="flex flex-col md:flex-row md:items-center justify-between p-4 cursor-pointer">
                                                <div className="flex items-center gap-3 md:gap-4 flex-1">
                                                    <div className={`p-2 rounded-lg transition-colors shrink-0 ${expandedEntry === entry.date ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground group-hover:bg-card'}`}>
                                                        {expandedEntry === entry.date ? (
                                                            <ChevronDown className="w-5 h-5" />
                                                        ) : (
                                                            <ChevronRight className="w-5 h-5" />
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-1">
                                                            <h4 className="font-semibold text-foreground text-base md:text-lg">
                                                                {format(new Date(entry.date), 'MMM dd, yyyy')}
                                                            </h4>
                                                            <span className="flex items-center gap-1 text-xs md:text-sm text-muted-foreground">
                                                                <BookOpen className="w-3 h-3" />
                                                                {entry.items.length} <span className="hidden md:inline">customers</span>
                                                            </span>
                                                        </div>
                                                        
                                                        {/* ALL STATS IN A SINGLE KINETIC LINE */}
                                                        <div className="relative w-full h-[32px] mt-2 overflow-hidden bg-muted/10 rounded border border-border/20">
                                                            <div className="absolute top-0 h-full flex items-center gap-3 whitespace-nowrap animate-kinetic w-max px-2">
                                                                {/* 1. KG */}
                                                                <span className="font-black text-primary bg-primary/10 px-2 py-0.5 rounded-full inline-flex items-center gap-1 text-[10px] md:text-xs">
                                                                    ⚡ {Math.round(entry.totalKg)} KG
                                                                </span>

                                                                {/* 2. VIP */}
                                                                {(() => {
                                                                    const vipItems = entry.items.filter(i => i.note && i.note.toLowerCase().includes('vip'));
                                                                    const entryVipCount = vipItems.reduce((sum, i) => sum + getVipCount(i.note, i.kg), 0);
                                                                    return (
                                                                        <button
                                                                            type="button"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                if (vipItems.length > 0) setVipPopupData({ date: entry.date, items: vipItems });
                                                                            }}
                                                                            className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-[10px] md:text-xs font-black uppercase tracking-wider transition-all ${entryVipCount > 0 ? 'bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 text-yellow-950 shadow-[0_0_12px_rgba(251,191,36,0.6)] border border-yellow-200 hover:brightness-110 active:scale-95 cursor-pointer' : 'bg-muted/50 text-muted-foreground/50 border border-border/20 cursor-default'} shrink-0`}
                                                                        >
                                                                            👑 {entryVipCount} VIP
                                                                        </button>
                                                                    );
                                                                })()}

                                                                {/* 3. Inta Maqan */}
                                                                {(() => {
                                                                    const absentItems = entry.items.filter(i => i.present === false);
                                                                    return (
                                                                        <button
                                                                            type="button"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                if (absentItems.length > 0) setAbsentPopupData({ date: entry.date, items: absentItems });
                                                                            }}
                                                                            className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-[10px] md:text-xs font-black uppercase tracking-wider transition-all ${absentItems.length > 0 ? 'bg-gradient-to-r from-amber-400 to-yellow-500 text-yellow-950 border border-yellow-300 shadow-[0_0_10px_rgba(245,158,11,0.4)] hover:brightness-110 active:scale-95 cursor-pointer' : 'bg-muted/50 text-muted-foreground/50 border border-border/20 cursor-default'} shrink-0`}
                                                                        >
                                                                            ⚠️ Inta Maqan: {absentItems.length}
                                                                        </button>
                                                                    );
                                                                })()}

                                                                {/* 4. Maqalka Status */}
                                                                {historyLedgerStatus[entry.date] ? (() => {
                                                                    const withKg = entry.items.filter(i => i.kg > 0);
                                                                    const processed = withKg.filter(i => historyLedgerStatus[entry.date].has(i.customer_id)).length;
                                                                    const total = withKg.length;
                                                                    return processed === total && total > 0 ? (
                                                                        <span className="inline-flex items-center gap-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full text-[10px] md:text-xs font-black uppercase tracking-wide border border-emerald-500/20 shrink-0">
                                                                            ✓ All in Maqalka
                                                                        </span>
                                                                    ) : (
                                                                        <span className="inline-flex items-center gap-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full text-[10px] md:text-xs font-black uppercase tracking-wide border border-amber-500/20 shrink-0">
                                                                            ⚠ {processed}/{total} Maqalka
                                                                        </span>
                                                                    );
                                                                })() : null}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            <div className="flex items-center gap-2 mt-3 md:mt-0 border-t border-border/50 pt-3 md:border-0 md:pt-0" onClick={(e) => e.stopPropagation()}>
                                                {isSuperAdmin && (
                                                    <>
                                                        <Button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleEditEntry(entry);
                                                            }}
                                                            variant="outline"
                                                            size="sm"
                                                            className="flex-1 md:flex-none text-primary border-primary/20 hover:bg-primary/10 h-10 md:h-8"
                                                        >
                                                            <Edit className="w-4 h-4 mr-2 md:mr-1" /> <span>Edit</span>
                                                        </Button>
                                                        <Button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setDeleteConfirmDate(entry.date);
                                                            }}
                                                            variant="destructive"
                                                            size="sm"
                                                            className="flex-1 md:flex-none h-10 md:h-8"
                                                        >
                                                            <Trash2 className="w-4 h-4 mr-2 md:mr-1" /> <span className="hidden md:inline">Move to Trash</span><span className="md:hidden">Trash</span>
                                                        </Button>
                                                    </>
                                                )}
                                            </div>
                                        </div>

                                        {/* Expanded Details */}
                                        {expandedEntry === entry.date && (
                                            <div className="bg-muted/10 p-4 border-t border-border animate-in slide-in-from-top-2 duration-200">
                                                <div className="bg-card rounded-lg border border-border overflow-hidden shadow-sm">
                                                    <div className="divide-y divide-border">
                                                        {entry.items.map((item) => {
                                                            const ledgerSet = historyLedgerStatus[entry.date];
                                                            const isProcessed = ledgerSet ? ledgerSet.has(item.customer_id) : null;
                                                            return (
                                                            <div key={item.customer_id} className={`flex items-center justify-between p-3 hover:bg-muted/30 ${isProcessed === true ? 'bg-emerald-500/3' : isProcessed === false && item.kg > 0 ? 'bg-amber-500/3' : ''}`}>
                                                                <div className="flex items-center gap-3 overflow-hidden">
                                                                    <Avatar className="h-8 w-8 md:h-10 md:w-10 border border-border/50 shrink-0">
                                                                        <AvatarImage src={item.customer?.avatar_url || ''} alt={item.customer?.name || 'Customer'} />
                                                                        <AvatarFallback className={`${
                                                                            isProcessed === true ? 'bg-emerald-500/10 text-emerald-600' :
                                                                            isProcessed === false && item.kg > 0 ? 'bg-amber-500/10 text-amber-600' :
                                                                            item.customer?.gender === 'Male' ? 'bg-blue-500/10 text-blue-500' :
                                                                            item.customer?.gender === 'Female' ? 'bg-pink-500/10 text-pink-500' :
                                                                            'bg-slate-500/10 text-slate-500'
                                                                        }`}>
                                                                            <User className="h-4 w-4" />
                                                                        </AvatarFallback>
                                                                    </Avatar>
                                                                    <div className="flex flex-col overflow-hidden">
                                                                        <div className="flex items-center gap-1.5">
                                                                            <span className="font-semibold text-sm text-foreground truncate">{item.customer?.name || 'Unknown'}</span>
                                                                            {/* Per-customer ledger status in history */}
                                                                            {item.kg > 0 && isProcessed !== null && (
                                                                                isProcessed ? (
                                                                                    <span title="In Buuga Maqalka" className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[9px] font-black">✓</span>
                                                                                ) : (
                                                                                    <span title="Not in Buuga Maqalka yet" className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[9px] font-black animate-pulse">!</span>
                                                                                )
                                                                            )}
                                                                        </div>
                                                                        <span className="text-xs text-muted-foreground font-mono">#{item.customer?.customer_code || 'N/A'}</span>
                                                                    </div>
                                                                </div>
                                                                <div className="text-right shrink-0 ml-2">
                                                                    {item.present === false ? (
                                                                        <span className="px-2 py-1 rounded-full bg-red-500/10 text-red-600 text-[10px] font-bold uppercase tracking-wider">Absent</span>
                                                                    ) : (
                                                                        <span className="font-black text-primary text-base md:text-lg">{Math.round(item.kg)} <span className="text-[10px] opacity-60">KG</span></span>
                                                                    )}
                                                                    {(() => {
                                                                        if (!item.note) return null;
                                                                        const badges = getFormattedNoteBadges(item.note);
                                                                        return badges.map((badge, bIdx) => (
                                                                            <div key={`n-${item.customer_id}-${bIdx}`} className="flex items-center gap-1 opacity-90 group-hover:opacity-100 transition-opacity mt-0.5">
                                                                                <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded shadow-sm border truncate max-w-[120px] ${badge.isVip ? 'text-amber-600 bg-amber-500/10 border-amber-500/20' : 'text-slate-600 bg-slate-500/10 border-slate-500/20 dark:text-slate-300'}`} title={badge.text}>
                                                                                    {badge.isVip ? '👑 ' : '🏷️ '}{badge.text}
                                                                                </span>
                                                                            </div>
                                                                        ));
                                                                    })()}
                                                                </div>
                                                            </div>
                                                            );
                                                        })}
                                                        
                                                        {/* Summary Footer */}
                                                        <div className="bg-primary/5 p-4 flex items-center justify-between border-t-2 border-primary/10">
                                                            <span className="font-bold text-sm text-foreground uppercase tracking-wider">Total Quantity</span>
                                                            <span className="font-black text-primary text-xl">{Math.round(entry.totalKg)} <span className="text-xs opacity-60">KG</span></span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                            {sortedEntries.length > visibleEntriesCount ? (
                                <div className="p-4 border-t border-border flex justify-center bg-muted/5">
                                    <Button
                                        onClick={() => setVisibleEntriesCount(prev => prev + 10)}
                                        variant="outline"
                                        className="w-full max-w-xs h-10 font-black text-xs uppercase tracking-wider border-primary/20 text-primary hover:bg-primary/5 hover:border-primary/30"
                                    >
                                        View More Local (10x)
                                    </Button>
                                </div>
                            ) : !isReachingEnd ? (
                                <div className="p-4 border-t border-border flex justify-center bg-muted/5">
                                    <Button
                                        onClick={() => {
                                            setSize(size + 1);
                                            setVisibleEntriesCount(prev => prev + 10);
                                        }}
                                        disabled={isLoadingMore}
                                        variant="outline"
                                        className="w-full max-w-xs h-10 font-black text-xs uppercase tracking-wider border-primary/20 text-primary hover:bg-primary/5 hover:border-primary/30"
                                    >
                                        {isLoadingMore ? 'Loading Server...' : 'Load More History'}
                                    </Button>
                                </div>
                            ) : null}
                            </>
                        )}
                    </CardContent>
                </Card>
                </>
            )}

            {/* ══════════════════════════════════════════════════════════ */}
            {/*  SHARED MINI-POPUP — used for both Inta Maqan and VIP     */}
            {/* ══════════════════════════════════════════════════════════ */}

            {/* INTA MAQAN popup */}
            {absentPopupData && (
                <div
                    className="daily-popup-backdrop"
                    onClick={() => setAbsentPopupData(null)}
                >
                    <div className="daily-popup-card" onClick={(e) => e.stopPropagation()}>
                        {/* accent strip top */}
                        <div className="daily-popup-strip daily-popup-strip--red" />
                        {/* header */}
                        <div className="daily-popup-header">
                            <div>
                                <p className="daily-popup-title">⚠️ Inta Maqan</p>
                                <p className="daily-popup-sub">
                                    {format(new Date(absentPopupData.date), 'MMM dd, yyyy')}
                                    <span className="daily-popup-count">{absentPopupData.items.length}</span>
                                </p>
                            </div>
                            <button className="daily-popup-close" onClick={() => setAbsentPopupData(null)}>
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                        {/* list */}
                        <div className="daily-popup-list">
                            {absentPopupData.items.map((item, idx) => (
                                <div key={idx} className="daily-popup-item" style={{ animationDelay: `${idx * 35}ms` }}>
                                    <div className="daily-popup-avatar daily-popup-avatar--red">
                                        {item.customer?.name?.charAt(0)?.toUpperCase() || '?'}
                                    </div>
                                    <div className="daily-popup-info">
                                        <p className="daily-popup-name">{item.customer?.name || 'Unknown'}</p>
                                        <p className="daily-popup-code">#{item.customer?.customer_code || '—'}</p>
                                    </div>
                                    <span className="daily-popup-badge daily-popup-badge--red">Maqan</span>
                                </div>
                            ))}
                        </div>
                        {/* shimmer footer */}
                        <div className="daily-popup-shimmer" />
                    </div>
                </div>
            )}

            {/* VIP popup */}
            {vipPopupData && (
                <div
                    className="daily-popup-backdrop"
                    onClick={() => setVipPopupData(null)}
                >
                    <div className="daily-popup-card" onClick={(e) => e.stopPropagation()}>
                        {/* accent strip top */}
                        <div className="daily-popup-strip daily-popup-strip--gold" />
                        {/* header */}
                        <div className="daily-popup-header">
                            <div>
                                <p className="daily-popup-title">👑 VIP Macaamiisha</p>
                                <p className="daily-popup-sub">
                                    {format(new Date(vipPopupData.date), 'MMM dd, yyyy')}
                                    <span className="daily-popup-count">{vipPopupData.items.length}</span>
                                </p>
                            </div>
                            <button className="daily-popup-close" onClick={() => setVipPopupData(null)}>
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                        {/* list */}
                        <div className="daily-popup-list">
                            {vipPopupData.items.map((item, idx) => {
                                const isVip = item.note && item.note.toLowerCase().includes('vip');
                                return (
                                    <div key={idx} className="daily-popup-item daily-popup-item--vip" style={{ animationDelay: `${idx * 35}ms` }}>
                                        <div className="daily-popup-avatar daily-popup-avatar--gold">
                                            {item.customer?.name?.charAt(0)?.toUpperCase() || '?'}
                                        </div>
                                        <div className="daily-popup-info">
                                            <p className="daily-popup-name">{item.customer?.name || 'Unknown'}</p>
                                            <div className="daily-popup-segs">
                                                {getFormattedNoteBadges(item.note).map((badge, bIdx) => (
                                                    <span key={bIdx} className={`daily-popup-seg ${!badge.isVip ? 'opacity-70 grayscale' : ''}`}>
                                                        {badge.isVip ? '👑 ' : ''}{badge.text}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        {/* shimmer footer */}
                        <div className="daily-popup-shimmer" />
                    </div>
                </div>
            )}

            {/* Isbarbardhig (Compare) Modal */}
            {compareModalOpen && (() => {
                // Auto-select dates if none selected
                let d1 = compareDate1;
                if (!d1 && savedEntries.length > 0) d1 = savedEntries[0].date;

                // Find valid adjacent dates for Date 2
                const d1Index = savedEntries.findIndex(e => e.date === d1);
                const validD2Entries = [];
                // Only allow comparing with the older date (Behind)
                if (d1Index >= 0 && d1Index < savedEntries.length - 1) validD2Entries.push(savedEntries[d1Index + 1]);

                let d2 = compareDate2;
                if (!d2 || !validD2Entries.find(e => e.date === d2)) {
                    d2 = validD2Entries.length > 0 ? validD2Entries[0].date : null;
                }

                const entry1 = savedEntries.find(e => e.date === d1);
                const entry2 = savedEntries.find(e => e.date === d2);

                let kgDiff = 0, custDiff = 0, vipDiff = 0, absentDiff = 0;
                let abs1 = 0, abs2 = 0, act1 = 0, act2 = 0;
                let totalGains = 0, totalLosses = 0;
                let newCusts: DailyBookItem[] = [], droppedCusts: DailyBookItem[] = [], changedKg: any[] = [];
                
                if (entry1 && entry2) {
                    kgDiff = entry1.totalKg - entry2.totalKg;
                    
                    act1 = entry1.items.filter(i => i.present !== false).length;
                    act2 = entry2.items.filter(i => i.present !== false).length;
                    custDiff = act1 - act2;
                    
                    const vip1 = entry1.items.reduce((s, i) => s + getVipCount(i.note, i.kg), 0);
                    const vip2 = entry2.items.reduce((s, i) => s + getVipCount(i.note, i.kg), 0);
                    vipDiff = vip1 - vip2;

                    abs1 = entry1.items.filter(i => i.present === false).length;
                    abs2 = entry2.items.filter(i => i.present === false).length;
                    absentDiff = abs1 - abs2;

                    const map2 = new Map(entry2.items.map(i => [i.customer_id, i]));
                    entry1.items.forEach(i1 => {
                        const i2 = map2.get(i1.customer_id);
                        if (!i2) {
                            newCusts.push(i1);
                            totalGains += i1.kg;
                        }
                        else if (i1.kg !== i2.kg) {
                            const diff = i1.kg - i2.kg;
                            changedKg.push({ cust: i1.customer, old: i2.kg, new: i1.kg, diff });
                            if (diff > 0) totalGains += diff;
                            else totalLosses += Math.abs(diff);
                        }
                    });
                    const map1 = new Map(entry1.items.map(i => [i.customer_id, i]));
                    entry2.items.forEach(i2 => {
                        if (!map1.has(i2.customer_id)) {
                            droppedCusts.push(i2);
                            totalLosses += i2.kg;
                        }
                    });
                }

                return (
                    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/5 backdrop-blur-[2px] dark:bg-black/20 p-4 animate-in fade-in duration-200" onClick={() => setCompareModalOpen(false)}>
                        <div className="glass-panel rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden ring-1 ring-border/50" onClick={e => e.stopPropagation()}>
                            {/* Header */}
                            <div className="flex items-center justify-between p-4 border-b border-border/30 bg-primary/5 relative overflow-hidden">
                                <AnimatedBackground />
                                <div className="flex items-center gap-2 text-primary relative z-10">
                                    <div className="p-1.5 rounded-lg bg-primary/10">
                                        <ArrowRightLeft className="w-4 h-4" />
                                    </div>
                                    <h3 className="font-black uppercase tracking-widest text-xs md:text-sm">Isbarbardhig</h3>
                                </div>
                                <button onClick={() => setCompareModalOpen(false)} className="p-1.5 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground transition-colors relative z-10">
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                            {/* Selectors */}
                            <div className="flex items-center gap-2 md:gap-4 p-4 bg-muted/30 dark:bg-muted/10 border-b border-border/50">
                                <div className="flex-1 relative">
                                    <label className="text-[9px] md:text-[10px] font-black uppercase tracking-widest text-primary mb-1.5 block">Compare (Ahead)</label>
                                    <select 
                                        className="w-full bg-card border-2 border-primary/20 rounded-xl text-xs font-bold p-2.5 md:p-3 focus:ring-0 focus:border-primary/50 outline-none transition-colors cursor-pointer appearance-none shadow-sm"
                                        value={d1 || ''} 
                                        onChange={e => setCompareDate1(e.target.value)}
                                    >
                                        {savedEntries.map(e => <option key={e.date} value={e.date}>{format(new Date(e.date), 'MMM dd, yyyy')}</option>)}
                                    </select>
                                    <ChevronDown className="absolute right-3 bottom-3 w-4 h-4 text-primary pointer-events-none opacity-50" />
                                </div>
                                <div className="shrink-0 flex items-center justify-center pt-5">
                                    <div className="w-8 h-8 rounded-full bg-background border-2 border-border flex items-center justify-center text-muted-foreground shadow-sm">
                                        <Scale className="w-4 h-4" />
                                    </div>
                                </div>
                                <div className="flex-1 relative">
                                    <label className="text-[9px] md:text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1.5 block">Target (Behind)</label>
                                    <select 
                                        className="w-full bg-card border-2 border-border rounded-xl text-xs font-bold p-2.5 md:p-3 focus:ring-0 focus:border-primary/50 outline-none transition-colors cursor-pointer appearance-none shadow-sm"
                                        value={d2 || ''} 
                                        onChange={e => setCompareDate2(e.target.value)}
                                        disabled={validD2Entries.length === 0}
                                    >
                                        {validD2Entries.map(e => <option key={e.date} value={e.date}>{format(new Date(e.date), 'MMM dd, yyyy')}</option>)}
                                    </select>
                                    <ChevronDown className="absolute right-3 bottom-3 w-4 h-4 text-muted-foreground pointer-events-none opacity-50" />
                                </div>
                            </div>
                            
                            {/* Content */}
                            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5 bg-gradient-to-b from-transparent to-muted/10">
                                {!entry1 || !entry2 ? (
                                    <div className="text-center py-10 text-muted-foreground text-xs font-bold uppercase tracking-widest flex flex-col items-center gap-2">
                                        <Scale className="w-8 h-8 opacity-20" />
                                        Fadlan dooro labo taariikh
                                    </div>
                                ) : d1 === d2 ? (
                                    <div className="text-center py-10 text-muted-foreground text-xs font-bold uppercase tracking-widest flex flex-col items-center gap-2">
                                        <ShieldAlert className="w-8 h-8 text-amber-500 opacity-50" />
                                        Dooro taariikho kala duwan
                                    </div>
                                ) : (
                                    <>
                                        {/* Global Stats */}
                                        {/* Global Stats */}
                                        <div className="flex justify-center mb-2">
                                            <div className="glass-card bg-background/90 dark:bg-card/60 border border-border/60 rounded-2xl p-4 flex flex-col items-center justify-center text-center shadow-sm relative overflow-hidden min-w-[200px] w-full max-w-xs">
                                                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2">Total KG</p>
                                                <div className="flex items-center justify-center gap-2 text-[10px] md:text-xs text-muted-foreground bg-muted/30 px-3 py-1 rounded-full mb-1.5">
                                                    <span className="text-[8px] uppercase tracking-widest opacity-60">{format(new Date(d2!), 'dd MMM')}</span>
                                                    <span className="font-bold text-foreground">{Math.round(entry2.totalKg)}</span>
                                                    <span className="opacity-40">→</span>
                                                    <span className="font-bold text-foreground">{Math.round(entry1.totalKg)}</span>
                                                    <span className="text-[8px] uppercase tracking-widest opacity-60">{format(new Date(d1!), 'dd MMM')}</span>
                                                </div>
                                                <div className="flex items-center gap-1.5 mb-1 opacity-80">
                                                    <span className="text-[9px] font-black text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded" title="Total Gains">+{Math.round(totalGains)}</span>
                                                    <span className="text-[9px] font-black text-red-600 dark:text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded" title="Total Losses">-{Math.round(totalLosses)}</span>
                                                </div>
                                                <p className={`text-3xl font-black tabular-nums ${kgDiff > 0 ? 'text-emerald-600 dark:text-emerald-500' : kgDiff < 0 ? 'text-red-600 dark:text-red-500' : 'text-foreground'}`}>
                                                    {kgDiff > 0 ? '+' : ''}{Math.round(kgDiff)}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {/* Added */}
                                            {newCusts.length > 0 && (
                                                <div className="border border-emerald-500/30 dark:border-emerald-500/20 bg-emerald-500/10 dark:bg-emerald-500/5 rounded-2xl overflow-hidden shadow-sm flex flex-col">
                                                    <div className="bg-emerald-500/10 p-2.5 border-b border-emerald-500/10 shrink-0">
                                                        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400 text-center">🆕 Soo Kordhay ({newCusts.length})</p>
                                                    </div>
                                                    <div className="p-2 space-y-1 flex-1 overflow-y-auto max-h-[160px] custom-scrollbar">
                                                        {newCusts.map(i => (
                                                            <div key={i.customer_id} className="flex justify-between items-center text-[10px] md:text-xs font-bold p-1.5 hover:bg-emerald-500/10 rounded-lg transition-colors">
                                                                <span className="text-foreground truncate mr-2">{i.customer?.name}</span>
                                                                <span className="text-muted-foreground text-[10px] bg-background dark:bg-muted/50 px-1.5 py-0.5 rounded border border-emerald-500/20 flex items-center gap-1.5">
                                                                    <span className="text-[7.5px] opacity-60 uppercase tracking-widest">{format(new Date(d2!), 'dd MMM')}</span>
                                                                    <span className="font-black text-foreground">0</span>
                                                                    <span className="opacity-40">→</span>
                                                                    <span className="font-black text-emerald-700 dark:text-emerald-400">{Math.round(i.kg)}</span>
                                                                    <span className="text-[7.5px] opacity-80 font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">{format(new Date(d1!), 'dd MMM')}</span>
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Dropped */}
                                            {droppedCusts.length > 0 && (
                                                <div className="border border-red-500/30 dark:border-red-500/20 bg-red-500/10 dark:bg-red-500/5 rounded-2xl overflow-hidden shadow-sm flex flex-col">
                                                    <div className="bg-red-500/10 p-2.5 border-b border-red-500/10 shrink-0">
                                                        <p className="text-[10px] font-black uppercase tracking-widest text-red-700 dark:text-red-400 text-center">📉 Dhacay / Maqan ({droppedCusts.length})</p>
                                                    </div>
                                                    <div className="p-2 space-y-1 flex-1 overflow-y-auto max-h-[160px] custom-scrollbar">
                                                        {droppedCusts.map(i => (
                                                            <div key={i.customer_id} className="flex justify-between items-center text-[10px] md:text-xs font-bold p-1.5 hover:bg-red-500/10 rounded-lg transition-colors">
                                                                <span className="text-foreground truncate mr-2">{i.customer?.name}</span>
                                                                <span className="text-muted-foreground text-[10px] bg-background dark:bg-muted/50 px-1.5 py-0.5 rounded border border-red-500/20 flex items-center gap-1.5">
                                                                    <span className="text-[7.5px] opacity-80 font-bold uppercase tracking-widest text-red-700 dark:text-red-400">{format(new Date(d2!), 'dd MMM')}</span>
                                                                    <span className="font-black text-red-700 dark:text-red-400">{Math.round(i.kg)}</span>
                                                                    <span className="opacity-40">→</span>
                                                                    <span className="font-black text-foreground">0</span>
                                                                    <span className="text-[7.5px] opacity-60 uppercase tracking-widest">{format(new Date(d1!), 'dd MMM')}</span>
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            
                                            {/* Changed KG */}
                                            <div className="border border-blue-500/30 dark:border-blue-500/20 bg-blue-500/10 dark:bg-blue-500/5 rounded-2xl overflow-hidden shadow-sm md:col-span-2 flex flex-col">
                                                <div className="bg-blue-500/10 p-2.5 border-b border-blue-500/10 shrink-0">
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-400 text-center">⚖️ Isbedelka KG ({changedKg.length})</p>
                                                </div>
                                                <div className="p-2 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 max-h-[160px] overflow-y-auto custom-scrollbar">
                                                    {changedKg.map((i, idx) => (
                                                        <div key={idx} className="flex justify-between items-center text-[10px] md:text-xs font-bold p-1.5 hover:bg-blue-500/10 rounded-lg transition-colors">
                                                            <span className="text-foreground truncate mr-3">{i.cust?.name}</span>
                                                            <div className="flex items-center gap-3 shrink-0">
                                                                <span className="text-muted-foreground text-[10px] bg-background dark:bg-muted/50 px-1.5 py-0.5 rounded border border-border/50 flex items-center gap-1.5">
                                                                    <span className="text-[7.5px] opacity-60 uppercase tracking-widest">{format(new Date(d2!), 'dd MMM')}</span>
                                                                    <span className="font-black text-foreground">{Math.round(i.old)}</span>
                                                                    <span className="opacity-40">→</span>
                                                                    <span className="font-black text-foreground">{Math.round(i.new)}</span>
                                                                    <span className="text-[7.5px] opacity-60 uppercase tracking-widest">{format(new Date(d1!), 'dd MMM')}</span>
                                                                </span>
                                                                <span className={`w-[50px] shrink-0 text-center px-1.5 py-0.5 rounded ${i.diff > 0 ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/20 dark:bg-emerald-500/10' : 'text-red-700 dark:text-red-400 bg-red-500/20 dark:bg-red-500/10'}`}>
                                                                    {i.diff > 0 ? '+' : ''}{Math.round(i.diff)} KG
                                                                </span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                    {changedKg.length === 0 && <p className="text-[10px] font-bold text-center text-blue-700/50 dark:text-blue-400/50 py-4 uppercase tracking-widest col-span-1 md:col-span-2">No Changes</p>}
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Popup styles — brand blue adaptive */}
            <style>{`
                .daily-popup-backdrop {
                    position: fixed; inset: 0; z-index: 10000;
                    display: flex; align-items: center; justify-content: center;
                    background: rgba(0,0,0,0.05);
                    backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);
                }
                .dark .daily-popup-backdrop { background: rgba(0,0,0,0.2); }

                .daily-popup-card {
                    position: relative; width: 296px; max-height: 440px;
                    border-radius: 18px; overflow: hidden; display: flex; flex-direction: column;
                    background: rgba(255,255,255,0.65);
                    border: 1px solid rgba(255,255,255,0.4);
                    box-shadow: 0 16px 40px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.5);
                    backdrop-filter: blur(30px) saturate(1.6); -webkit-backdrop-filter: blur(30px) saturate(1.6);
                    animation: popIn 0.22s cubic-bezier(.34,1.56,.64,1) both;
                }
                .dark .daily-popup-card {
                    background: rgba(0,0,0,0.5);
                    border-color: rgba(255,255,255,0.2);
                    box-shadow: 0 16px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1);
                }

                .daily-popup-strip { height: 3px; width: 100%; }
                .daily-popup-strip--gold {
                    background: linear-gradient(90deg, transparent 0%, #1e40af 40%, #3b82f6 60%, transparent 100%);
                    box-shadow: 0 0 8px rgba(30,64,175,0.5);
                }
                .daily-popup-strip--red {
                    background: linear-gradient(90deg, transparent 0%, #1e40af 20%, #ef4444 50%, #1e40af 80%, transparent 100%);
                    box-shadow: 0 0 8px rgba(239,68,68,0.4);
                }

                .daily-popup-header {
                    display: flex; align-items: center; justify-content: space-between;
                    padding: 10px 14px 8px;
                    border-bottom: 1px solid rgba(30,64,175,0.12);
                    background: linear-gradient(90deg, rgba(30,64,175,0.06) 0%, transparent 100%);
                }
                .daily-popup-title {
                    font-size: 11px; font-weight: 900;
                    text-transform: uppercase; letter-spacing: 0.1em; color: #1e40af;
                }
                .dark .daily-popup-title { color: #60a5fa; }
                .daily-popup-sub {
                    font-size: 9px; font-family: monospace; color: #1e3a8a; opacity: 0.75;
                    margin-top: 2px; display: flex; align-items: center; gap: 6px;
                }
                .dark .daily-popup-sub { color: #93c5fd; }
                .daily-popup-count {
                    display: inline-flex; align-items: center; justify-content: center;
                    background: rgba(30,64,175,0.12); border: 1px solid rgba(30,64,175,0.25);
                    color: #1e40af; border-radius: 999px; padding: 0 5px; font-size: 8px; font-weight: 900; min-width: 18px;
                }
                .dark .daily-popup-count { color: #60a5fa; }
                .daily-popup-close {
                    width: 24px; height: 24px; border-radius: 8px;
                    display: flex; align-items: center; justify-content: center;
                    color: #1e40af; opacity: 0.6; border: none; background: transparent; cursor: pointer; transition: all 0.15s;
                }
                .daily-popup-close:hover { opacity: 1; background: rgba(30,64,175,0.1); }
                .daily-popup-close:active { transform: scale(0.88); }
                .dark .daily-popup-close { color: #60a5fa; }

                .daily-popup-list { overflow-y: auto; flex: 1; padding: 8px; display: flex; flex-direction: column; gap: 5px; }
                .daily-popup-item {
                    display: flex; align-items: center; gap: 10px;
                    padding: 8px 10px; border-radius: 12px;
                    border: 1px solid rgba(30,64,175,0.08);
                    background: rgba(239,246,255,0.6);
                    transition: background 0.12s; animation: fadeSlideUp 0.2s ease both;
                }
                .daily-popup-item:hover { background: rgba(219,234,254,0.8); }
                .dark .daily-popup-item { border-color: rgba(59,130,246,0.1); background: rgba(30,64,175,0.06); }
                .dark .daily-popup-item:hover { background: rgba(30,64,175,0.12); }
                .daily-popup-item--vip { align-items: flex-start; }

                .daily-popup-avatar {
                    width: 28px; height: 28px; border-radius: 50%;
                    display: flex; align-items: center; justify-content: center;
                    font-size: 10px; font-weight: 900; flex-shrink: 0;
                }
                .daily-popup-avatar--red {
                    background: rgba(239,68,68,0.12); border: 1.5px solid rgba(239,68,68,0.3); color: #dc2626;
                }
                .dark .daily-popup-avatar--red { color: #f87171; }
                .daily-popup-avatar--gold {
                    background: rgba(30,64,175,0.12); border: 1.5px solid rgba(30,64,175,0.3); color: #1e40af;
                }
                .dark .daily-popup-avatar--gold { color: #60a5fa; }

                .daily-popup-info { flex: 1; min-width: 0; }
                .daily-popup-name {
                    font-size: 11px; font-weight: 900; text-transform: uppercase;
                    color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                }
                .dark .daily-popup-name { color: rgba(255,255,255,0.9); }
                .daily-popup-code { font-size: 9px; font-family: monospace; color: #64748b; margin-top: 1px; }
                .dark .daily-popup-code { color: rgba(255,255,255,0.35); }

                .daily-popup-badge { flex-shrink: 0; font-size: 8px; font-weight: 900; text-transform: uppercase; border-radius: 999px; padding: 2px 7px; }
                .daily-popup-badge--red {
                    color: #dc2626; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.25);
                    animation: pulseBadge 2s ease-in-out infinite;
                }
                .dark .daily-popup-badge--red { color: #f87171; }

                .daily-popup-segs { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 3px; }
                .daily-popup-seg {
                    font-size: 8px; font-weight: 900; text-transform: uppercase;
                    color: #1e40af; background: rgba(30,64,175,0.1);
                    border: 1px solid rgba(30,64,175,0.2); border-radius: 4px; padding: 1px 5px;
                }
                .dark .daily-popup-seg { color: #60a5fa; }

                .daily-popup-shimmer {
                    height: 2px;
                    background: linear-gradient(90deg, transparent 0%, rgba(59,130,246,0.7) 50%, transparent 100%);
                    background-size: 200% 100%; animation: shimmerSlide 2s linear infinite;
                }

                @keyframes popIn { from { opacity: 0; transform: scale(0.87) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
                @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
                @keyframes shimmerSlide { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
                @keyframes pulseBadge { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
            `}</style>
        </div>
    );
}

export default function DailyBookPage() {
    return (
        <DailyBookErrorBoundary>
            <DailyBookPageInner />
        </DailyBookErrorBoundary>
    );
}

