'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { UserCog, Plus, Shield, User, Trash2, Search, UserPlus, CheckCircle2, Circle } from 'lucide-react';
import { SecurityVerificationDialog } from '@/components/security-verification-dialog';

interface UserData {
    id: string;
    username: string;
    name: string;
    role: 'ADMIN' | 'CUSTOMER' | 'SUPER_ADMIN';
    is_active: boolean;
    created_at: string;
    priority?: number;
    avatar_url?: string;
    assigned_customer_ids?: string[];
}

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

// ═══════════════════════════════════════════════════════════════
// Per-user kinetic Maqal badge with scrolling avatars
// ═══════════════════════════════════════════════════════════════
function UserMaqalBadge({ data }: { data: PerUserMaqal }) {
    const { customers, solved, total } = data;
    const remaining = total - solved;
    const isWarning = remaining > 0;
    const allDone = remaining === 0 && total > 0;

    if (total === 0) {
        return <span className="text-[10px] text-muted-foreground/40">—</span>;
    }

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button className={`relative flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-black transition-all hover:scale-105 cursor-pointer overflow-hidden ${
                    allDone
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                        : 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'
                }`}>
                    {/* Kinetic lightning sweep */}
                    <span className="absolute inset-0 opacity-20"
                        style={{
                            background: allDone
                                ? 'linear-gradient(90deg, transparent 0%, rgba(16,185,129,0.8) 50%, transparent 100%)'
                                : 'linear-gradient(90deg, transparent 0%, rgba(251,191,36,0.8) 50%, transparent 100%)',
                            animation: 'lightningSwipe 1.8s ease-in-out infinite',
                        }}
                    />

                    {/* Pulsing dot if warning */}
                    {isWarning && (
                        <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2 z-10">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                        </span>
                    )}

                    {/* Scrolling tiny avatars */}
                    <span className="relative z-10 flex items-center gap-0.5 overflow-hidden w-[36px]">
                        <span
                            className="flex items-center gap-0.5"
                            style={{
                                animation: customers.length > 3 ? 'tickerScroll 6s linear infinite' : 'none',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {[...customers, ...customers].slice(0, Math.max(6, customers.length * 2)).map((c, i) => (
                                <span
                                    key={i}
                                    className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[7px] font-black shrink-0 border ${
                                        c.has_payment
                                            ? 'bg-emerald-500 border-emerald-400 text-white'
                                            : 'bg-amber-500 border-amber-400 text-white'
                                    }`}
                                    title={c.name}
                                >
                                    {c.avatar_url ? (
                                        <img src={c.avatar_url} className="w-full h-full rounded-full object-cover" alt={c.name} />
                                    ) : (
                                        c.name.charAt(0).toUpperCase()
                                    )}
                                </span>
                            ))}
                        </span>
                    </span>

                    {/* Count */}
                    <span className="relative z-10 font-black tabular-nums">{solved}/{total}</span>
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0 bg-card border-border shadow-2xl rounded-xl z-50 overflow-hidden" align="start" sideOffset={6}>
                {/* Header */}
                <div className={`px-3 py-2 flex items-center justify-between ${allDone ? 'bg-emerald-500/10' : 'bg-amber-500/10'}`}>
                    <span className="text-xs font-black uppercase tracking-widest text-foreground">Priority Maqal</span>
                    {allDone ? (
                        <span className="text-[10px] font-bold text-emerald-500 bg-emerald-500/20 px-2 py-0.5 rounded-full border border-emerald-500/30">
                            All Done ✓
                        </span>
                    ) : (
                        <span className="text-[10px] font-bold text-amber-500 bg-amber-500/20 px-2 py-0.5 rounded-full border border-amber-500/30">
                            {remaining} Remaining
                        </span>
                    )}
                </div>

                {/* Customer list — unsolved first, then solved */}
                <div className="p-2 space-y-1 max-h-[220px] overflow-y-auto">
                    {/* Unsolved first */}
                    {customers.filter(c => !c.has_payment).map(c => (
                        <div key={c.id} className="flex items-center gap-2 p-1.5 rounded-lg bg-amber-500/5 border border-amber-500/20">
                            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-white text-[8px] font-black shrink-0">
                                {c.avatar_url ? (
                                    <img src={c.avatar_url} className="w-full h-full rounded-full object-cover" alt={c.name} />
                                ) : c.name.charAt(0).toUpperCase()}
                            </span>
                            <span className="text-[11px] font-semibold text-foreground truncate flex-1">{c.name}</span>
                            <span className="text-[9px] text-muted-foreground font-mono">#{c.customer_code}</span>
                            <Circle className="w-3 h-3 text-amber-400 shrink-0" />
                        </div>
                    ))}
                    {/* Solved after */}
                    {customers.filter(c => c.has_payment).map(c => (
                        <div key={c.id} className="flex items-center gap-2 p-1.5 rounded-lg bg-muted/30 border border-transparent opacity-50">
                            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500 text-white text-[8px] font-black shrink-0">
                                {c.avatar_url ? (
                                    <img src={c.avatar_url} className="w-full h-full rounded-full object-cover" alt={c.name} />
                                ) : c.name.charAt(0).toUpperCase()}
                            </span>
                            <span className="text-[11px] font-semibold text-muted-foreground line-through truncate flex-1">{c.name}</span>
                            <span className="text-[9px] text-muted-foreground font-mono">#{c.customer_code}</span>
                            <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                        </div>
                    ))}
                    {customers.length === 0 && (
                        <p className="text-center text-xs text-muted-foreground py-4">No priority customers assigned</p>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}

export default function UsersPage() {
    const [currentUser, setCurrentUser] = useState<any>(null);
    const [users, setUsers] = useState<UserData[]>([]);
    const [perUserMaqal, setPerUserMaqal] = useState<PerUserMaqal[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [newUser, setNewUser] = useState({
        username: '',
        name: '',
        password: '123',
        role: 'CUSTOMER' as 'ADMIN' | 'CUSTOMER'
    });
    const [pendingSecurityAction, setPendingSecurityAction] = useState<{ userId: string, username: string } | null>(null);
    const [kickoutTarget, setKickoutTarget] = useState<{ userId: string, name: string } | null>(null);
    const [kickPin1, setKickPin1] = useState('');
    const [kickPin2, setKickPin2] = useState('');
    const [kickoutLoading, setKickoutLoading] = useState(false);

    const loadUsers = async () => {
        try {
            const res = await fetch('/api/users');
            const data = await res.json();
            if (res.ok && Array.isArray(data)) setUsers(data);
        } catch (e) {
            console.error('Failed to load users:', e);
        } finally {
            setLoading(false);
        }
    };

    const loadPerUserMaqal = async () => {
        try {
            // Cookie auth — NO x-session-token so Vercel CDN can cache this GET
            const res = await fetch('/api/maqal-per-user', { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();
                setPerUserMaqal(data.users || []);
            }
        } catch (e) {
            console.error('Failed to load per-user maqal:', e);
        }
    };

    useEffect(() => {
        const storedUser = localStorage.getItem('currentUser');
        if (storedUser) {
            try { setCurrentUser(JSON.parse(storedUser)); } catch (e) {}
        }
        loadUsers();
        loadPerUserMaqal();
    }, []);

    const handleCreateUser = async () => {
        if (!newUser.username || !newUser.name) {
            toast.error('Please fill in all required fields');
            return;
        }
        try {
            const res = await fetch('/api/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newUser)
            });
            if (res.ok) {
                toast.success('User created successfully');
                setNewUser({ username: '', name: '', password: '123', role: 'CUSTOMER' });
                setIsDialogOpen(false);
                loadUsers();
            } else {
                const error = await res.json();
                toast.error(error.error || 'Failed to create user');
            }
        } catch (e) {
            toast.error('Network error');
        }
    };

    const handleToggleAdmin = async (userId: string, currentRole: string) => {
        const newRole = currentRole === 'ADMIN' ? 'CUSTOMER' : 'ADMIN';
        try {
            const res = await fetch(`/api/users/${userId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: newRole })
            });
            if (res.ok) {
                toast.success(`User ${newRole === 'ADMIN' ? 'promoted to Admin' : 'set as Customer'}`);
                loadUsers();
            } else {
                toast.error('Failed to update user role');
            }
        } catch (e) {
            toast.error('Network error');
        }
    };

    const handleDeleteUser = (userId: string, username: string) => setPendingSecurityAction({ userId, username });

    const executeDeleteUser = async () => {
        if (!pendingSecurityAction) return;
        const { userId } = pendingSecurityAction;
        setPendingSecurityAction(null);
        try {
            const res = await fetch(`/api/users?id=${userId}`, { method: 'DELETE' });
            if (res.ok) {
                toast.success('User deleted');
                loadUsers();
            } else {
                toast.error('Failed to delete user');
            }
        } catch (e) {
            toast.error('Network error');
        }
    };

    const filteredUsers = users.filter(user =>
        user.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.username?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleKickout = async () => {
        if (!kickoutTarget) return;
        setKickoutLoading(true);
        try {
            const res = await fetch('/api/users', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: kickoutTarget.userId, action: 'kickout', pin1: kickPin1, pin2: kickPin2 })
            });
            const data = await res.json();
            if (res.ok) {
                toast.success(`${kickoutTarget.name} has been kicked out!`);
                setKickoutTarget(null);
                setKickPin1('');
                setKickPin2('');
                loadUsers();
            } else {
                toast.error(data.error || 'Failed to kick out user');
            }
        } catch {
            toast.error('Network error');
        } finally {
            setKickoutLoading(false);
        }
    };

    const handleAllowUser = async (userId: string) => {
        try {
            const res = await fetch('/api/users', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: userId, action: 'allow' })
            });
            if (res.ok) {
                toast.success('User access restored');
                loadUsers();
            } else {
                toast.error('Failed to allow user');
            }
        } catch {
            toast.error('Network error');
        }
    };

    const handleDenyUser = async (userId: string) => {
        try {
            const res = await fetch('/api/users', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: userId, action: 'deny' })
            });
            if (res.ok) {
                toast.success('User access denied');
                loadUsers();
            } else {
                toast.error('Failed to deny user');
            }
        } catch {
            toast.error('Network error');
        }
    };

    if (currentUser && currentUser.role !== 'SUPER_ADMIN') {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-center px-6">
                <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center mb-4">
                    <Shield className="w-8 h-8 text-destructive" />
                </div>
                <h2 className="text-xl font-black text-foreground">Access Denied</h2>
                <p className="text-muted-foreground mt-2 text-sm">You do not have permission to view this page.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-3xl mx-auto w-full px-1 md:px-0">
            {/* Keyframe styles for kinetic animation */}
            <style>{`
                @keyframes lightningSwipe {
                    0% { transform: translateX(-100%); opacity: 0; }
                    30% { opacity: 1; }
                    70% { opacity: 1; }
                    100% { transform: translateX(200%); opacity: 0; }
                }
                @keyframes tickerScroll {
                    0% { transform: translateX(0); }
                    100% { transform: translateX(-50%); }
                }
            `}</style>

            <SecurityVerificationDialog
                isOpen={!!pendingSecurityAction}
                onOpenChange={(open) => { if (!open) setPendingSecurityAction(null); }}
                onConfirm={executeDeleteUser}
                title="Delete User"
                description={`Permanently delete user "${pendingSecurityAction?.username}"?`}
            />

            {/* Kickout PIN Dialog */}
            <Dialog open={!!kickoutTarget} onOpenChange={(open) => { if (!open) { setKickoutTarget(null); setKickPin1(''); setKickPin2(''); } }}>
                <DialogContent className="border-border sm:max-w-[380px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-destructive">
                            <span className="text-2xl">🦵</span>
                            Kick Out {kickoutTarget?.name}?
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 pt-2">
                        <p className="text-sm text-muted-foreground">
                            ⚠️ <strong>WARNING:</strong> This will immediately log out <strong>{kickoutTarget?.name}</strong> and block them from accessing the system until you allow them back.
                        </p>
                        <div className="space-y-2">
                            <Label className="text-foreground text-xs font-bold uppercase">PIN 1</Label>
                            <Input type="password" value={kickPin1} onChange={e => setKickPin1(e.target.value)} placeholder="Enter PIN 1" className="bg-background border-input" />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-foreground text-xs font-bold uppercase">PIN 2</Label>
                            <Input type="password" value={kickPin2} onChange={e => setKickPin2(e.target.value)} placeholder="Enter PIN 2" className="bg-background border-input" />
                        </div>
                        <div className="flex gap-2 pt-2">
                            <Button variant="outline" onClick={() => { setKickoutTarget(null); setKickPin1(''); setKickPin2(''); }} className="flex-1 border-border">Cancel</Button>
                            <Button onClick={handleKickout} disabled={kickoutLoading || !kickPin1 || !kickPin2} className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                {kickoutLoading ? 'Kicking...' : '🦵 Kick Out'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold bg-gradient-to-r from-primary to-yellow-200 bg-clip-text text-transparent">
                        Users
                    </h2>
                    <p className="text-muted-foreground text-sm mt-1">
                        {loading ? 'Loading...' : `${users.length} users registered`}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                        <DialogTrigger asChild>
                            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20">
                                <Plus className="w-4 h-4 mr-2" />
                                Add User
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="border-border">
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2 text-foreground">
                                    <UserPlus className="w-5 h-5 text-primary" />
                                    Add New User
                                </DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 pt-4">
                                <div className="space-y-2">
                                    <Label className="text-foreground">Username *</Label>
                                    <Input value={newUser.username} onChange={e => setNewUser({ ...newUser, username: e.target.value })} placeholder="Enter username" className="bg-background border-input focus:border-primary" />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-foreground">Full Name *</Label>
                                    <Input value={newUser.name} onChange={e => setNewUser({ ...newUser, name: e.target.value })} placeholder="Enter full name" className="bg-background border-input focus:border-primary" />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-foreground">Password</Label>
                                    <Input type="password" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} placeholder="Default: 123" className="bg-background border-input focus:border-primary" />
                                    <p className="text-xs text-muted-foreground">Leave blank for default password (123)</p>
                                </div>
                                <div className="flex items-center justify-between p-3 bg-primary/10 rounded-lg">
                                    <div className="flex items-center gap-2">
                                        <Shield className="w-4 h-4 text-primary" />
                                        <Label className="text-foreground">Admin Role</Label>
                                    </div>
                                    <Switch checked={newUser.role === 'ADMIN'} onCheckedChange={checked => setNewUser({ ...newUser, role: checked ? 'ADMIN' : 'CUSTOMER' })} />
                                </div>
                                <div className="flex gap-2 pt-2">
                                    <Button variant="outline" onClick={() => setIsDialogOpen(false)} className="flex-1 border-border">Cancel</Button>
                                    <Button onClick={handleCreateUser} className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90">Create User</Button>
                                </div>
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {/* Search */}
            <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Search users..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-10 bg-background border-input focus:border-primary" />
            </div>

            {/* Users Table */}
            <Card className="glass-card overflow-hidden">
                <CardHeader className="bg-muted/20 border-b border-border">
                    <CardTitle className="flex items-center gap-2 text-foreground">
                        <UserCog className="w-5 h-5 text-primary" />
                        User Management
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="text-center py-12 text-muted-foreground">Loading users...</div>
                    ) : filteredUsers.length === 0 ? (
                        <div className="text-center py-12">
                            <User className="w-16 h-16 mx-auto mb-4 text-muted-foreground/30" />
                            <p className="text-foreground font-medium">No users found</p>
                            <p className="text-muted-foreground text-sm mt-1">Create a user or add customers to get started</p>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow className="border-border hover:bg-muted/50">
                                    <TableHead className="text-muted-foreground font-semibold">Username</TableHead>
                                    <TableHead className="text-muted-foreground font-semibold">Name</TableHead>
                                    <TableHead className="text-muted-foreground font-semibold">Role</TableHead>
                                    <TableHead className="text-muted-foreground font-semibold">Maqal</TableHead>
                                    <TableHead className="text-muted-foreground font-semibold">Admin</TableHead>
                                    <TableHead className="text-muted-foreground font-semibold text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredUsers.map(user => {
                                    const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
                                    const userMaqal = perUserMaqal.find(m => m.user_id === user.id);

                                    return (
                                        <TableRow key={user.id} className={`border-border hover:bg-muted/30 group ${!user.is_active ? 'opacity-60' : ''}`}>
                                            <TableCell className="font-medium text-foreground">
                                                <div className="flex items-center gap-2">
                                                    <div className={`relative w-9 h-9 rounded-full flex items-center justify-center overflow-hidden shrink-0 ${isAdmin ? 'bg-amber-500/10 ring-2 ring-amber-500/30' : 'bg-primary/10 ring-2 ring-primary/20'}`}>
                                                        {user.avatar_url ? (
                                                            <img src={user.avatar_url} className="w-full h-full rounded-full object-cover" alt={user.name} />
                                                        ) : isAdmin ? (
                                                            <Shield className="w-4 h-4 text-amber-500" />
                                                        ) : (
                                                            <User className="w-4 h-4 text-primary" />
                                                        )}
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className="font-semibold text-sm">{user.username}</span>
                                                        {(user.assigned_customer_ids?.length || 0) > 0 && (
                                                            <span className="text-[10px] text-muted-foreground">
                                                                {user.assigned_customer_ids!.length} priority
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-muted-foreground">{user.name || '-'}</TableCell>
                                            <TableCell>
                                                <span className={`px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ${isAdmin ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' : 'bg-primary/10 text-primary border border-primary/20'}`}>
                                                    {user.role}
                                                </span>
                                            </TableCell>
                                            <TableCell>
                                                {userMaqal && userMaqal.total > 0 ? (
                                                    <UserMaqalBadge data={userMaqal} />
                                                ) : (
                                                    <span className="text-[10px] text-muted-foreground/40">—</span>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <Switch checked={isAdmin} onCheckedChange={() => handleToggleAdmin(user.id, user.role)} />
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex items-center justify-end gap-1">
                                                    {/* Kicked out badge + Allow/Deny */}
                                                    {!user.is_active && user.role !== 'SUPER_ADMIN' && (
                                                        <div className="flex items-center gap-1 mr-1">
                                                            <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-destructive/10 text-destructive border border-destructive/20 animate-pulse">Kicked</span>
                                                            <Button variant="ghost" size="sm" onClick={() => handleAllowUser(user.id)} className="h-6 px-1.5 text-[10px] font-bold text-emerald-500 hover:bg-emerald-500/10" title="Allow access">
                                                                ✅
                                                            </Button>
                                                            <Button variant="ghost" size="sm" onClick={() => handleDenyUser(user.id)} className="h-6 px-1.5 text-[10px] font-bold text-destructive hover:bg-destructive/10" title="Deny access">
                                                                ❌
                                                            </Button>
                                                        </div>
                                                    )}
                                                    {/* Kickout leg button — tiny, partially visible by default for mobile */}
                                                    {user.is_active && user.role !== 'SUPER_ADMIN' && (user.role === 'ADMIN' || user.role === 'CUSTOMER') && (
                                                        <button
                                                            onClick={() => setKickoutTarget({ userId: user.id, name: user.name || user.username })}
                                                            className="opacity-40 group-hover:opacity-100 transition-opacity duration-200 w-6 h-6 flex items-center justify-center rounded hover:bg-destructive/10 text-[13px]" 
                                                            title={`Kick out ${user.name || user.username}`}
                                                        >
                                                            🦵
                                                        </button>
                                                    )}
                                                    <Button variant="ghost" size="sm" onClick={() => handleDeleteUser(user.id, user.username)} className="text-destructive hover:text-destructive hover:bg-destructive/10">
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
