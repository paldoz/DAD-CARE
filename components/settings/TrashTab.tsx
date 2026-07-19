'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Trash2, RefreshCw, AlertTriangle, Database, FileText, User, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Input } from '@/components/ui/input';
import { SecurityVerificationDialog } from '@/components/security-verification-dialog';

export function TrashTab({ currentUser }: { currentUser: any }) {
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [isConfirmingEmpty, setIsConfirmingEmpty] = useState(false);
    const [trashItems, setTrashItems] = useState<{ dailyBooks: any[], ledgerEntries: any[] }>({
        dailyBooks: [],
        ledgerEntries: []
    });
    const [restoreByName, setRestoreByName] = useState('');
    const [restoringByName, setRestoringByName] = useState(false);

    const loadTrash = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/trash');
            const data = await res.json();
            if (res.ok) {
                setTrashItems({
                    dailyBooks: data.dailyBooks || [],
                    ledgerEntries: data.ledgerEntries || []
                });
            } else {
                toast.error(data.error || 'Failed to load trash');
            }
        } catch (error) {
            console.error(error);
            toast.error('Network error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadTrash();
    }, []);

    const handleRestore = async (id: string, type: string) => {
        setActionLoading(id);
        try {
            const res = await fetch('/api/trash', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, type })
            });
            const data = await res.json();
            
            if (res.ok) {
                toast.success('Entry restored successfully');
                loadTrash();
            } else {
                toast.error(data.error || 'Failed to restore');
            }
        } catch (error) {
            toast.error('Network error');
        } finally {
            setActionLoading(null);
        }
    };

    const handleEmptyTrash = async () => {
        setActionLoading('empty');
        try {
            const res = await fetch('/api/trash?all=true', { method: 'DELETE' });
            if (res.ok) {
                toast.success('Trash emptied permanently');
                loadTrash();
            } else {
                toast.error('Failed to empty trash');
            }
        } catch (error) {
            toast.error('Network error');
        } finally {
            setActionLoading(null);
        }
    };

    const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
    const hasItems = trashItems.dailyBooks.length > 0 || trashItems.ledgerEntries.length > 0;

    const handleRestoreByName = async () => {
        const name = restoreByName.trim();
        if (!name) return;
        setRestoringByName(true);
        try {
            const res = await fetch('/api/restore-customer-by-name', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                toast.success(data.message);
                setRestoreByName('');
                // Notify app to refresh customer lists
                localStorage.setItem('dadwork_customers_stale', Date.now().toString());
                window.dispatchEvent(new Event('dadwork_customers_stale'));
            } else {
                toast.error(data.error || 'Restore failed');
            }
        } catch {
            toast.error('Network error during restore');
        } finally {
            setRestoringByName(false);
        }
    };

    return (
        <Card className="border-border/50 shadow-sm overflow-hidden bg-card/50 backdrop-blur-sm">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-destructive/40 via-destructive/20 to-transparent" />
            <CardHeader className="flex flex-row items-start justify-between pb-4">
                <div>
                    <CardTitle className="flex items-center gap-2 text-destructive">
                        <Trash2 className="w-5 h-5" />
                        Recycle Bin
                    </CardTitle>
                    <CardDescription className="mt-1.5 text-[13px]">
                        Deleted items are kept here for 30 days before being permanently removed.
                    </CardDescription>
                </div>
                {isSuperAdmin && hasItems && (
                    <>
                        <Button variant="destructive" size="sm" onClick={() => setIsConfirmingEmpty(true)} disabled={actionLoading === 'empty'}>
                            {actionLoading === 'empty' ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                            Empty Trash
                        </Button>
                        <SecurityVerificationDialog
                            isOpen={isConfirmingEmpty}
                            onOpenChange={setIsConfirmingEmpty}
                            onConfirm={handleEmptyTrash}
                            title="Empty Recycle Bin?"
                            description="This will permanently delete all items in the trash. This action cannot be undone."
                            isProcessing={actionLoading === 'empty'}
                        />
                    </>
                )}
            </CardHeader>
            <CardContent className="space-y-6">
                {/* ── Restore Inactive Customer ── */}
                {isSuperAdmin && (
                    <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4 space-y-3">
                        <div className="flex items-center gap-2">
                            <RotateCcw className="w-4 h-4 text-green-600" />
                            <p className="text-sm font-bold text-green-700 dark:text-green-400">Restore Inactive Customer</p>
                        </div>
                        <p className="text-[11px] text-muted-foreground">Type the customer's name to restore them to active. All their history and receipts will be accessible again.</p>
                        <div className="flex gap-2">
                            <Input
                                placeholder="e.g. Safiyo Raage"
                                value={restoreByName}
                                onChange={e => setRestoreByName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleRestoreByName(); }}
                                className="bg-background/50 border-border/50 h-9 text-sm rounded-xl flex-1"
                            />
                            <Button
                                onClick={handleRestoreByName}
                                disabled={restoringByName || !restoreByName.trim()}
                                className="h-9 px-4 bg-green-600 hover:bg-green-700 text-white rounded-xl text-xs font-bold active:scale-95 transition-all shadow-sm"
                            >
                                {restoringByName ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Restore'}
                            </Button>
                        </div>
                    </div>
                )}
                {loading ? (
                    <div className="flex justify-center p-8">
                        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                ) : !hasItems ? (
                    <div className="flex flex-col items-center justify-center p-8 text-muted-foreground border border-dashed rounded-xl border-border/50 bg-background/30">
                        <Trash2 className="w-12 h-12 mb-3 opacity-20" />
                        <p>The recycle bin is empty</p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {/* Daily Book Trash */}
                        {trashItems.dailyBooks.length > 0 && (
                            <div className="space-y-3">
                                <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground/80">
                                    <FileText className="w-4 h-4 text-blue-500" />
                                    Daily Book Entries
                                </h3>
                                <div className="space-y-2">
                                    {trashItems.dailyBooks.map((book) => (
                                        <div key={book.id} className="flex items-center justify-between p-3 border rounded-xl bg-background/50 border-border/50">
                                            <div>
                                                <p className="font-medium text-sm">Date: {format(new Date(book.date), 'MMMM d, yyyy')}</p>
                                                <p className="text-xs text-muted-foreground mt-1">
                                                    Deleted {format(new Date(book.deleted_at), 'MMM d')} by {book.deleted_by || 'Unknown'}
                                                </p>
                                            </div>
                                            <Button 
                                                variant="outline" 
                                                size="sm"
                                                onClick={() => handleRestore(book.id, 'daily-book')}
                                                disabled={!!actionLoading}
                                                className="h-8 border-green-500/20 text-green-600 hover:bg-green-500/10 dark:text-green-400"
                                            >
                                                {actionLoading === book.id ? <RefreshCw className="w-3 h-3 animate-spin mr-1.5" /> : <RefreshCw className="w-3 h-3 mr-1.5" />}
                                                Restore
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Ledger Trash */}
                        {trashItems.ledgerEntries.length > 0 && (
                            <div className="space-y-3">
                                <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground/80">
                                    <Database className="w-4 h-4 text-amber-500" />
                                    Ledger Entries
                                </h3>
                                <div className="space-y-2">
                                    {trashItems.ledgerEntries.map((entry) => (
                                        <div key={entry.id} className="flex items-center justify-between p-3 border rounded-xl bg-background/50 border-border/50">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full ${entry.ledger_type === 'PAYMENT' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-blue-500/10 text-blue-600'}`}>
                                                        {entry.ledger_type}
                                                    </span>
                                                    <p className="font-medium text-sm">{entry.customer_name || 'Unknown'}</p>
                                                </div>
                                                <p className="text-xs text-muted-foreground mt-1">
                                                    Date: {entry.date} • {entry.ledger_type === 'PRODUCT' ? `${entry.kg} KG` : `$${entry.amount}`}
                                                </p>
                                                <p className="text-[11px] text-muted-foreground/70 mt-1">
                                                    Deleted {format(new Date(entry.deleted_at), 'MMM d')} by {entry.deleted_by || 'Unknown'}
                                                </p>
                                            </div>
                                            <Button 
                                                variant="outline" 
                                                size="sm"
                                                onClick={() => handleRestore(entry.id, 'ledger')}
                                                disabled={!!actionLoading}
                                                className="h-8 border-green-500/20 text-green-600 hover:bg-green-500/10 dark:text-green-400"
                                            >
                                                {actionLoading === entry.id ? <RefreshCw className="w-3 h-3 animate-spin mr-1.5" /> : <RefreshCw className="w-3 h-3 mr-1.5" />}
                                                Restore
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
