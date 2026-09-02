'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import useSWR, { mutate } from 'swr';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
    Settings,
    DollarSign,
    Save,
    Download,
    Sun,
    Moon,
    Loader2,
    Users,
    User,
    UserPlus,
    UserCheck,
    Trash2,
    Search,
    Phone,
    Plus,
    Image as ImageIcon,
    Check,
    Star,
    Shield,
    Palette,
    HardDrive,
    Pencil,
    Activity,
    Wifi,
    WifiOff,
    Clock,
    LogIn,
    LogOut,
    AlertTriangle,
    Filter,
    RefreshCw,
    Eye,
    ChevronDown,
    Zap,
    Crown,
    CalendarIcon,
    Sparkles,
    X,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { createClient } from '@/lib/supabase/client';
import { SecurityVerificationDialog } from '@/components/security-verification-dialog';
import { AppearanceTab } from '@/components/settings/AppearanceTab';
import { TrashTab } from '@/components/settings/TrashTab';
import { AnimatedBackground } from '@/components/animated-background';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { CheckCircle2, Circle } from 'lucide-react';
import { VipCaadiCategory } from '@/types';

function getVipCount(note: string | undefined | null, fallbackKg: number = 0): number {
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

interface PerUserMaqal {
    user_id: string;
    username: string;
    total: number;
    solved: number;
    customers: { id: string; name: string; customer_code: string; avatar_url?: string; has_payment: boolean; }[];
}

interface UserData {
    id: string;
    username: string;
    name: string;
    password?: string;
    role: string;
    is_active: boolean;
    gender?: string;
    phone?: string;
    avatar_url?: string;
    assigned_customer_ids?: string[];
    created_at: string;
}

export default function SettingsPage() {
    const { theme, setTheme } = useTheme();

    // Price per KG
    const [pricePerKg, setPricePerKg] = useState('35');
    const [dateSpecificPrices, setDateSpecificPrices] = useState<Record<string, string>>(() => {
        if (typeof window !== 'undefined') {
            const cached = localStorage.getItem('dadwork_date_specific_prices');
            if (cached) { try { return JSON.parse(cached); } catch(e) {} }
        }
        return {};
    });
    const [dateSpecificOverrides, setDateSpecificOverrides] = useState<Record<string, Record<string, string>>>(() => {
        if (typeof window !== 'undefined') {
            const cached = localStorage.getItem('dadwork_date_specific_overrides');
            if (cached) { try { return JSON.parse(cached); } catch(e) {} }
        }
        return {};
    });
    const [vipCaadiConfig, setVipCaadiConfig] = useState<VipCaadiCategory[]>(() => {
        if (typeof window !== 'undefined') {
            const cached = localStorage.getItem('dadwork_vip_caadi_config');
            if (cached) { try { return JSON.parse(cached); } catch(e) {} }
        }
        return [];
    });
    const [isDatePricingOpen, setIsDatePricingOpen] = useState(false);
    const [isOverridesOpen, setIsOverridesOpen] = useState(false);
    const [maqalPairDates, setMaqalPairDates] = useState<{ date1: string | null; date2: string | null; waitingDate1: string | null; waitingDate2: string | null }>({ date1: null, date2: null, waitingDate1: null, waitingDate2: null });
    
    const allowedDates = useMemo(() => {
        const pad = (n: number) => String(n).padStart(2, '0');
        const formatToDateStr = (ms: number) => {
            const d = new Date(ms);
            return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
        };

        if (maqalPairDates.date1) {
            // Focus on ACTIVE (New) and PREVIOUS (Old) pairs
            const activeDay1Ms = new Date(maqalPairDates.date1).getTime();
            const activeDay2Ms = maqalPairDates.date2 ? new Date(maqalPairDates.date2).getTime() : activeDay1Ms + 86400000;
            
            const prevDay1Ms = activeDay1Ms - 2 * 86400000;
            const prevDay2Ms = activeDay2Ms - 2 * 86400000;

            return [
                formatToDateStr(activeDay2Ms), // New Day 2
                formatToDateStr(activeDay1Ms), // New Day 1
                formatToDateStr(prevDay2Ms),   // Old Day 2
                formatToDateStr(prevDay1Ms),   // Old Day 1
            ];
        }

        let localMaqalPairDates: any[] = [];
        if (typeof window !== 'undefined') {
            try {
                localMaqalPairDates = JSON.parse(localStorage.getItem('dadwork_maqal_pair_dates') || '[]');
            } catch(e) {}
        }
        if (localMaqalPairDates && localMaqalPairDates.length >= 4) {
            return localMaqalPairDates.map((d: string) => d.split('T')[0]);
        }
        
        // Fallback for strict alignment: 
        const today = new Date();
        const activePairOffset = Math.floor(today.getDate() / 2) * 2;
        const prevPairOffset = activePairOffset - 2;
        const fallbackToDateStr = (ms: number) => new Date(ms).toISOString().split('T')[0];
        
        const epochMs = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
        return [
            fallbackToDateStr(epochMs + (activePairOffset + 1) * 86400000),
            fallbackToDateStr(epochMs + activePairOffset * 86400000),
            fallbackToDateStr(epochMs + (prevPairOffset + 1) * 86400000),
            fallbackToDateStr(epochMs + prevPairOffset * 86400000),
        ];
    }, [maqalPairDates.date1, maqalPairDates.date2]);

    const [newDatePrice, setNewDatePrice] = useState({ date: allowedDates[0], price: '' });
    const [newOverride, setNewOverride] = useState<{date: string, customerIds: string[], price: string}>({ date: allowedDates[0], customerIds: [], price: '' });
    const [expandedOverrideDates, setExpandedOverrideDates] = useState<string[]>([]);
    
    // Type Pricing feature state
    const [typeFilter, setTypeFilter] = useState<string | null>(null);
    const [isTypeDropdownOpen, setIsTypeDropdownOpen] = useState(false);
    const [typePrice, setTypePrice] = useState<string>('');
    const [individualTypePrices, setIndividualTypePrices] = useState<Record<string, string>>({});

    // Fetch REAL saved Daily Book dates from the database (for Type dropdown date picker)
    const { data: savedBookDates } = useSWR<{ date: string }[]>(
        '/api/daily-book-dates',
        (url: string) => fetch(url).then(res => res.json()),
        { revalidateOnFocus: false, dedupingInterval: 300000 }
    );

    // The most recent date that actually has Daily Book data
    const latestBookDate = useMemo(() => {
        if (savedBookDates && Array.isArray(savedBookDates) && savedBookDates.length > 0) {
            const d = savedBookDates[0].date;
            // API returns ISO datetime strings — extract YYYY-MM-DD
            return typeof d === 'string' ? d.split('T')[0] : d;
        }
        return allowedDates[0];
    }, [savedBookDates, allowedDates]);

    // When the real latest book date loads, update newOverride.date if it still points to a future/empty date
    useEffect(() => {
        if (!savedBookDates || !Array.isArray(savedBookDates) || savedBookDates.length === 0) return;
        const latest = savedBookDates[0].date.split('T')[0];
        setNewOverride(prev => {
            // Only update if current date has no real data (i.e. it's today or a future date not in saved list)
            const isCurrentDateSaved = savedBookDates.some(b => b.date.split('T')[0] === prev.date);
            if (!isCurrentDateSaved) {
                return { ...prev, date: latest };
            }
            return prev;
        });
    }, [savedBookDates]);

    const { data: dailyBookData, isValidating: isDailyBookLoading } = useSWR(
        newOverride.date ? `/api/daily-book?date=${newOverride.date}` : null,
        (url: string) => fetch(url).then(res => res.json()),
        { revalidateOnFocus: false, dedupingInterval: 30000 }
    );
    
    const toggleOverrideDate = (date: string) => {
        setExpandedOverrideDates(prev => prev.includes(date) ? prev.filter(d => d !== date) : [...prev, date]);
    };

    const [allCustomers, setAllCustomers] = useState<any[]>([]);
    const [expandedVipCaadiCategories, setExpandedVipCaadiCategories] = useState<string[]>([]);
    const toggleVipCaadiCategoryExpand = (catId: string) => {
        setExpandedVipCaadiCategories(prev => 
            prev.includes(catId) ? prev.filter(id => id !== catId) : [...prev, catId]
        );
    };

    // Calculate actual Daily Book KG, VIP Qaali KG, and maximum possible VIP Caadi KG per customer
    const dailyBookCustomerStatsMap = useMemo(() => {
        const map = new Map<string, { actualKg: number; vipQaaliKg: number; maxCaadiKg: number }>();
        if (dailyBookData?.items && Array.isArray(dailyBookData.items)) {
            for (const item of dailyBookData.items) {
                const actualKg = parseFloat(String(item.kg)) || 0;
                const vipQaaliKg = getVipCount(item.note, actualKg);
                const maxCaadiKg = Math.max(0, actualKg - vipQaaliKg);
                map.set(item.customer_id, { actualKg, vipQaaliKg, maxCaadiKg });
            }
        }
        return map;
    }, [dailyBookData]);

    // Available customers for the selected Daily Book date (every customer present on that date appears!)
    const availableCustomersForSelectedDate = useMemo(() => {
        const list: Array<{ id: string; name: string; customer_code: string; is_inactive?: boolean; is_kabarka?: boolean; actualKg: number; vipQaaliKg: number; maxCaadiKg: number }> = [];
        const seen = new Set<string>();

        // 1. If dailyBookData has items for this date, every customer with an item on this date appears!
        if (dailyBookData?.items && Array.isArray(dailyBookData.items) && dailyBookData.items.length > 0) {
            for (const item of dailyBookData.items) {
                const cust = allCustomers.find((c: any) => c.id === item.customer_id) || item.customer;
                if (cust && !seen.has(item.customer_id)) {
                    seen.add(item.customer_id);
                    const stats = dailyBookCustomerStatsMap.get(item.customer_id) || { actualKg: 0, vipQaaliKg: 0, maxCaadiKg: 0 };
                    list.push({
                        id: item.customer_id,
                        name: cust.name || 'Unknown',
                        customer_code: cust.customer_code || '',
                        is_inactive: cust.is_inactive,
                        is_kabarka: cust.is_kabarka,
                        ...stats
                    });
                }
            }
        }

        // 2. Also include all active customers from allCustomers
        for (const c of allCustomers) {
            if (!c.is_inactive && !c.is_kabarka && !seen.has(c.id)) {
                seen.add(c.id);
                const stats = dailyBookCustomerStatsMap.get(c.id) || { actualKg: 0, vipQaaliKg: 0, maxCaadiKg: 0 };
                list.push({
                    id: c.id,
                    name: c.name || 'Unknown',
                    customer_code: c.customer_code || '',
                    is_inactive: c.is_inactive,
                    is_kabarka: c.is_kabarka,
                    ...stats
                });
            }
        }

        return list.sort((a, b) => {
            const codeA = parseInt(a.customer_code.replace(/\D/g, ''), 10) || 0;
            const codeB = parseInt(b.customer_code.replace(/\D/g, ''), 10) || 0;
            return codeA - codeB;
        });
    }, [dailyBookData, allCustomers, dailyBookCustomerStatsMap]);

    // Date-specific checkmarks: Synchronize newOverride.customerIds with the selected date's VIP Caadi assignments
    useEffect(() => {
        if (!newOverride.date) return;
        const selectedDateStr = newOverride.date.substring(0, 10);
        const assignedIdsForDate = new Set<string>();
        for (const cat of vipCaadiConfig) {
            const catDateStr = cat.date ? cat.date.substring(0, 10) : undefined;
            if (catDateStr === selectedDateStr) {
                for (const id of cat.customerIds) {
                    assignedIdsForDate.add(id);
                }
            }
        }
        setNewOverride(prev => ({
            ...prev,
            customerIds: Array.from(assignedIdsForDate)
        }));
    }, [newOverride.date]);

    const [isCustomerSelectOpen, setIsCustomerSelectOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [dateActionLoading, setDateActionLoading] = useState<string | null>(null);
    const [resequenceLoading, setResequenceLoading] = useState(false);

    // Restore & Verify state
    const [backupFile, setBackupFile] = useState<File | null>(null);
    const [backupData, setBackupData] = useState<any>(null);
    const [verifyResult, setVerifyResult] = useState<any>(null);
    const [verifying, setVerifying] = useState(false);
    const [restoring, setRestoring] = useState(false);
    const [restoreConfirmText, setRestoreConfirmText] = useState('');
    const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
    const restoreFileInputRef = useRef<HTMLInputElement>(null);

    // Current User
    const [currentUser, setCurrentUser] = useState<any>(null);

    // Users state
    const [users, setUsers] = useState<UserData[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);
    const [perUserMaqal, setPerUserMaqal] = useState<PerUserMaqal[]>([]);
    const [searchUser, setSearchUser] = useState('');
    const [searchCustomer, setSearchCustomer] = useState('');
    const [isUserDialogOpen, setIsUserDialogOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState<UserData | null>(null);

    // Kickout state
    const [kickoutTarget, setKickoutTarget] = useState<{ userId: string, name: string } | null>(null);
    const [kickPin1, setKickPin1] = useState('');
    const [kickPin2, setKickPin2] = useState('');
    const [kickoutLoading, setKickoutLoading] = useState(false);

    // Audit Logs state
    const [auditLogs, setAuditLogs] = useState<any[]>(() => {
        if (typeof window !== 'undefined') {
            const cached = localStorage.getItem('dadwork_audit_logs');
            if (cached) return JSON.parse(cached);
        }
        return [];
    });
    const [auditLoading, setAuditLoading] = useState(false);
    const [auditLoadingMore, setAuditLoadingMore] = useState(false);
    const [auditTotal, setAuditTotal] = useState(() => {
        if (typeof window !== 'undefined') {
            const cached = localStorage.getItem('dadwork_audit_total');
            if (cached) return parseInt(cached, 10);
        }
        return 0;
    });
    const [auditUserStats, setAuditUserStats] = useState<any[]>(() => {
        if (typeof window !== 'undefined') {
            const cached = localStorage.getItem('dadwork_audit_stats');
            if (cached) return JSON.parse(cached);
        }
        return [];
    });
    const [auditActions, setAuditActions] = useState<string[]>([]);
    const [auditFilterUser, setAuditFilterUser] = useState('');
    const [auditFilterAction, setAuditFilterAction] = useState('');
    const [onlineSessions, setOnlineSessions] = useState<any[]>(() => {
        if (typeof window !== 'undefined') {
            const cached = localStorage.getItem('dadwork_online_sessions');
            if (cached) return JSON.parse(cached);
        }
        return [];
    });
    const [allSessions, setAllSessions] = useState<any[]>([]);

    const auditFiltersRef = useRef({ user: auditFilterUser, action: auditFilterAction });
    useEffect(() => {
        auditFiltersRef.current = { user: auditFilterUser, action: auditFilterAction };
    }, [auditFilterUser, auditFilterAction]);

    // Active tab state to keep across reloads
    const [activeTab, setActiveTab] = useState<string>('');

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const tab = params.get('tab');
        if (currentUser) {
            if (tab && (tab !== 'users' || currentUser.role === 'SUPER_ADMIN')) {
                setActiveTab(tab);
            } else {
                setActiveTab(currentUser.role === 'SUPER_ADMIN' ? 'business' : 'appearance');
            }
        }
    }, [currentUser]);

    const handleTabChange = (val: string) => {
        setActiveTab(val);
        const url = new URL(window.location.href);
        url.searchParams.set('tab', val);
        window.history.replaceState({}, '', url.toString());
    };

    // Clear Ledger History Dialog and state
    const [isClearHistoryOpen, setIsClearHistoryOpen] = useState(false);
    const [clearHistoryStep, setClearHistoryStep] = useState(1); // 1 = questions, 2 = warning/confirm
    const [motherNameVal, setMotherNameVal] = useState('');
    const [phoneVal, setPhoneVal] = useState('');
    const [birthYearVal, setBirthYearVal] = useState('');
    const [isClearingHistory, setIsClearingHistory] = useState(false);
    const [pendingSecurityAction, setPendingSecurityAction] = useState<{ type: 'delete_user', userId: string, username: string } | { type: 'clear_history' } | null>(null);

    // Admin Detail Dialog state
    const [adminDetailOpen, setAdminDetailOpen] = useState(false);
    const [adminDetailUser, setAdminDetailUser] = useState<any>(null);
    const [adminDetailLogs, setAdminDetailLogs] = useState<any[]>([]);
    const [adminDetailLoading, setAdminDetailLoading] = useState(false);
    const [adminDetailStats, setAdminDetailStats] = useState<any>(null);

    // Helper to format relative time for inactive users
    const formatRelativeTime = (date?: Date): string => {
        if (!date) return 'Never active';
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        if (diffMs < 0) return 'Just now'; // Handle clock skew
        const diffMins = Math.floor(diffMs / (1000 * 60));
        if (diffMins < 1) return 'Active just now';
        if (diffMins < 60) return `Active ${diffMins}m ago`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `Active ${diffHours}h ago`;
        const diffDays = Math.floor(diffHours / 24);
        if (diffDays === 1) return 'Active yesterday';
        return `Active ${diffDays}d ago`;
    };

    // Calculate admin online status and last seen times
    const adminStatusList = useMemo(() => {
        const adminsMap = new Map<string, { username: string; name: string; role: string; avatarUrl?: string; lastSeen?: Date; isOnline: boolean }>();

        // 1. Do NOT seed the hardcoded 'admin' fallback — only real admins with actual activity show

        // 2. Load admins from registered users table
        users.forEach(u => {
            if (u.role === 'ADMIN' || u.role === 'SUPER_ADMIN' || u.username === 'admin') {
                adminsMap.set(u.username, {
                    username: u.username,
                    name: u.name,
                    role: u.role,
                    avatarUrl: u.avatar_url,
                    isOnline: false,
                });
            }
        });

        // 3. Update from database audit trail stats (to get last active times)
        auditUserStats.forEach(stat => {
            const existing = adminsMap.get(stat.username);
            const lastActiveDate = stat.last_activity ? new Date(stat.last_activity) : undefined;
            if (existing) {
                if (lastActiveDate) {
                    existing.lastSeen = lastActiveDate;
                }
                if (stat.avatar_url) existing.avatarUrl = stat.avatar_url;
                if (stat.name) existing.name = stat.name;
                if (stat.role) existing.role = stat.role;
            }
        });

        // 4. Update from all historical sessions (captures last time they were online)
        allSessions.forEach(session => {
            const existing = adminsMap.get(session.username);
            if (existing) {
                const sessionDate = new Date(session.lastSeenAt);
                if (!existing.lastSeen || sessionDate > existing.lastSeen) {
                    existing.lastSeen = sessionDate;
                }
            }
        });

        // 5. Update from active online sessions (real-time heartbeat validation)
        onlineSessions.forEach(session => {
            const existing = adminsMap.get(session.username);
            if (existing) {
                existing.isOnline = true;
                existing.lastSeen = new Date();
                if (session.avatarUrl) existing.avatarUrl = session.avatarUrl;
                if (session.name) existing.name = session.name;
            }
        });

        // Show all admins regardless of activity history
        const list = Array.from(adminsMap.values());

        // Sort: Online first, then by last active time (latest first), then alphabetical
        return list.sort((a, b) => {
            if (a.isOnline && !b.isOnline) return -1;
            if (!a.isOnline && b.isOnline) return 1;

            if (a.lastSeen && b.lastSeen) {
                return b.lastSeen.getTime() - a.lastSeen.getTime();
            }
            if (a.lastSeen) return -1;
            if (b.lastSeen) return 1;
            return a.username.localeCompare(b.username);
        });
    }, [users, auditUserStats, onlineSessions]);

    // User Form State
    const [userForm, setUserForm] = useState({
        username: '',
        name: '',
        password: '',
        role: 'ADMIN' as string,
        gender: '',
        phone: '',
        avatar_url: '',
        assigned_customer_ids: [] as string[]
    });

    // Auto trigger DB migration on Settings page load — ONCE ONLY
    useEffect(() => {
        const alreadyMigrated = localStorage.getItem('dadwork_db_migrated_v3');
        if (alreadyMigrated) return; // ⚡ Skip if already done

        const runMigration = async () => {
            try {
                const res = await fetch('/api/fix-db');
                const data = await res.json();
                if (data.success) {
                    localStorage.setItem('dadwork_db_migrated_v3', 'true'); // Never run again
                    console.log('✅ One-time migration done');
                } else {
                    console.error('❌ Migration failed:', data.error);
                }
            } catch (e) {
                console.error('Failed to run migration:', e);
            }
        };
        runMigration();
    }, []);

    useEffect(() => {
        // Load global settings
        const loadSettings = async () => {
            try {
                const res = await fetch(`/api/settings?_t=${Date.now()}`, { cache: 'no-store' });
                const data = await res.json();
                if (data && data.dadwork_price_per_kg) {
                    setPricePerKg(data.dadwork_price_per_kg);
                    localStorage.setItem('dadwork_price_per_kg', data.dadwork_price_per_kg); // fallback for quick load
                }
                if (data && data.dadwork_date_specific_prices) {
                    try {
                        const rawVal = data.dadwork_date_specific_prices;
                        const parsed = typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal;
                        setDateSpecificPrices(parsed);
                        localStorage.setItem('dadwork_date_specific_prices', JSON.stringify(parsed)); // cache for refresh
                    } catch(e) {
                        console.error('Failed to parse date prices:', e);
                    }
                }
                if (data && data.dadwork_date_specific_overrides) {
                    try {
                        const rawVal = data.dadwork_date_specific_overrides;
                        const parsed = typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal;
                        setDateSpecificOverrides(parsed);
                        localStorage.setItem('dadwork_date_specific_overrides', JSON.stringify(parsed));
                    } catch(e) {
                        console.error('Failed to parse date overrides:', e);
                    }
                }
                if (data && data.dadwork_vip_caadi_config) {
                    try {
                        const rawVal = data.dadwork_vip_caadi_config;
                        const parsed = typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal;
                        setVipCaadiConfig(parsed);
                        localStorage.setItem('dadwork_vip_caadi_config', JSON.stringify(parsed));
                    } catch(e) {
                        console.error('Failed to parse vip caadi config:', e);
                    }
                }
            } catch (e) {
                console.error('Failed to load global settings:', e);
            }
        };
        loadSettings();

        const storedUser = localStorage.getItem('currentUser');
        const token = localStorage.getItem('dadwork_session_token');
        if (!storedUser || !token) {
            window.location.href = '/login';
            return;
        }

        if (storedUser) {
            const parsedUser = JSON.parse(storedUser);
            setCurrentUser(parsedUser);

            // Always load users + customers for all admin roles
            loadUsers();
            loadCustomers();
            // Load per-user maqal progress
            const loadPerUserMaqal = async () => {
                try {
                    // Cookie auth — NO x-session-token so Vercel CDN can cache this GET
                    const res = await fetch('/api/maqal-per-user', { credentials: 'include' });
                    if (res.ok) {
                        const data = await res.json();
                        setPerUserMaqal(data.users || []);
                        if (data.date1 && data.date2) {
                            setMaqalPairDates({ date1: data.date1, date2: data.date2, waitingDate1: data.waitingDate1, waitingDate2: data.waitingDate2 });
                        }
                    }
                } catch (e) { console.error('Failed to load per-user maqal:', e); }
            };
            loadPerUserMaqal();

            if (parsedUser.role === 'SUPER_ADMIN') {
                loadAuditLogs(auditFiltersRef.current.user, auditFiltersRef.current.action, true, true);
                loadOnlineSessions(true); // force-load fresh on page open

                // ── Heartbeat and Polling Completely Disabled to conserve Egress ──
                // User must manually hit "Refresh" buttons to see live data.
                
                return () => {};
            } else if (parsedUser.role === 'ADMIN') {
                loadOnlineSessions(true); // force-load fresh on page open
                
                // ── Heartbeat Completely Disabled ──
                return () => {};
            }
        }
    }, []);

    const loadAuditLogs = async (userFilter = auditFilterUser, actionFilter = auditFilterAction, silent = false, includeStats = false, days = 0) => {
        if (!silent) setAuditLoading(true);
        try {
            const params = new URLSearchParams({ limit: '50', stats: includeStats ? 'true' : 'false' });
            if (userFilter) params.set('user', userFilter);
            if (actionFilter) params.set('action', actionFilter);
            if (days > 0) params.set('days', String(days)); // limit to last N days
            params.set('_t', String(Date.now())); // BUST CACHE

            const res = await fetch(`/api/audit-logs?${params}`, {
                credentials: 'include',
                cache: 'no-store'
            });
            if (res.ok) {
                try {
                    const data = await res.json();
                    setAuditLogs(data.logs || []);
                    setAuditTotal(data.total || 0);
                    try {
                        localStorage.setItem('dadwork_audit_logs', JSON.stringify((data.logs || []).slice(0, 20)));
                        localStorage.setItem('dadwork_audit_total', String(data.total || 0));
                    } catch (e) { console.warn('LocalStorage quota limit reached for audit logs', e); }
                    
                    if (includeStats) {
                        setAuditUserStats(data.userStats || []);
                        setAuditActions(data.actions || []);
                        try {
                            if (data.userStats) localStorage.setItem('dadwork_audit_stats', JSON.stringify(data.userStats));
                        } catch (e) {}
                    }
                } catch (err) {
                    console.error("Failed to parse audit logs JSON", err);
                }
            }
        } catch (e) {
            console.error('Failed to load audit logs:', e);
        } finally {
            if (!silent) setAuditLoading(false);
        }
    };

    const loadMoreAuditLogs = async () => {
        setAuditLoadingMore(true);
        try {
            const params = new URLSearchParams({ limit: '20', offset: String(auditLogs.length), stats: 'false' });
            if (auditFilterUser) params.set('user', auditFilterUser);
            if (auditFilterAction) params.set('action', auditFilterAction);
            const res = await fetch(`/api/audit-logs?${params}`, {
                credentials: 'include',
            });
            if (res.ok) {
                const data = await res.json();
                setAuditLogs(prev => [...prev, ...(data.logs || [])]);
            }
        } catch (e) {
            console.error('Failed to load more audit logs:', e);
        } finally {
            setAuditLoadingMore(false);
        }
    };

    const loadAuditStats = async () => {
        try {
            const params = new URLSearchParams({ limit: '1', stats: 'true' });
            const res = await fetch(`/api/audit-logs?${params}`, {
                credentials: 'include',
            });
            if (res.ok) {
                try {
                    const data = await res.json();
                    setAuditUserStats(data.userStats || []);
                    setAuditActions(data.actions || []);
                    try {
                        if (data.userStats) localStorage.setItem('dadwork_audit_stats', JSON.stringify(data.userStats));
                    } catch(e) {}
                } catch (err) {
                    console.error("Failed to parse audit stats JSON", err);
                }
            }
        } catch (e) {
            console.error('Failed to load audit stats:', e);
        }
    };

    const loadOnlineSessions = async (force = false) => {
        // Skip the network call if we already have very fresh data (<30s) — avoids duplicate calls
        if (!force) {
            const cachedAt = localStorage.getItem('dadwork_online_sessions_at');
            const AGE_LIMIT = 30 * 1000; // 30 seconds
            if (cachedAt && Date.now() - parseInt(cachedAt) < AGE_LIMIT) {
                return;
            }
        }
        try {
            const res = await fetch('/api/admin-sessions', {
                credentials: 'include',
            });
            if (res.ok) {
                try {
                    const data = await res.json();
                    setOnlineSessions(data.online || []);
                    setAllSessions(data.all || []);
                    try {
                        if (data.online) {
                            localStorage.setItem('dadwork_online_sessions', JSON.stringify(data.online));
                            localStorage.setItem('dadwork_online_sessions_at', String(Date.now()));
                        }
                    } catch(e) {}
                } catch (err) {
                    console.error("Failed to parse online sessions JSON", err);
                }
            }
        } catch (e) {
            console.error('Failed to load online sessions:', e);
        }
    };

    const handleClearAuditLogs = async () => {
        if (!confirm('Are you sure you want to permanently delete all audit logs? This cannot be undone.')) return;
        try {
            const token = localStorage.getItem('dadwork_session_token') || '';
            const res = await fetch('/api/audit-logs', {
                method: 'DELETE',
                headers: { 'x-session-token': token }
            });
            if (res.ok) {
                toast.success('Audit logs cleared');
                setAuditLogs([]);
                setAuditTotal(0);
                loadAuditLogs(auditFilterUser, auditFilterAction, true, true);
            } else {
                toast.error('Failed to clear audit logs');
            }
        } catch (e) {
            toast.error('Network error while clearing logs');
        }
    };

    // ── Avatar cache helpers ──────────────────────────────────────────────────
    // Avatars are stored separately from user data so the main user list JSON
    // never carries big base64 blobs across the network or in localStorage.
    const AVATAR_CACHE_KEY = 'dadwork_avatars_v2';

    const saveAvatarCache = (userList: typeof users) => {
        try {
            const map: Record<string, string> = {};
            userList.forEach(u => { if (u.avatar_url) map[u.username] = u.avatar_url; });
            localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify(map));
        } catch {}
    };

    const loadAvatarCache = (): Record<string, string> => {
        try {
            return JSON.parse(localStorage.getItem(AVATAR_CACHE_KEY) || '{}');
        } catch { return {}; }
    };

    const mergeAvatars = (userList: typeof users): typeof users => {
        const cache = loadAvatarCache();
        return userList.map(u => ({
            ...u,
            avatar_url: u.avatar_url || cache[u.username] || '',
        }));
    };
    // ─────────────────────────────────────────────────────────────────────────

    const loadUsers = async () => {
        // ── Phase 1: Show cached user list instantly ──────────────────────────────
        const cached = localStorage.getItem('dadwork_settings_users');
        const cachedAt = localStorage.getItem('dadwork_settings_users_at');
        const LIST_AGE_LIMIT = 5 * 60 * 1000; // 5 min
        const isListStale = !cachedAt || Date.now() - parseInt(cachedAt) > LIST_AGE_LIMIT;
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                setUsers(mergeAvatars(parsed)); // Show from localStorage cache instantly
            } catch {}
        }

        // ── Phase 2: Fetch fresh user list (no avatars — lean) ────────────────────
        if (!isListStale && cached) {
            // List is fresh — still check if avatar cache needs refresh (background, no spinner)
        } else {
            setUsersLoading(true);
            try {
                const res = await fetch('/api/users'); // No avatars — fast & cheap
                const data = await res.json();
                if (res.ok && Array.isArray(data)) {
                    const withAvatars = mergeAvatars(data);
                    setUsers(withAvatars);
                    const dataWithoutAvatars = data.map((u: typeof users[0]) => ({ ...u, avatar_url: '' }));
                    try {
                        localStorage.setItem('dadwork_settings_users', JSON.stringify(dataWithoutAvatars));
                        localStorage.setItem('dadwork_settings_users_at', String(Date.now()));
                    } catch {}
                }
            } catch (e) {
                toast.error('Failed to load users');
            } finally {
                setUsersLoading(false);
            }
        }

        // ── Phase 3: Refresh avatar cache only if stale (>24h) or empty ──────────
        // This runs silently in background — no spinner, no egress if cache is fresh.
        try {
            const avatarCachedAt = localStorage.getItem('dadwork_avatars_cached_at');
            const AVATAR_AGE_LIMIT = 24 * 60 * 60 * 1000; // 24 hours
            const isAvatarCacheStale = !avatarCachedAt || Date.now() - parseInt(avatarCachedAt) > AVATAR_AGE_LIMIT;
            const existingAvatarCache = loadAvatarCache();
            // Force fetch if cache has fewer than 2 avatars (since we know we have multiple admins)
            const hasMissingAvatars = Object.keys(existingAvatarCache).length < 2;

            if (isAvatarCacheStale || hasMissingAvatars) {
                // Fetch avatars once per 24 hours — this is the ONLY time avatar blobs are downloaded
                const avatarRes = await fetch('/api/users?withAvatar=true');
                const avatarData = await avatarRes.json();
                if (avatarRes.ok && Array.isArray(avatarData)) {
                    saveAvatarCache(avatarData); // Save to localStorage
                    localStorage.setItem('dadwork_avatars_cached_at', String(Date.now()));
                    // Update users in state with fresh avatars
                    setUsers(prev => mergeAvatars(prev));
                }
            }
        } catch { /* Silent — avatar load failure is not critical */ }
    };

    const loadCustomers = async () => {
        // Show cached data instantly
        const cached = localStorage.getItem('dadwork_settings_customers');
        const cachedAt = localStorage.getItem('dadwork_settings_customers_at');
        const AGE_LIMIT = 5 * 60 * 1000; // 5 min
        const isStale = !cachedAt || Date.now() - parseInt(cachedAt) > AGE_LIMIT;
        if (cached) {
            try { setAllCustomers(JSON.parse(cached)); } catch {}
        }
        if (!isStale && cached) return; // Skip — still fresh
        try {
            const res = await fetch('/api/customers?lite=true');
            const data = await res.json();
            if (res.ok && Array.isArray(data)) {
                setAllCustomers(data);
                try {
                    localStorage.setItem('dadwork_settings_customers', JSON.stringify(data));
                    localStorage.setItem('dadwork_settings_customers_at', String(Date.now()));
                } catch {}
            }
        } catch (e) {
            console.error('Failed to load customers:', e);
        }
    };

    const handleSavePrice = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('dadwork_session_token') || '';
            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-session-token': token
                },
                body: JSON.stringify({ key: 'dadwork_price_per_kg', value: pricePerKg })
            });
            if (res.ok) {
                localStorage.setItem('dadwork_price_per_kg', pricePerKg);
                toast.success(`Global Price per KG set to $${pricePerKg}`);
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(`Failed to save global price: ${err.error || res.statusText}`);
            }
        } catch (e) {
            toast.error('Network error');
        } finally {
            setLoading(false);
        }
    };

    const handleSaveDatePrice = async (newPrices: Record<string, string>, loadingKey: string) => {
        setDateActionLoading(loadingKey);
        
        try {
            const token = localStorage.getItem('dadwork_session_token') || '';
            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-session-token': token
                },
                body: JSON.stringify({ key: 'dadwork_date_specific_prices', value: JSON.stringify(newPrices) })
            });
            if (res.ok) {
                localStorage.setItem('dadwork_date_specific_prices', JSON.stringify(newPrices)); // persist for refresh
                setDateSpecificPrices(newPrices); // Update UI only on success so loading shows
                toast.success('Date-specific prices updated');
                setDateActionLoading(null);
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(`Failed to save date-specific prices: ${err.error || res.statusText}`);
                setDateActionLoading(null);
            }
        } catch (e) {
            toast.error('Network error');
            setDateActionLoading(null);
        }
    };

    const handleAddDatePrice = () => {
        if (!newDatePrice.date || !newDatePrice.price) {
            toast.error('Please enter both date and price');
            return;
        }
        if (!allowedDates.includes(newDatePrice.date)) {
            toast.error('You can only set prices for recent days');
            return;
        }
        if (dateSpecificPrices[newDatePrice.date]) {
            toast.error('This date already has a price. Delete it first to change it.');
            return;
        }
        const numericPrice = parseFloat(newDatePrice.price);
        if (isNaN(numericPrice) || numericPrice > 100 || numericPrice <= 0) {
            toast.error('Please enter a valid price (1-100)');
            return;
        }
        
        let updated = { ...dateSpecificPrices, [newDatePrice.date]: newDatePrice.price };
        
        handleSaveDatePrice(updated, 'add');
        
        // After adding, auto-switch the dropdown to the OTHER date if it's not added yet
        const otherDate = allowedDates.find(d => d !== newDatePrice.date && !updated[d]);
        setNewDatePrice({ date: otherDate || allowedDates[0], price: '' });
    };

    const handleRemoveDatePrice = (dateToRemove: string) => {
        const updated = { ...dateSpecificPrices };
        delete updated[dateToRemove];
        handleSaveDatePrice(updated, `delete-${dateToRemove}`);
    };

    const handleSaveDateOverrides = async (newOverrides: Record<string, Record<string, string>>, loadingKey: string) => {
        setDateActionLoading(loadingKey);
        try {
            const token = localStorage.getItem('dadwork_session_token') || '';
            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-session-token': token
                },
                body: JSON.stringify({ key: 'dadwork_date_specific_overrides', value: JSON.stringify(newOverrides) })
            });
            if (res.ok) {
                localStorage.setItem('dadwork_date_specific_overrides', JSON.stringify(newOverrides));
                setDateSpecificOverrides(newOverrides);
                toast.success('Customer overrides updated');
                setDateActionLoading(null);
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(`Failed to save overrides: ${err.error || res.statusText}`);
                setDateActionLoading(null);
            }
        } catch (e) {
            toast.error('Network error');
            setDateActionLoading(null);
        }
    };

    const handleAddOverride = () => {
        if (!newOverride.date || newOverride.customerIds.length === 0 || !newOverride.price) {
            toast.error('Please enter date, select at least one customer, and price');
            return;
        }
        if (!allowedDates.includes(newOverride.date)) {
            toast.error('You can only set overrides for recent days');
            return;
        }
        const numericPrice = parseFloat(newOverride.price);
        if (isNaN(numericPrice) || numericPrice > 100 || numericPrice <= 0) {
            toast.error('Please enter a valid price (1-100)');
            return;
        }

        const dateMap = { ...(dateSpecificOverrides[newOverride.date] || {}) };
        
        let hasConflict = false;
        newOverride.customerIds.forEach(id => {
            if (dateMap[id]) {
                hasConflict = true;
            }
            dateMap[id] = newOverride.price;
        });

        if (hasConflict) {
             toast.warning('Overwriting existing price overrides for one or more selected customers.');
        }

        let updated = { ...dateSpecificOverrides, [newOverride.date]: dateMap };

        handleSaveDateOverrides(updated, 'add-override');
        setNewOverride({ ...newOverride, customerIds: [], price: '' });
        setIsCustomerSelectOpen(false);
    };

    const handleRemoveOverride = (date: string, customerId: string) => {
        const updated = { ...dateSpecificOverrides };
        if (updated[date]) {
            delete updated[date][customerId];
            if (Object.keys(updated[date]).length === 0) {
                delete updated[date];
            }
        }
        handleSaveDateOverrides(updated, `delete-override-${date}-${customerId}`);
    };

    const handleSaveVipCaadiConfig = async (newConfig: VipCaadiCategory[], loadingKey: string) => {
        setDateActionLoading(loadingKey);
        try {
            const token = localStorage.getItem('dadwork_session_token') || '';
            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-session-token': token
                },
                body: JSON.stringify({ key: 'dadwork_vip_caadi_config', value: JSON.stringify(newConfig) })
            });
            if (res.ok) {
                localStorage.setItem('dadwork_vip_caadi_config', JSON.stringify(newConfig));
                setVipCaadiConfig(newConfig);
                toast.success('VIP Caadi configuration updated');
                setDateActionLoading(null);
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(`Failed to save VIP Caadi: ${err.error || res.statusText}`);
                setDateActionLoading(null);
            }
        } catch (e) {
            toast.error('Network error');
            setDateActionLoading(null);
        }
    };

    const handleAddVipCaadiGroup = () => {
        if (newOverride.customerIds.length === 0) {
            toast.info('Please select at least one customer first to add VIP');
            return;
        }
        const initialPrices: Record<string, string> = {};
        if (newOverride.price) {
            const numericPrice = parseFloat(newOverride.price);
            if (!isNaN(numericPrice) && numericPrice > 0 && numericPrice <= 100) {
                newOverride.customerIds.forEach(id => {
                    initialPrices[id] = newOverride.price;
                });
            }
        }

        const newGroup: VipCaadiCategory = {
            id: `vip-caadi-${Date.now()}`,
            label: 'VIP Caadi',
            customerIds: [...newOverride.customerIds],
            customerPrices: initialPrices,
            date: newOverride.date || undefined,
            created_at: new Date().toISOString()
        };

        const updated = [...vipCaadiConfig, newGroup];
        handleSaveVipCaadiConfig(updated, 'add-vip-caadi');
        setNewOverride(prev => ({ ...prev, customerIds: [], price: '' }));
        setIsCustomerSelectOpen(false);
    };

    const handleUpdateVipCaadiLabel = (categoryId: string, newLabel: string) => {
        const updated = vipCaadiConfig.map(cat => 
            cat.id === categoryId ? { ...cat, label: newLabel } : cat
        );
        setVipCaadiConfig(updated);
        localStorage.setItem('dadwork_vip_caadi_config', JSON.stringify(updated));
    };

    const handleSaveVipCaadiLabel = (categoryId: string) => {
        handleSaveVipCaadiConfig(vipCaadiConfig, `save-label-${categoryId}`);
    };

    const handleUpdateVipCaadiCustomerPrice = (categoryId: string, customerId: string, price: string) => {
        const updated = vipCaadiConfig.map(cat => {
            if (cat.id !== categoryId) return cat;
            return {
                ...cat,
                customerPrices: {
                    ...cat.customerPrices,
                    [customerId]: price
                }
            };
        });
        setVipCaadiConfig(updated);
        localStorage.setItem('dadwork_vip_caadi_config', JSON.stringify(updated));
    };

    const handleRemoveVipCaadiCustomer = (categoryId: string, customerId: string) => {
        const updated = vipCaadiConfig.map(cat => {
            if (cat.id !== categoryId) return cat;
            const newCustIds = cat.customerIds.filter(id => id !== customerId);
            const newPrices = { ...cat.customerPrices };
            delete newPrices[customerId];
            return {
                ...cat,
                customerIds: newCustIds,
                customerPrices: newPrices
            };
        }).filter(cat => cat.customerIds.length > 0);
        handleSaveVipCaadiConfig(updated, `remove-cust-${categoryId}-${customerId}`);
    };

    const handleUpdateVipCaadiCustomerKg = (categoryId: string, customerId: string, kgString: string) => {
        // Optimistic update for the input field only — does not save to DB
        const updated = vipCaadiConfig.map(cat => {
            if (cat.id !== categoryId) return cat;
            return {
                ...cat,
                customerKgs: {
                    ...cat.customerKgs,
                    [customerId]: parseFloat(kgString) || 0
                }
            };
        });
        setVipCaadiConfig(updated);
        localStorage.setItem('dadwork_vip_caadi_config', JSON.stringify(updated));
    };

    const handleSaveVipCaadiCustomerKg = (categoryId: string, customerId: string) => {
        // Validate boundary: vipCaadiKg <= maxVipCaadiKg
        const cat = vipCaadiConfig.find(c => c.id === categoryId);
        if (!cat) return;
        const stats = dailyBookCustomerStatsMap.get(customerId);
        const enteredKg = cat.customerKgs?.[customerId] ?? 0;
        if (stats && enteredKg > stats.maxCaadiKg) {
            toast.error(
                `Maximum VIP Caadi KG is ${stats.maxCaadiKg} KG because ${stats.vipQaaliKg} KG is already VIP Qaali.`,
                { duration: 5000 }
            );
            return;
        }
        handleSaveVipCaadiConfig(vipCaadiConfig, `save-kg-${categoryId}-${customerId}`);
    };

    const handleDeleteVipCaadiCategory = (categoryId: string) => {
        const updated = vipCaadiConfig.filter(cat => cat.id !== categoryId);
        handleSaveVipCaadiConfig(updated, `delete-cat-${categoryId}`);
    };

    // Dynamically discover all unique types from the relevant Daily Book items on the selected date
    const availableTypes = useMemo(() => {
        const typeMap = new Map<string, string>();
        // Standard baseline types
        typeMap.set('vip', 'VIP');
        typeMap.set('heshiish', 'Heshiish');

        if (dailyBookData?.items && Array.isArray(dailyBookData.items)) {
            for (const item of dailyBookData.items) {
                if (!item?.note) continue;
                const parts = item.note.split(',').map((s: string) => s.trim()).filter(Boolean);
                for (const part of parts) {
                    const match = part.match(/^(?:(\d+(?:\.\d+)?)\s+)?([a-zA-Z]+)(?:\s+(\d+(?:\.\d+)?))?$/);
                    if (match && match[2]) {
                        const raw = match[2].trim();
                        const key = raw.toLowerCase();
                        if (!typeMap.has(key)) {
                            let display = raw;
                            if (key === 'vip') {
                                display = 'VIP';
                            } else if (raw === raw.toUpperCase() && raw.length > 1) {
                                display = raw;
                            } else {
                                display = key.charAt(0).toUpperCase() + key.slice(1).toLowerCase();
                            }
                            typeMap.set(key, display);
                        }
                    }
                }
            }
        }
        return Array.from(typeMap.values());
    }, [dailyBookData]);

    const filteredTypeCustomers = useMemo(() => {
        if (!typeFilter || !dailyBookData?.items) return [];
        return dailyBookData.items
            .filter((i: any) => {
                if (!i.note) return false;
                const parts = i.note.split(',').map((s: string) => s.trim()).filter(Boolean);
                return parts.some((p: string) => {
                    const match = p.match(/^(\d+(?:\.\d+)?)\s+([a-zA-Z]+)(?:\s+(\d+(?:\.\d+)?))?$/);
                    if (match && match[2]) {
                        return match[2].trim().toLowerCase() === typeFilter.toLowerCase();
                    }
                    return p.toLowerCase().includes(typeFilter.toLowerCase());
                });
            })
            .map((i: any) => {
                const cust = allCustomers.find(c => c.id === i.customer_id);
                let price: string | null = null;
                let isMultiple = false;
                let calculatedKg = 0;
                let hasMatchedParts = false;
                
                const parts = i.note.split(',').map((s: string) => s.trim()).filter(Boolean);
                const matchingParts = parts.filter((p: string) => {
                    const match = p.match(/^(\d+(?:\.\d+)?)\s+([a-zA-Z]+)(?:\s+(\d+(?:\.\d+)?))?$/);
                    if (match && match[2]) {
                        return match[2].trim().toLowerCase() === typeFilter.toLowerCase();
                    }
                    return p.toLowerCase().includes(typeFilter.toLowerCase());
                });
                
                matchingParts.forEach((p: string) => {
                    const match = p.match(/^(\d+(?:\.\d+)?)\s+([a-zA-Z]+)(?:\s+(\d+(?:\.\d+)?))?$/);
                    if (match) {
                        hasMatchedParts = true;
                        calculatedKg += parseFloat(match[1]) || 0;
                        if (match[3]) {
                            price = match[3];
                        }
                    }
                });

                if (matchingParts.length > 1) {
                    isMultiple = true;
                    const prices = matchingParts.map((p: string) => {
                        const match = p.match(/^(\d+(?:\.\d+)?)\s+([a-zA-Z]+)(?:\s+(\d+(?:\.\d+)?))?$/);
                        return match && match[3] ? match[3] : null;
                    }).filter(Boolean);
                    if (prices.length > 0) {
                        price = prices.join(' / ');
                    }
                }

                // If no specific kg found in note pattern, fallback to i.kg
                const effectiveKg = hasMatchedParts && calculatedKg > 0 ? calculatedKg : (parseFloat(i.kg) || 0);
                
                return { ...i, customer: cust, basePrice: price, isMultiple, matchingKg: effectiveKg };
            })
            .filter((i: any) => i.customer);
    }, [typeFilter, dailyBookData, allCustomers]);

    const totalTypeKg = useMemo(() => {
        return filteredTypeCustomers.reduce((sum: number, c: any) => sum + (c.matchingKg || 0), 0);
    }, [filteredTypeCustomers]);

    const handleTypeApply = async () => {
        const numericPrice = parseFloat(typePrice);
        if (isNaN(numericPrice) || numericPrice > 100 || numericPrice <= 0) {
            toast.error('Please enter a valid price (1-100)');
            return;
        }

        if (!dailyBookData || !dailyBookData.items || !typeFilter) return;

        setDateActionLoading('type-apply');
        
        // Deep copy items to maintain their structure and kg safely
        const newItems = JSON.parse(JSON.stringify(dailyBookData.items));
        let appliedCount = 0;
        
        filteredTypeCustomers.forEach((c: any) => {
            // ONLY apply if they DO NOT already have a manual price and are NOT multiple
            if (!c.basePrice && !c.isMultiple) {
                const itemToUpdate = newItems.find((i: any) => i.id === c.id);
                if (itemToUpdate && itemToUpdate.note) {
                    const parts = itemToUpdate.note.split(',').map((s: string) => s.trim()).filter(Boolean);
                    const updatedParts = parts.map((part: string) => {
                        const match = part.match(/^(\d+(?:\.\d+)?)\s+([a-zA-Z]+)(?:\s+(\d+(?:\.\d+)?))?$/);
                        if (match) {
                            const kg = match[1];
                            const label = match[2];
                            const price = match[3] || null;
                            if (label.trim().toLowerCase() === typeFilter?.toLowerCase() && !price) {
                                return `${kg} ${label} ${typePrice}`; // Apply price
                            }
                        }
                        return part;
                    });
                    itemToUpdate.note = updatedParts.join(', ');
                    appliedCount++;
                }
            }
        });

        if (appliedCount === 0) {
            toast.info('No eligible customers to apply price to (all already have prices).');
            setDateActionLoading(null);
            return;
        }

        try {
            const res = await fetch('/api/daily-book', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    date: newOverride.date,
                    items: newItems
                })
            });

            if (!res.ok) throw new Error('Failed to save daily book');
            
            // Instantly update SWR cache to re-render without a page reload
            await mutate(`/api/daily-book?date=${newOverride.date}`);
            
            // Invalidate Maqalka data sources for affected customers!
            mutate('/api/customers?mode=ledger');

            const draftRaw = localStorage.getItem('dadwork_ledger_draft');
            let draft: any = null;
            if (draftRaw) {
                try { draft = JSON.parse(draftRaw); } catch (e) {}
            }

            filteredTypeCustomers.forEach((c: any) => {
                if (!c.basePrice && !c.isMultiple) {
                    // Use a dynamic filter to match ANY query parameters (like &startDate=...)
                    mutate((key) => typeof key === 'string' && key.startsWith(`/api/ledger?customerId=${c.customer_id}`));
                    mutate((key) => typeof key === 'string' && key.startsWith(`/api/customer-daily-entries?customerId=${c.customer_id}`));

                    // SAFELY invalidate the local draft's dateEntries WITHOUT destroying paymentEntries
                    if (draft && draft.selectedCustomerId === c.customer_id) {
                        draft.dateEntries = [];
                    }
                }
            });

            if (draft) {
                localStorage.setItem('dadwork_ledger_draft', JSON.stringify(draft));
            }

            // Signal other tabs/pages (like Ledger) to re-fetch immediately on focus
            localStorage.setItem('dadwork_ledger_stale', Date.now().toString());

            setTypePrice('');
            toast.success(`Applied $${typePrice} to all ${appliedCount} customers`);
        } catch (error: any) {
            toast.error(error.message || 'Error updating daily book');
        } finally {
            setDateActionLoading(null);
        }
    };

    const handleIndividualTypeApply = async (customerId: string, priceVal: string) => {
        const numericPrice = parseFloat(priceVal);
        if (isNaN(numericPrice) || numericPrice > 100 || numericPrice <= 0) {
            toast.error('Please enter a valid price (1-100)');
            return;
        }

        if (!dailyBookData || !dailyBookData.items || !typeFilter) return;

        setDateActionLoading(`apply-type-${customerId}`);
        const newItems = JSON.parse(JSON.stringify(dailyBookData.items));
        const itemToUpdate = newItems.find((i: any) => i.customer_id === customerId);

        if (itemToUpdate && itemToUpdate.note) {
            const parts = itemToUpdate.note.split(',').map((s: string) => s.trim()).filter(Boolean);
            const updatedParts = parts.map((part: string) => {
                const match = part.match(/^(\d+(?:\.\d+)?)\s+([a-zA-Z]+)(?:\s+(\d+(?:\.\d+)?))?$/);
                if (match) {
                    const kg = match[1];
                    const label = match[2];
                    if (label.trim().toLowerCase() === typeFilter?.toLowerCase()) {
                        return `${kg} ${label} ${priceVal}`;
                    }
                }
                return part;
            });
            itemToUpdate.note = updatedParts.join(', ');

            try {
                const res = await fetch('/api/daily-book', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        date: newOverride.date,
                        items: newItems
                    })
                });

                if (!res.ok) throw new Error('Failed to save price override');

                await mutate(`/api/daily-book?date=${newOverride.date}`);
                mutate('/api/customers?mode=ledger');
                mutate((key) => typeof key === 'string' && key.startsWith(`/api/ledger?customerId=${customerId}`));
                mutate((key) => typeof key === 'string' && key.startsWith(`/api/customer-daily-entries?customerId=${customerId}`));

                const draftRaw = localStorage.getItem('dadwork_ledger_draft');
                if (draftRaw) {
                    try {
                        const draft = JSON.parse(draftRaw);
                        if (draft && draft.selectedCustomerId === customerId) {
                            draft.dateEntries = [];
                            localStorage.setItem('dadwork_ledger_draft', JSON.stringify(draft));
                        }
                    } catch (e) {}
                }
                localStorage.setItem('dadwork_ledger_stale', Date.now().toString());

                setIndividualTypePrices(prev => ({ ...prev, [customerId]: '' }));
                toast.success(`Applied $${priceVal}`);
            } catch (error: any) {
                toast.error(error.message || 'Error updating price');
            } finally {
                setDateActionLoading(null);
            }
        } else {
            setDateActionLoading(null);
        }
    };

    const handleTypeClear = async (customerId: string) => {
        if (!dailyBookData || !dailyBookData.items || !typeFilter) return;
        
        setDateActionLoading(`clear-type-${customerId}`);
        
        const newItems = JSON.parse(JSON.stringify(dailyBookData.items));
        const itemToUpdate = newItems.find((i: any) => i.customer_id === customerId);
        
        if (itemToUpdate && itemToUpdate.note) {
            const parts = itemToUpdate.note.split(',').map((s: string) => s.trim()).filter(Boolean);
            const updatedParts = parts.map((part: string) => {
                const match = part.match(/^(\d+(?:\.\d+)?)\s+([a-zA-Z]+)(?:\s+(\d+(?:\.\d+)?))?$/);
                if (match) {
                    const kg = match[1];
                    const label = match[2];
                    const price = match[3] || null;
                    if (label.trim().toLowerCase() === typeFilter?.toLowerCase() && price) {
                        return `${kg} ${label}`; // Strip the price
                    }
                }
                return part;
            });
            itemToUpdate.note = updatedParts.join(', ');
            
            try {
                const res = await fetch('/api/daily-book', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        date: newOverride.date,
                        items: newItems
                    })
                });

                if (!res.ok) throw new Error('Failed to clear price');
                
                await mutate(`/api/daily-book?date=${newOverride.date}`);
                
                // Invalidate Maqalka data sources for the affected customer!
                mutate('/api/customers?mode=ledger');
                mutate((key) => typeof key === 'string' && key.startsWith(`/api/ledger?customerId=${customerId}`));
                mutate((key) => typeof key === 'string' && key.startsWith(`/api/customer-daily-entries?customerId=${customerId}`));

                // SAFELY invalidate the local draft
                const draftRaw = localStorage.getItem('dadwork_ledger_draft');
                if (draftRaw) {
                    try { 
                        const draft = JSON.parse(draftRaw);
                        if (draft && draft.selectedCustomerId === customerId) {
                            draft.dateEntries = [];
                            localStorage.setItem('dadwork_ledger_draft', JSON.stringify(draft));
                        }
                    } catch(e){}
                }

                toast.success('Price cleared successfully');
            } catch (error: any) {
                toast.error(error.message || 'Error clearing price');
            }
        }
        setDateActionLoading(null);
    };

    const handleTypeClearAll = async () => {
        if (!dailyBookData || !dailyBookData.items || !typeFilter) return;

        setDateActionLoading('type-clear-all');
        const newItems = JSON.parse(JSON.stringify(dailyBookData.items));
        let clearedCount = 0;

        filteredTypeCustomers.forEach((c: any) => {
            if (c.basePrice) {
                const itemToUpdate = newItems.find((i: any) => i.id === c.id);
                if (itemToUpdate && itemToUpdate.note) {
                    const parts = itemToUpdate.note.split(',').map((s: string) => s.trim()).filter(Boolean);
                    const updatedParts = parts.map((part: string) => {
                        const match = part.match(/^(\d+(?:\.\d+)?)\s+([a-zA-Z]+)(?:\s+(\d+(?:\.\d+)?))?$/);
                        if (match) {
                            const kg = match[1];
                            const label = match[2];
                            const price = match[3] || null;
                            if (label.trim().toLowerCase() === typeFilter?.toLowerCase() && price) {
                                return `${kg} ${label}`; // Strip price, preserve kg and label
                            }
                        }
                        return part;
                    });
                    itemToUpdate.note = updatedParts.join(', ');
                    clearedCount++;
                }
            }
        });

        if (clearedCount === 0) {
            toast.info('No price overrides to clear.');
            setDateActionLoading(null);
            return;
        }

        try {
            const res = await fetch('/api/daily-book', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    date: newOverride.date,
                    items: newItems
                })
            });

            if (!res.ok) throw new Error('Failed to clear prices');

            await mutate(`/api/daily-book?date=${newOverride.date}`);
            mutate('/api/customers?mode=ledger');

            const draftRaw = localStorage.getItem('dadwork_ledger_draft');
            let draft: any = null;
            if (draftRaw) {
                try { draft = JSON.parse(draftRaw); } catch (e) {}
            }

            filteredTypeCustomers.forEach((c: any) => {
                mutate((key) => typeof key === 'string' && key.startsWith(`/api/ledger?customerId=${c.customer_id}`));
                mutate((key) => typeof key === 'string' && key.startsWith(`/api/customer-daily-entries?customerId=${c.customer_id}`));

                if (draft && draft.selectedCustomerId === c.customer_id) {
                    draft.dateEntries = [];
                }
            });

            if (draft) {
                localStorage.setItem('dadwork_ledger_draft', JSON.stringify(draft));
            }
            localStorage.setItem('dadwork_ledger_stale', Date.now().toString());

            toast.success(`Cleared price overrides for ${clearedCount} customers`);
        } catch (error: any) {
            toast.error(error.message || 'Error clearing prices');
        } finally {
            setDateActionLoading(null);
        }
    };

    // Backup/Export
    const handleExportPDF = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('dadwork_session_token') || '';
            const custRes = await fetch('/api/customers', {
                headers: { 'x-session-token': token }
            });
            const customers = await custRes.json();

            if (Array.isArray(customers)) {
                const txnsByCustomer: Record<string, any[]> = {};
                for (const cust of customers) {
                    const ledgerRes = await fetch(`/api/ledger?customerId=${cust.id}&limit=500`, {
                        headers: { 'x-session-token': token }
                    });
                    const ledgerData = await ledgerRes.json();
                    txnsByCustomer[cust.id] = ledgerData.transactions || [];
                }

                const { downloadSystemBackupPDF } = await import('@/lib/export-pdf');
                downloadSystemBackupPDF(customers, txnsByCustomer);
                toast.success('Colorful PDF backup exported successfully');
            }
        } catch (e) {
            toast.error('Failed to export PDF');
        } finally {
            setLoading(false);
        }
    };

    // User actions
    const targetRole = currentUser?.role === 'SUPER_ADMIN' ? 'ADMIN' : 'USER';

    const handleOpenCreateDialog = () => {
        setSelectedUser(null);
        setUserForm({
            username: '',
            name: '',
            password: '',
            role: targetRole as any,
            gender: '',
            phone: '',
            avatar_url: '',
            assigned_customer_ids: []
        });
        setSearchCustomer('');
        setIsUserDialogOpen(true);
    };

    const handleOpenEditDialog = (user: UserData) => {
        setSelectedUser(user);
        setUserForm({
            username: user.username,
            name: user.name || '',
            password: user.password || '',
            role: user.role,
            gender: user.gender || '',
            phone: user.phone || '',
            avatar_url: user.avatar_url || '',
            assigned_customer_ids: user.assigned_customer_ids || []
        });
        setSearchCustomer('');
        setIsUserDialogOpen(true);
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    // True center-crop square → 80×80 WebP @ 55% quality
                    // Result: ~3-6 KB per avatar (was 30-80 KB with old approach)
                    const SIZE = 80;
                    const canvas = document.createElement('canvas');
                    canvas.width = SIZE;
                    canvas.height = SIZE;
                    const ctx = canvas.getContext('2d')!;

                    // Compute center-crop source rect
                    const srcSide = Math.min(img.width, img.height);
                    const srcX = (img.width - srcSide) / 2;
                    const srcY = (img.height - srcSide) / 2;

                    ctx.drawImage(img, srcX, srcY, srcSide, srcSide, 0, 0, SIZE, SIZE);

                    // Prefer WebP (50% smaller), fall back to JPEG
                    const supportsWebP = canvas.toDataURL('image/webp').startsWith('data:image/webp');
                    const dataUrl = canvas.toDataURL(supportsWebP ? 'image/webp' : 'image/jpeg', 0.55);
                    setUserForm(prev => ({ ...prev, avatar_url: dataUrl }));
                };
                img.src = event.target?.result as string;
            };
            reader.readAsDataURL(file);
        }
    };

    const handleToggleCustomerAssignment = (customerId: string) => {
        setUserForm(prev => {
            const alreadyAssigned = prev.assigned_customer_ids.includes(customerId);
            if (alreadyAssigned) {
                return {
                    ...prev,
                    assigned_customer_ids: prev.assigned_customer_ids.filter(id => id !== customerId)
                };
            } else {
                return {
                    ...prev,
                    assigned_customer_ids: [...prev.assigned_customer_ids, customerId]
                };
            }
        });
    };

    const handleSaveUser = async () => {
        if (!userForm.username || !userForm.name) {
            toast.error('Username and Full Name are required');
            return;
        }

        setLoading(true);
        try {
            const isEditing = selectedUser !== null;
            const url = isEditing ? `/api/users/${selectedUser.id}` : '/api/users';
            const method = isEditing ? 'PUT' : 'POST';

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(userForm)
            });

            const responseData = await res.json();

            if (res.ok) {
                toast.success(isEditing ? 'User updated successfully' : 'User created successfully');
                setIsUserDialogOpen(false);

                if (isEditing && currentUser && selectedUser?.id === currentUser.id) {
                    const updatedUser = { ...currentUser, ...responseData };
                    localStorage.setItem('currentUser', JSON.stringify(updatedUser));
                    setCurrentUser(updatedUser);
                }

                // Immediately update avatar cache so new picture is visible offline
                if (userForm.avatar_url) {
                    try {
                        const avatarCache = JSON.parse(localStorage.getItem('dadwork_avatars_v2') || '{}');
                        avatarCache[userForm.username] = userForm.avatar_url;
                        localStorage.setItem('dadwork_avatars_v2', JSON.stringify(avatarCache));
                    } catch {}
                }

                // Optimistically update the UI so priority customer counts reflect instantly
                setUsers(prev => {
                    const newUsers = isEditing 
                        ? prev.map(u => u.id === responseData.id ? { ...u, ...responseData } : u)
                        : [responseData, ...prev];
                    
                    // Bust the local cache so the next refresh is also fresh
                    try {
                        const dataWithoutAvatars = newUsers.map(u => ({ ...u, avatar_url: '' }));
                        localStorage.setItem('dadwork_settings_users', JSON.stringify(dataWithoutAvatars));
                        localStorage.setItem('dadwork_settings_users_at', String(Date.now()));
                    } catch {}
                    
                    return newUsers;
                });
                
                // Force a background re-fetch to ensure sync with server
                setTimeout(() => loadUsers(), 500);
            } else {
                toast.error(responseData.error || 'Failed to save user');
            }
        } catch (e) {
            toast.error('Connection error occurred');
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteUser = (userId: string, username: string) => {
        setPendingSecurityAction({ type: 'delete_user', userId, username });
    };

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
                toast.success(`🦵 ${kickoutTarget.name} has been kicked out!`);
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
                toast.error('Failed to restore user');
            }
        } catch {
            toast.error('Network error');
        }
    };

    const executeDeleteUser = async () => {
        if (!pendingSecurityAction || pendingSecurityAction.type !== 'delete_user') return;
        const { userId } = pendingSecurityAction;
        setPendingSecurityAction(null);

        try {
            const res = await fetch(`/api/users?id=${userId}`, {
                method: 'DELETE'
            });

            if (res.ok) {
                toast.success('User deleted successfully');
                loadUsers();
            } else {
                toast.error('Failed to delete user');
            }
        } catch (e) {
            toast.error('Connection error occurred');
        }
    };

    const handleVerifyConditions = () => {
        if (motherNameVal.trim().toLowerCase() !== 'nasteexo') {
            toast.error("Incorrect answer for Mother's Name.");
            return;
        }
        if (phoneVal.trim() !== '0618372575') {
            toast.error("Incorrect phone number.");
            return;
        }
        if (birthYearVal.trim() !== '2919') {
            toast.error("Incorrect PIN.");
            return;
        }
        setClearHistoryStep(2);
    };

    const handleClearLedgerHistory = () => {
        setPendingSecurityAction({ type: 'clear_history' });
    };

    const executeClearLedgerHistory = async () => {
        setPendingSecurityAction(null);
        setIsClearHistoryOpen(false);
        setClearHistoryStep(1);
        setIsClearingHistory(true);
        try {
            const token = localStorage.getItem('dadwork_session_token') || '';
            const res = await fetch('/api/ledger/clear-all', {
                method: 'DELETE',
                headers: { 'x-session-token': token }
            });
            const data = await res.json();
            if (res.ok && data.success) {
                toast.success(`Successfully cleared all customer ledger history (${data.deletedCount} entries deleted)`);
                loadCustomers();
            } else {
                toast.error(data.error || 'Failed to clear history');
            }
        } catch (e) {
            toast.error('Network error occurred while clearing history');
        } finally {
            setIsClearingHistory(false);
        }
    };

    const handleToggleUserAdmin = async (user: UserData) => {
        const newRole = user.role === 'ADMIN' ? 'CUSTOMER' : 'ADMIN';
        try {
            const res = await fetch(`/api/users/${user.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: newRole })
            });

            if (res.ok) {
                toast.success(`Role updated to ${newRole}`);
                loadUsers();
            } else {
                toast.error('Failed to update role');
            }
        } catch (e) {
            toast.error('Connection error');
        }
    };

    // Open Admin Detail Dialog
    const openAdminDetail = async (adminInfo: { username: string; name: string; role: string; avatarUrl?: string; isOnline: boolean; lastSeen?: Date }) => {
        setAdminDetailUser(adminInfo);
        setAdminDetailLogs([]);
        setAdminDetailStats(null);
        setAdminDetailOpen(true);
        setAdminDetailLoading(true);
        try {
            const token = localStorage.getItem('dadwork_session_token') || '';
            const params = new URLSearchParams({ user: adminInfo.username, limit: '500' });
            const res = await fetch(`/api/audit-logs?${params}`, {
                headers: { 'x-session-token': token }
            });
            if (res.ok) {
                const data = await res.json();
                setAdminDetailLogs(data.logs || []);
                const stat = (data.userStats || []).find((s: any) => s.username === adminInfo.username);
                setAdminDetailStats(stat || null);
            }
        } catch (e) {
            console.error('Failed to load admin detail:', e);
        } finally {
            setAdminDetailLoading(false);
        }
    };

    // Filters
    const filteredUsers = users.filter(u =>
        ((currentUser?.role === 'SUPER_ADMIN' && (u.role === 'ADMIN' || u.role === 'SUPER_ADMIN')) ||
            (currentUser?.role === 'ADMIN' && u.role === 'USER')) &&
        (u.name?.toLowerCase().includes(searchUser.toLowerCase()) ||
            u.username?.toLowerCase().includes(searchUser.toLowerCase()))
    );

    // Get all assigned customers by OTHER admins/users to prevent duplicate assignment
    const assignedToOthers = new Set(
        users.filter(u => u.id !== selectedUser?.id).flatMap(u => u.assigned_customer_ids || [])
    );

    const filteredCustomers = allCustomers.filter(c =>
        !c.is_inactive &&
        !c.is_kabarka &&
        !assignedToOthers.has(c.id) &&
        !c.is_unassignable &&
        (c.name?.toLowerCase().includes(searchCustomer.toLowerCase()) ||
            c.customer_code?.toLowerCase().includes(searchCustomer.toLowerCase()))
    );

    if (currentUser?.role !== 'SUPER_ADMIN' && currentUser?.role !== 'ADMIN') {
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

    const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
    const isAdmin = currentUser?.role === 'ADMIN';
    const isAnyAdmin = isSuperAdmin || isAdmin;

    return (
        <div className="space-y-4 max-w-4xl mx-auto w-full pb-24" suppressHydrationWarning>
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
                onOpenChange={(open) => {
                    if (!open) setPendingSecurityAction(null);
                }}
                onConfirm={() => {
                    if (pendingSecurityAction?.type === 'clear_history') executeClearLedgerHistory();
                    if (pendingSecurityAction?.type === 'delete_user') executeDeleteUser();
                }}
                title={pendingSecurityAction?.type === 'clear_history' ? 'Clear History' : 'Delete User'}
                description={
                    pendingSecurityAction?.type === 'clear_history'
                        ? 'Permanently clear all ledger history?'
                        : `Permanently delete user "${pendingSecurityAction?.type === 'delete_user' ? pendingSecurityAction.username : ''}"?`
                }
                isProcessing={isClearingHistory}
            />

            {/* Header */}
            <div className="relative px-4 py-3 md:px-5 md:py-4 rounded-2xl bg-card border border-border shadow-sm overflow-hidden mb-2">
                <AnimatedBackground />
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-blue-500/5 pointer-events-none" />
                <h1 className="relative z-10 text-xl md:text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
                    <Settings className="w-5 h-5 text-primary shrink-0" />
                    Settings
                </h1>
            </div>

            {/* Tabs - Compact pill style */}
            <div className="px-1">
                <Tabs value={activeTab || (isSuperAdmin ? "business" : "appearance")} onValueChange={handleTabChange} className="w-full">
                    <TabsList className="bg-muted/60 backdrop-blur-sm border border-border/40 p-1 rounded-2xl w-full flex gap-0.5 h-auto">
                        {isSuperAdmin && (
                            <TabsTrigger
                                value="business"
                                className="flex-1 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-md rounded-xl text-[11px] font-bold py-2.5 px-1 gap-1.5 transition-all"
                            >
                                <DollarSign className="w-3.5 h-3.5 text-emerald-500" />
                                <span className="hidden xs:inline">Price</span>
                                <span className="xs:hidden">💲</span>
                            </TabsTrigger>
                        )}
                        {isSuperAdmin && (
                            <TabsTrigger
                                value="users"
                                className="flex-1 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-md rounded-xl text-[11px] font-bold py-2.5 px-1 gap-1.5 transition-all"
                            >
                                <Users className="w-3.5 h-3.5 text-blue-500" />
                                Users
                            </TabsTrigger>
                        )}
                        <TabsTrigger
                            value="appearance"
                            className="flex-1 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-md rounded-xl text-[11px] font-bold py-2.5 px-1 gap-1.5 transition-all"
                        >
                            <Palette className="w-3.5 h-3.5 text-violet-500" />
                            Theme
                        </TabsTrigger>
                        {isSuperAdmin && (
                            <TabsTrigger
                                value="backup"
                                className="flex-1 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-md rounded-xl text-[11px] font-bold py-2.5 px-1 gap-1.5 transition-all"
                            >
                                <HardDrive className="w-3.5 h-3.5 text-amber-500" />
                                <span className="hidden xs:inline">Backup</span>
                                <span className="xs:hidden">💾</span>
                            </TabsTrigger>
                        )}
                        {isSuperAdmin && (
                            <TabsTrigger
                                value="trash"
                                className="flex-1 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-md rounded-xl text-[11px] font-bold py-2.5 px-1 gap-1.5 transition-all"
                            >
                                <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                <span className="hidden xs:inline">Trash</span>
                                <span className="xs:hidden">🗑️</span>
                            </TabsTrigger>
                        )}
                        {isSuperAdmin && (
                            <TabsTrigger
                                value="audit"
                                className="flex-1 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-md rounded-xl text-[11px] font-bold py-2.5 px-1 gap-1.5 transition-all"
                            >
                                <Activity className="w-3.5 h-3.5 text-red-500" />
                                <span className="hidden xs:inline">Audit</span>
                                <span className="xs:hidden">🔍</span>
                            </TabsTrigger>
                        )}
                    </TabsList>

                    {/* ── Business Settings ── */}
                    {isSuperAdmin && (
                        <TabsContent value="business" className="mt-3">
                            <>
                                <div className="rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm">
                                    <div className="relative overflow-hidden px-4 py-3 border-b border-border/40 bg-gradient-to-r from-emerald-500/5 to-transparent">
                                        <AnimatedBackground />
                                        <div className="flex items-center gap-2.5 relative z-10">
                                            <div className="p-1.5 rounded-lg bg-emerald-500/15">
                                                <DollarSign className="w-4 h-4 text-emerald-500" />
                                            </div>
                                            <div>
                                                <h3 className="text-sm font-bold text-foreground">Default Price</h3>
                                                <p className="text-[10px] text-muted-foreground">Price per KG for ledger calculations</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="p-3 flex items-center gap-2.5">
                                        <div className="relative flex-1">
                                            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-500 font-black text-sm">$</div>
                                            <Input
                                                type="number"
                                                value={pricePerKg}
                                                onChange={(e) => setPricePerKg(e.target.value)}
                                                className="pl-7 h-11 text-xl font-black bg-background/50 border-border/60 rounded-xl text-center"
                                                step="1"
                                            />
                                        </div>
                                        <Button
                                            onClick={handleSavePrice}
                                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-11 rounded-xl shadow-md shadow-emerald-600/15 active:scale-95 transition-all px-5 shrink-0"
                                        >
                                            <Save className="w-4 h-4 mr-1.5" />
                                            Save
                                        </Button>
                                    </div>
                                </div>
                                
                                {/* ── Date-Specific Pricing ── */}
                                <div className="mt-3 rounded-2xl border border-black/5 dark:border-white/10 bg-background/30 backdrop-blur-xl overflow-hidden shadow-xl dark:shadow-2xl">
                                    <div 
                                        className="relative overflow-hidden px-4 py-3 border-b border-black/5 dark:border-white/5 bg-gradient-to-r from-blue-500/10 to-transparent cursor-pointer hover:bg-blue-500/20 transition-colors flex items-center justify-between"
                                        onClick={() => setIsDatePricingOpen(!isDatePricingOpen)}
                                    >
                                        <AnimatedBackground />
                                        <div className="flex items-center gap-2.5 relative z-10">
                                            <div className="p-1.5 rounded-lg bg-blue-500/15">
                                                <CalendarIcon className="w-4 h-4 text-blue-500" />
                                            </div>
                                            <div>
                                                <h3 className="text-sm font-bold text-foreground">Date-Specific Pricing</h3>
                                                <p className="text-[10px] text-muted-foreground font-semibold">
                                                    📌 {allowedDates[3]} & {allowedDates[2]} (Old) · ⚡ {allowedDates[1]} & {allowedDates[0]} (New)
                                                </p>
                                            </div>
                                        </div>
                                        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 relative z-10 ${isDatePricingOpen ? 'rotate-180' : ''}`} />
                                    </div>
                                    
                                    {isDatePricingOpen && (
                                        <div className="p-3 bg-transparent">
                                            <div className="flex gap-2 mb-3">
                                                <select 
                                                    value={newDatePrice.date} 
                                                    onChange={e => setNewDatePrice({ ...newDatePrice, date: e.target.value })}
                                                    className="flex h-10 w-full items-center justify-between rounded-xl border border-border/60 bg-background/50 px-3 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    <optgroup label="⚡ New Pair (Current)">
                                                        <option value={allowedDates[0]}>{allowedDates[0]} (Day 2)</option>
                                                        <option value={allowedDates[1]}>{allowedDates[1]} (Day 1)</option>
                                                    </optgroup>
                                                    <optgroup label="📌 Old Pair (Previous)">
                                                        <option value={allowedDates[2]}>{allowedDates[2]} (Day 2)</option>
                                                        <option value={allowedDates[3]}>{allowedDates[3]} (Day 1)</option>
                                                    </optgroup>
                                                </select>
                                                <div className="relative w-24">
                                                    <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground font-black text-xs">$</div>
                                                    <Input 
                                                        type="number" 
                                                        value={newDatePrice.price} 
                                                        onChange={e => setNewDatePrice({ ...newDatePrice, price: e.target.value })}
                                                        placeholder="Price"
                                                        className="pl-6 h-10 text-xs font-bold bg-background/50 border-border/60 rounded-xl"
                                                    />
                                                </div>
                                                <Button 
                                                    onClick={handleAddDatePrice}
                                                    disabled={dateActionLoading !== null}
                                                    className="h-10 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-md active:scale-95 transition-all shrink-0"
                                                >
                                                    {dateActionLoading === 'add' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                                                </Button>
                                            </div>

                                            {Object.entries(dateSpecificPrices).filter(([date]) => allowedDates.includes(date)).length > 0 ? (
                                                <div className="space-y-1.5">
                                                    {Object.entries(dateSpecificPrices).filter(([date]) => allowedDates.includes(date)).sort((a, b) => b[0].localeCompare(a[0])).map(([date, price]) => (
                                                        <div key={date} className="flex items-center justify-between p-2 rounded-xl bg-background border border-border/40 hover:border-blue-500/30 transition-colors">
                                                            <div className="flex items-center gap-3">
                                                                <span className="text-xs font-bold text-foreground bg-muted px-2 py-1 rounded-md">{date}</span>
                                                                <span className="text-xs font-black text-emerald-500">${price}</span>
                                                            </div>
                                                            <Button 
                                                                variant="ghost" 
                                                                size="sm"
                                                                onClick={() => handleRemoveDatePrice(date)}
                                                                disabled={dateActionLoading !== null}
                                                                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg"
                                                            >
                                                                {dateActionLoading === `delete-${date}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                                            </Button>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="text-center py-4 text-xs text-muted-foreground border border-dashed border-border/60 rounded-xl">
                                                    No date-specific prices set.
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* ── Customer-Specific Date Pricing ── */}
                                <div className="mt-3 rounded-2xl border border-white/20 dark:border-white/10 bg-white/[0.04] dark:bg-black/[0.18] backdrop-blur-2xl backdrop-saturate-150 shadow-xl overflow-hidden">
                                    <div 
                                        className="relative overflow-hidden px-4 py-3 border-b border-white/15 dark:border-white/10 bg-gradient-to-r from-teal-500/[0.08] via-transparent to-transparent cursor-pointer hover:bg-white/[0.06] dark:hover:bg-white/[0.04] transition-all flex items-center justify-between"
                                        onClick={() => setIsOverridesOpen(!isOverridesOpen)}
                                    >
                                        <AnimatedBackground />
                                        <div className="flex items-center gap-2.5 relative z-10">
                                            <div className="p-1.5 rounded-lg bg-teal-500/15 border border-teal-500/20 text-teal-600 dark:text-teal-400">
                                                <Users className="w-4 h-4" />
                                            </div>
                                            <div>
                                                <h3 className="text-sm font-bold text-foreground">Customer-Specific Pricing</h3>
                                                <p className="text-[10px] text-muted-foreground font-semibold">
                                                    VIP Pricing Overrides per Customer
                                                </p>
                                            </div>
                                        </div>
                                        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 relative z-10 ${isOverridesOpen ? 'rotate-180' : ''}`} />
                                    </div>
                                    
                                    {isOverridesOpen && (
                                        <div className="p-3 bg-transparent">
                                            <div className="flex flex-col sm:flex-row gap-2 mb-3">
                                                <select 
                                                    value={newOverride.date} 
                                                    onChange={e => {
                                                        setNewOverride({ ...newOverride, date: e.target.value });
                                                        setTypeFilter(null); // reset type filter when date changes
                                                    }}
                                                    className="flex h-10 w-full sm:w-1/3 items-center justify-between rounded-xl border border-white/20 dark:border-white/10 bg-white/[0.06] dark:bg-black/30 backdrop-blur-xl px-3 py-2 text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-teal-500/40 shadow-xs"
                                                >
                                                    {savedBookDates && Array.isArray(savedBookDates) && savedBookDates.length > 0 ? (
                                                        <optgroup label="📅 Saved Daily Books">
                                                            {savedBookDates.slice(0, 8).map((b: { date: string }) => {
                                                                const d = b.date.split('T')[0];
                                                                return <option key={d} value={d}>{d}</option>;
                                                            })}
                                                        </optgroup>
                                                    ) : (
                                                        <>
                                                            <optgroup label="⚡ New Pair (Current)">
                                                                <option value={allowedDates[0]}>{allowedDates[0]} (Day 2)</option>
                                                                <option value={allowedDates[1]}>{allowedDates[1]} (Day 1)</option>
                                                            </optgroup>
                                                            <optgroup label="📌 Old Pair (Previous)">
                                                                <option value={allowedDates[2]}>{allowedDates[2]} (Day 2)</option>
                                                                <option value={allowedDates[3]}>{allowedDates[3]} (Day 1)</option>
                                                            </optgroup>
                                                        </>
                                                    )}
                                                </select>

                                                <div className="relative w-full sm:w-1/2 flex gap-1 items-center">
                                                    <div className="relative flex-1">
                                                        <div 
                                                            className="flex h-10 w-full items-center justify-between rounded-xl border border-white/20 dark:border-white/10 bg-white/[0.06] dark:bg-black/30 backdrop-blur-xl px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-white/[0.1] transition-all cursor-pointer shadow-xs"
                                                            onClick={() => setIsCustomerSelectOpen(!isCustomerSelectOpen)}
                                                        >
                                                            {newOverride.customerIds.length === 0 
                                                                ? 'Select Customers...' 
                                                                : `${newOverride.customerIds.length} customer${newOverride.customerIds.length > 1 ? 's' : ''} selected`}
                                                            <ChevronDown className="w-4 h-4 opacity-50" />
                                                        </div>
                                                        
                                                        {isCustomerSelectOpen && (
                                                            <div className="absolute top-full left-0 mt-1.5 w-full bg-background/80 dark:bg-black/80 border border-white/20 dark:border-white/10 rounded-2xl shadow-2xl backdrop-blur-2xl backdrop-saturate-150 z-50 max-h-60 overflow-y-auto p-2 space-y-1">
                                                                <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase border-b border-white/10 flex justify-between items-center">
                                                                    <span>Daily Book ({newOverride.date})</span>
                                                                    <span>{availableCustomersForSelectedDate.length} available</span>
                                                                </div>
                                                                {availableCustomersForSelectedDate.map(c => (
                                                                    <label key={c.id} className="flex items-center gap-2 p-2 hover:bg-white/10 dark:hover:bg-white/10 rounded-lg cursor-pointer transition-colors text-foreground">
                                                                        <input 
                                                                            type="checkbox" 
                                                                            className="rounded border-white/30 text-teal-600 focus:ring-teal-500 w-4 h-4 bg-white/10"
                                                                            checked={newOverride.customerIds.includes(c.id)}
                                                                            onChange={(e) => {
                                                                                if (e.target.checked) {
                                                                                    setNewOverride({ ...newOverride, customerIds: [...newOverride.customerIds, c.id] });
                                                                                } else {
                                                                                    setNewOverride({ ...newOverride, customerIds: newOverride.customerIds.filter(id => id !== c.id) });
                                                                                }
                                                                            }}
                                                                        />
                                                                        <div className="flex items-center justify-between flex-1 min-w-0">
                                                                            <span className="text-xs font-medium truncate">#{c.customer_code} - {c.name}</span>
                                                                            {c.actualKg !== undefined && c.actualKg > 0 && (
                                                                                <span className="text-[10px] font-bold text-muted-foreground ml-2 shrink-0">{c.actualKg} KG</span>
                                                                            )}
                                                                        </div>
                                                                    </label>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                    
                                                    {/* Glassmorphism Dynamic Type Dropdown */}
                                                    <div className="relative shrink-0">
                                                        <div 
                                                            className={cn(
                                                                "flex h-10 items-center justify-between gap-1.5 rounded-xl border px-3 text-xs font-semibold cursor-pointer transition-all select-none shadow-xs min-w-[105px] backdrop-blur-xl",
                                                                typeFilter 
                                                                    ? "text-teal-600 dark:text-teal-400 border-teal-500/30 bg-teal-500/10 shadow-teal-500/5" 
                                                                    : "text-foreground border-white/20 dark:border-white/10 bg-white/[0.06] dark:bg-black/30 hover:bg-white/[0.12]"
                                                            )}
                                                            onClick={() => setIsTypeDropdownOpen(!isTypeDropdownOpen)}
                                                        >
                                                            <span className="truncate max-w-[85px]">{typeFilter ? typeFilter : 'Type'}</span>
                                                            <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-200 opacity-60 shrink-0", isTypeDropdownOpen ? "rotate-180" : "")} />
                                                        </div>

                                                        {isTypeDropdownOpen && (
                                                            <div className="absolute top-full right-0 mt-1.5 w-48 bg-background/60 dark:bg-black/60 border border-white/25 dark:border-white/15 rounded-2xl shadow-2xl z-50 p-1.5 space-y-0.5 animate-in fade-in zoom-in-95 duration-150 backdrop-blur-2xl backdrop-saturate-150">
                                                                {typeFilter && (
                                                                    <div 
                                                                        className="flex items-center justify-between px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-white/10 dark:hover:bg-white/10 rounded-xl cursor-pointer transition-colors font-medium border-b border-white/10 mb-1 pb-1"
                                                                        onClick={() => {
                                                                            setTypeFilter(null);
                                                                            setIsTypeDropdownOpen(false);
                                                                        }}
                                                                    >
                                                                        <span>Clear Filter</span>
                                                                        <span className="text-[10px] opacity-60">✕</span>
                                                                    </div>
                                                                )}
                                                                {availableTypes.length === 0 ? (
                                                                    <div className="text-[11px] text-muted-foreground p-2.5 text-center">
                                                                        No customer labels found
                                                                    </div>
                                                                ) : (
                                                                    availableTypes.map((type) => {
                                                                        const isSelected = typeFilter?.toLowerCase() === type.toLowerCase();
                                                                        return (
                                                                            <div
                                                                                key={type}
                                                                                className={cn(
                                                                                    "flex items-center justify-between px-2.5 py-1.5 text-xs rounded-xl cursor-pointer transition-all duration-150 font-medium",
                                                                                    isSelected 
                                                                                        ? "bg-teal-500/15 text-teal-600 dark:text-teal-400 font-bold border border-teal-500/25" 
                                                                                        : "hover:bg-white/10 dark:hover:bg-white/10 text-foreground"
                                                                                )}
                                                                                onClick={() => {
                                                                                    setTypeFilter(isSelected ? null : type);
                                                                                    setIsTypeDropdownOpen(false);
                                                                                }}
                                                                            >
                                                                                <span>{type}</span>
                                                                                {isSelected && <span className="text-teal-500 text-xs font-black">✓</span>}
                                                                            </div>
                                                                        );
                                                                    })
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="relative w-full sm:w-24 shrink-0">
                                                    <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground font-black text-xs">$</div>
                                                    <Input 
                                                        type="number" 
                                                        value={newOverride.price} 
                                                        onChange={e => setNewOverride({ ...newOverride, price: e.target.value })}
                                                        placeholder="Price"
                                                        className="pl-6 h-10 w-full text-xs font-bold bg-white/[0.06] dark:bg-black/30 border-white/20 dark:border-white/10 backdrop-blur-xl rounded-xl focus:border-teal-500/50 focus:ring-teal-500/20"
                                                    />
                                                </div>
                                                <Button 
                                                    onClick={handleAddOverride}
                                                    disabled={dateActionLoading !== null}
                                                    className="h-10 px-3.5 rounded-xl bg-teal-600/90 hover:bg-teal-600 dark:bg-teal-500/80 dark:hover:bg-teal-500 text-white shadow-md shadow-teal-500/15 active:scale-95 transition-all shrink-0 border border-teal-400/30"
                                                    title="Add Date Price Override"
                                                >
                                                    {dateActionLoading === 'add-override' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                                                </Button>
                                                <Button 
                                                    type="button"
                                                    onClick={handleAddVipCaadiGroup}
                                                    disabled={dateActionLoading !== null || newOverride.customerIds.length === 0}
                                                    title="Add selected customers to VIP Caadi"
                                                    className="h-10 px-2.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 font-bold text-xs border border-amber-500/30 active:scale-95 transition-all shrink-0 flex items-center gap-1 shadow-xs"
                                                >
                                                    {dateActionLoading === 'add-vip-caadi' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-amber-500" />}
                                                    <span>+ Add VIP</span>
                                                </Button>
                                            </div>

                                            {/* ── VIP Caadi Categories Section ── */}
                                            {vipCaadiConfig.length > 0 && (
                                                <div className="mb-4 space-y-2.5">
                                                    <div className="flex items-center justify-between px-1">
                                                        <span className="text-[11px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                                                            <Sparkles className="w-3.5 h-3.5" /> VIP Caadi Categories ({vipCaadiConfig.length})
                                                        </span>
                                                    </div>
                                                    <div className="space-y-2.5">
                                                        {vipCaadiConfig.map((cat) => {
                                                            const isExpanded = expandedVipCaadiCategories.includes(cat.id);
                                                            const catDate = cat.date ? cat.date.substring(0, 10) : undefined;
                                                            const catCustomers = cat.customerIds.map(custId => {
                                                                const cust = allCustomers.find(c => c.id === custId)
                                                                    || availableCustomersForSelectedDate.find(c => c.id === custId);
                                                                const stats = dailyBookCustomerStatsMap.get(custId) || { actualKg: 0, vipQaaliKg: 0, maxCaadiKg: 0 };
                                                                // Use saved KG if present, otherwise default to maxCaadiKg (backward compat)
                                                                const savedKg = cat.customerKgs?.[custId];
                                                                const assignedCaadiKg = savedKg !== undefined
                                                                    ? Math.min(savedKg, stats.maxCaadiKg)
                                                                    : stats.maxCaadiKg;
                                                                return {
                                                                    id: custId,
                                                                    name: cust?.name || 'Unknown',
                                                                    code: cust?.customer_code || '?',
                                                                    actualKg: stats.actualKg,
                                                                    vipQaaliKg: stats.vipQaaliKg,
                                                                    maxCaadiKg: stats.maxCaadiKg,
                                                                    assignedCaadiKg,
                                                                    // Current input value (in-flight edit)
                                                                    inputKg: cat.customerKgs?.[custId] ?? stats.maxCaadiKg,
                                                                    price: cat.customerPrices?.[custId] ?? ''
                                                                };
                                                            });
                                                            // Category Total KG = SUM of assigned VIP Caadi KG (not Daily Book KG!)
                                                            const totalCategoryKg = catCustomers.reduce((sum, c) => sum + c.assignedCaadiKg, 0);

                                                            return (
                                                                <div 
                                                                    key={cat.id} 
                                                                    className="overflow-hidden rounded-2xl border border-amber-500/25 dark:border-amber-500/20 bg-amber-500/[0.04] dark:bg-amber-950/[0.15] backdrop-blur-xl shadow-sm transition-all"
                                                                >
                                                                    {/* Header — Clickable to Expand/Collapse */}
                                                                    <div 
                                                                        onClick={() => toggleVipCaadiCategoryExpand(cat.id)}
                                                                        className="p-3 flex flex-wrap items-center justify-between gap-2 cursor-pointer hover:bg-white/[0.04] dark:hover:bg-white/[0.02] transition-colors select-none"
                                                                    >
                                                                        <div className="flex items-center gap-2 flex-wrap">
                                                                            <span className="text-xs font-black uppercase text-amber-700 dark:text-amber-400 flex items-center gap-1">
                                                                                ⭐ {cat.label || 'VIP Caadi'}
                                                                            </span>
                                                                            {catDate && (
                                                                                <span className="text-[10px] font-bold text-muted-foreground bg-white/10 dark:bg-white/5 border border-white/10 px-2 py-0.5 rounded-md">
                                                                                    📅 {catDate}
                                                                                </span>
                                                                            )}
                                                                            <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                                                                                {cat.customerIds.length} customer{cat.customerIds.length > 1 ? 's' : ''}
                                                                                {totalCategoryKg > 0 ? ` · ${totalCategoryKg.toFixed(1)} KG` : ''}
                                                                            </span>
                                                                        </div>

                                                                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                                                            <Input
                                                                                value={cat.label}
                                                                                onChange={(e) => handleUpdateVipCaadiLabel(cat.id, e.target.value)}
                                                                                placeholder="Label"
                                                                                className="h-7 w-28 text-[11px] font-bold uppercase text-amber-700 dark:text-amber-400 bg-white/20 dark:bg-black/30 border-amber-500/30 rounded-lg px-2 shadow-xs focus:ring-1 focus:ring-amber-500"
                                                                                title="Rename category label"
                                                                            />
                                                                            <Button
                                                                                size="sm"
                                                                                variant="outline"
                                                                                onClick={() => handleSaveVipCaadiLabel(cat.id)}
                                                                                disabled={dateActionLoading !== null}
                                                                                className="h-7 px-2 text-[10px] font-bold border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 rounded-lg"
                                                                            >
                                                                                {dateActionLoading === `save-label-${cat.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
                                                                            </Button>
                                                                            <Button
                                                                                size="sm"
                                                                                variant="ghost"
                                                                                onClick={() => handleDeleteVipCaadiCategory(cat.id)}
                                                                                disabled={dateActionLoading !== null}
                                                                                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg"
                                                                                title="Delete Category"
                                                                            >
                                                                                {dateActionLoading === `delete-cat-${cat.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                                                            </Button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => toggleVipCaadiCategoryExpand(cat.id)}
                                                                                className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/10 transition-transform"
                                                                                title={isExpanded ? 'Collapse' : 'Expand'}
                                                                            >
                                                                                <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                                                                            </button>
                                                                        </div>
                                                                    </div>

                                                                    {/* Customer Items inside this category (only shown when expanded) */}
                                                                    {isExpanded && (
                                                                        <div className="p-3 border-t border-amber-500/15 bg-black/[0.02] dark:bg-black/20 space-y-2 animate-in slide-in-from-top-1 duration-150">
                                                                            {cat.customerIds.length === 0 ? (
                                                                                <div className="text-[11px] text-muted-foreground text-center py-3">No customers assigned.</div>
                                                                            ) : (
                                                                                <div className="space-y-1.5 max-h-72 overflow-y-auto pr-0.5 custom-scrollbar">
                                                                                    {catCustomers.map(cust => (
                                                                                        <div 
                                                                                            key={cust.id} 
                                                                                            className="flex flex-col gap-1.5 p-2.5 rounded-xl bg-white/[0.05] dark:bg-black/30 border border-amber-500/10 hover:border-amber-500/25 transition-colors"
                                                                                        >
                                                                                            {/* Row 1: Customer name & code */}
                                                                                            <div className="flex items-center justify-between gap-2">
                                                                                                <div className="flex items-center gap-1.5 min-w-0">
                                                                                                    <span className="text-[9px] font-bold text-muted-foreground/80 bg-white/10 dark:bg-white/5 px-1 py-0.5 rounded shrink-0">
                                                                                                        #{cust.code}
                                                                                                    </span>
                                                                                                    <span className="text-[11px] font-semibold text-foreground truncate" title={cust.name}>
                                                                                                        {cust.name}
                                                                                                    </span>
                                                                                                </div>
                                                                                                <button
                                                                                                    type="button"
                                                                                                    onClick={() => handleRemoveVipCaadiCustomer(cat.id, cust.id)}
                                                                                                    className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                                                                                                    title="Remove Customer"
                                                                                                >
                                                                                                    <X className="w-3 h-3" />
                                                                                                </button>
                                                                                            </div>
                                                                                            {/* Row 2: KG stats + editable VIP Caadi KG + Price */}
                                                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                                                {cust.actualKg > 0 && (
                                                                                                    <span className="text-[9px] font-medium text-muted-foreground bg-white/10 px-1.5 py-0.5 rounded shrink-0">
                                                                                                        Book: {cust.actualKg} KG
                                                                                                    </span>
                                                                                                )}
                                                                                                {cust.vipQaaliKg > 0 && (
                                                                                                    <span className="text-[9px] font-medium text-purple-500 bg-purple-500/10 px-1.5 py-0.5 rounded shrink-0">
                                                                                                        VIP Qaali: {cust.vipQaaliKg} KG
                                                                                                    </span>
                                                                                                )}
                                                                                                <span className="text-[9px] font-medium text-amber-600/70 shrink-0">
                                                                                                    Max: {cust.maxCaadiKg} KG
                                                                                                </span>
                                                                                                {/* Editable VIP Caadi KG */}
                                                                                                <div className="flex items-center gap-1 ml-auto">
                                                                                                    <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400 shrink-0">VIP KG:</span>
                                                                                                    <Input
                                                                                                        type="number"
                                                                                                        min={0}
                                                                                                        max={cust.maxCaadiKg}
                                                                                                        step={0.5}
                                                                                                        value={cust.inputKg}
                                                                                                        onChange={(e) => handleUpdateVipCaadiCustomerKg(cat.id, cust.id, e.target.value)}
                                                                                                        onBlur={() => handleSaveVipCaadiCustomerKg(cat.id, cust.id)}
                                                                                                        className="h-6 w-16 text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-500/10 border-amber-500/30 rounded focus:border-amber-500/60 focus:ring-0 text-center px-1"
                                                                                                        title={`VIP Caadi KG (max ${cust.maxCaadiKg})`}
                                                                                                    />
                                                                                                    {/* Price */}
                                                                                                    <div className="relative w-16">
                                                                                                        <div className="absolute left-1 top-1/2 -translate-y-1/2 text-muted-foreground font-bold text-[9px]">$</div>
                                                                                                        <Input
                                                                                                            type="number"
                                                                                                            value={cust.price}
                                                                                                            onChange={(e) => handleUpdateVipCaadiCustomerPrice(cat.id, cust.id, e.target.value)}
                                                                                                            onBlur={() => handleSaveVipCaadiConfig(vipCaadiConfig, `save-price-${cat.id}-${cust.id}`)}
                                                                                                            placeholder="Price"
                                                                                                            className="pl-3.5 h-6 w-full text-[10px] font-bold bg-white/20 dark:bg-black/40 border-amber-500/20 rounded focus:border-amber-500/50 focus:ring-0"
                                                                                                        />
                                                                                                    </div>
                                                                                                </div>
                                                                                            </div>
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Type Filter Panel — universal glass, works for VIP/Heshiish/Jaadkidambe/any label */}
                                            {typeFilter && (
                                                <div className="mb-4 overflow-hidden rounded-2xl border border-white/20 dark:border-white/[0.10] bg-white/[0.07] dark:bg-black/75 backdrop-blur-2xl backdrop-saturate-150 shadow-2xl dark:shadow-black/60 animate-in fade-in slide-in-from-top-2">
                                                    {/* subtle top highlight — mirror-glass feel */}
                                                    <div className="h-px w-full bg-gradient-to-r from-transparent via-white/40 dark:via-white/20 to-transparent" />

                                                    <div className="p-3">
                                                        {/* ── Header: type name + stats + batch controls ── */}
                                                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5 pb-2.5 border-b border-white/10 dark:border-white/[0.07]">
                                                            {/* left: title + stats */}
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <span className="text-[11px] font-black tracking-widest uppercase text-teal-600 dark:text-teal-400">
                                                                    {typeFilter}
                                                                </span>
                                                                {isDailyBookLoading && <Loader2 className="w-3 h-3 animate-spin text-teal-500 shrink-0" />}
                                                                <span className="text-[10px] text-muted-foreground font-semibold">
                                                                    {filteredTypeCustomers.length} customers
                                                                </span>
                                                                <span className="text-[10px] text-muted-foreground opacity-40">·</span>
                                                                <span className="text-[10px] font-black text-teal-600 dark:text-teal-400">
                                                                    {totalTypeKg} KG
                                                                </span>
                                                                <span className="text-[10px] text-muted-foreground opacity-40">·</span>
                                                                <span className="text-[10px] text-muted-foreground">{newOverride.date}</span>
                                                            </div>

                                                            {/* right: batch price + Apply to All + Clear All */}
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                <div className="relative w-[80px]">
                                                                    <div className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground font-black text-[10px]">$</div>
                                                                    <Input
                                                                        type="number"
                                                                        value={typePrice}
                                                                        onChange={e => setTypePrice(e.target.value)}
                                                                        placeholder="Price"
                                                                        className="pl-5 h-7 w-full text-xs font-bold bg-white/[0.08] dark:bg-black/40 border-white/20 dark:border-white/[0.10] backdrop-blur-md rounded-lg focus:border-teal-500/50 focus:ring-0"
                                                                    />
                                                                </div>
                                                                <Button
                                                                    size="sm"
                                                                    onClick={handleTypeApply}
                                                                    disabled={dateActionLoading !== null || !typePrice}
                                                                    className="h-7 px-2.5 rounded-lg bg-teal-600/90 hover:bg-teal-600 dark:bg-teal-500/80 dark:hover:bg-teal-500 text-white font-bold text-[11px] border border-teal-400/20 active:scale-95 transition-all"
                                                                >
                                                                    {dateActionLoading === 'type-apply' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Apply All'}
                                                                </Button>
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    onClick={handleTypeClearAll}
                                                                    disabled={dateActionLoading !== null || filteredTypeCustomers.every((c: any) => !c.basePrice)}
                                                                    className="h-7 px-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.06] dark:bg-rose-500/[0.04] text-rose-600 dark:text-rose-400 hover:bg-rose-500/15 font-bold text-[11px] active:scale-95 transition-all"
                                                                >
                                                                    {dateActionLoading === 'type-clear-all' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Clear All'}
                                                                </Button>
                                                            </div>
                                                        </div>

                                                        {/* ── Customer List ── */}
                                                        <div className="max-h-72 overflow-y-auto space-y-px pr-0.5">
                                                            {filteredTypeCustomers.length === 0 ? (
                                                                <div className="py-5 text-center text-[11px] text-muted-foreground">
                                                                    {isDailyBookLoading ? 'Loading…' : `No ${typeFilter} customers on ${newOverride.date}.`}
                                                                </div>
                                                            ) : (
                                                                filteredTypeCustomers.map((c: any, idx: number) => {
                                                                    const currentPriceInput = individualTypePrices[c.customer_id] ?? '';
                                                                    return (
                                                                        <div
                                                                            key={c.customer_id}
                                                                            className="group flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 py-1.5 px-2 rounded-xl hover:bg-white/[0.07] dark:hover:bg-white/[0.04] transition-colors"
                                                                        >
                                                                            {/* Left: index + name + code + kg */}
                                                                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                                                                <span className="w-5 shrink-0 text-[9px] font-mono text-muted-foreground/60 text-right">
                                                                                    {idx + 1}
                                                                                </span>
                                                                                <span className="text-[11px] font-semibold text-foreground truncate leading-none">
                                                                                    {c.customer?.name}
                                                                                </span>
                                                                                <span className="shrink-0 text-[9px] font-bold text-muted-foreground/70 bg-white/10 dark:bg-white/[0.06] px-1 py-px rounded">
                                                                                    #{c.customer?.customer_code}
                                                                                </span>
                                                                                <span className="shrink-0 text-[10px] font-black text-teal-600 dark:text-teal-400">
                                                                                    {c.matchingKg} KG
                                                                                </span>
                                                                                {c.basePrice && (
                                                                                    <span className="shrink-0 text-[9px] font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/15 px-1 py-px rounded">
                                                                                        ${c.basePrice}
                                                                                    </span>
                                                                                )}
                                                                            </div>

                                                                            {/* Right: price input + apply + clear */}
                                                                            <div className="flex items-center gap-1 shrink-0 self-end sm:self-auto">
                                                                                <div className="relative w-[72px]">
                                                                                    <div className="absolute left-1.5 top-1/2 -translate-y-1/2 text-muted-foreground font-bold text-[10px]">$</div>
                                                                                    <Input
                                                                                        type="number"
                                                                                        value={currentPriceInput}
                                                                                        onChange={e => setIndividualTypePrices(prev => ({ ...prev, [c.customer_id]: e.target.value }))}
                                                                                        placeholder={c.basePrice || '—'}
                                                                                        className="pl-4 h-6 w-full text-[11px] font-bold bg-white/[0.06] dark:bg-black/40 border-white/15 dark:border-white/[0.08] backdrop-blur-md rounded focus:border-teal-500/50 focus:ring-0"
                                                                                    />
                                                                                </div>
                                                                                <Button
                                                                                    size="sm"
                                                                                    onClick={() => handleIndividualTypeApply(c.customer_id, currentPriceInput)}
                                                                                    disabled={dateActionLoading !== null || !currentPriceInput}
                                                                                    className="h-6 px-2 text-[10px] font-bold bg-teal-600/90 hover:bg-teal-600 dark:bg-teal-500/80 dark:hover:bg-teal-500 text-white rounded border border-teal-400/20 active:scale-95 transition-all"
                                                                                >
                                                                                    {dateActionLoading === `apply-type-${c.customer_id}` ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : 'Apply'}
                                                                                </Button>
                                                                                {c.basePrice && (
                                                                                    <Button
                                                                                        variant="ghost"
                                                                                        size="sm"
                                                                                        onClick={() => handleTypeClear(c.customer_id)}
                                                                                        disabled={dateActionLoading !== null}
                                                                                        className="h-6 px-1.5 text-[10px] font-bold text-rose-600 dark:text-rose-400 bg-rose-500/[0.06] hover:bg-rose-500/15 border border-rose-500/15 rounded transition-all"
                                                                                    >
                                                                                        {dateActionLoading === `clear-type-${c.customer_id}` ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : 'Clear'}
                                                                                    </Button>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {Object.entries(dateSpecificOverrides).filter(([date]) => allowedDates.includes(date)).length > 0 ? (
                                                <div className="space-y-3">
                                                    {Object.entries(dateSpecificOverrides).filter(([date]) => allowedDates.includes(date)).sort((a, b) => b[0].localeCompare(a[0])).map(([date, overrides]) => (
                                                        <div key={date} className="space-y-1.5">
                                                            <div 
                                                                className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.04] dark:bg-white/[0.02] hover:bg-white/[0.08] dark:hover:bg-white/[0.04] border border-white/15 dark:border-white/10 cursor-pointer transition-all backdrop-blur-md"
                                                                onClick={() => toggleOverrideDate(date)}
                                                            >
                                                                <div className="flex items-center gap-2">
                                                                    <div className="text-xs font-bold text-foreground">📅 {date}</div>
                                                                    <div className="text-[10px] font-semibold text-teal-600 dark:text-teal-400 bg-teal-500/10 border border-teal-500/20 px-2 py-0.5 rounded-full">
                                                                        {Object.keys(overrides).length} Customer{Object.keys(overrides).length > 1 ? 's' : ''}
                                                                    </div>
                                                                </div>
                                                                <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${expandedOverrideDates.includes(date) ? 'rotate-180' : ''}`} />
                                                            </div>
                                                            {expandedOverrideDates.includes(date) && (
                                                                <div className="space-y-1.5 pl-2 mt-2 border-l-2 border-teal-500/20">
                                                                    {Object.entries(overrides).map(([custId, price]) => {
                                                                        const cust = allCustomers.find(c => c.id === custId);
                                                                        return (
                                                                            <div key={custId} className="flex items-center justify-between p-2 rounded-xl bg-white/[0.03] dark:bg-white/[0.02] border border-white/10 hover:border-teal-500/30 backdrop-blur-md transition-colors">
                                                                                <div className="flex items-center gap-3">
                                                                                    <span className="text-xs font-bold text-foreground bg-white/10 dark:bg-white/5 border border-white/10 px-2 py-1 rounded-md">#{cust?.customer_code || '?'} {cust?.name || 'Unknown'}</span>
                                                                                    <span className="text-xs font-black text-teal-600 dark:text-teal-400">${price}</span>
                                                                                </div>
                                                                                <Button 
                                                                                    variant="ghost" 
                                                                                    size="sm"
                                                                                    onClick={() => handleRemoveOverride(date, custId)}
                                                                                    disabled={dateActionLoading !== null}
                                                                                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg"
                                                                                >
                                                                                    {dateActionLoading === `delete-override-${date}-${custId}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                                                                </Button>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="text-center py-4 text-xs text-muted-foreground border border-dashed border-white/15 dark:border-white/10 rounded-xl bg-white/[0.02]">
                                                    No customer-specific overrides set.
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* ── Re-sequence Customer IDs (Tiny Button) ── */}
                                <div className="mt-3 flex justify-end">
                                    <Button
                                        onClick={async () => {
                                            if (!window.confirm('Re-number all customers 1, 2, 3…? Ledger data is safe.')) return;
                                            setResequenceLoading(true);
                                            try {
                                                const token = localStorage.getItem('dadwork_session_token') || '';
                                                const res = await fetch('/api/resequence-customers', {
                                                    method: 'POST',
                                                    headers: { 'x-session-token': token }
                                                });
                                                const data = await res.json();
                                                if (res.ok) {
                                                    toast.success(`✅ ${data.message}`);
                                                    loadCustomers();
                                                } else {
                                                    toast.error(data.error || 'Failed to re-sequence');
                                                }
                                            } catch (e) {
                                                toast.error('Network error');
                                            } finally {
                                                setResequenceLoading(false);
                                            }
                                        }}
                                        disabled={resequenceLoading}
                                        variant="ghost"
                                        size="sm"
                                        className="text-[10px] h-7 px-2 text-violet-500 hover:text-violet-600 hover:bg-violet-500/10 transition-all font-bold"
                                    >
                                        {resequenceLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Zap className="w-3 h-3 mr-1" />}
                                        Fix IDs
                                    </Button>
                                </div>
                            </>
                        </TabsContent>
                    )}

                    {/* ── Users Management ── */}
                    {isSuperAdmin && (
                        <TabsContent value="users" className="mt-3">
                            <div className="space-y-3">
                                {/* Search + Add */}
                                <div className="flex gap-2 px-0.5">
                                    <div className="relative flex-1">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
                                        <Input
                                            placeholder="Search users..."
                                            value={searchUser}
                                            onChange={e => setSearchUser(e.target.value)}
                                            className="pl-9 bg-background/50 border-border/50 rounded-xl h-11 text-sm"
                                        />
                                    </div>
                                    {isSuperAdmin && (
                                        <Button
                                            onClick={handleOpenCreateDialog}
                                            className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-lg shadow-primary/20 shrink-0 h-11 rounded-xl px-3 active:scale-95 transition-all"
                                        >
                                            <UserPlus className="w-4 h-4 mr-1.5" />
                                            <span className="hidden sm:inline">Add User</span>
                                            <span className="sm:hidden">Add</span>
                                        </Button>
                                    )}
                                </div>

                                {/* User Cards */}
                                <div className="rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm">
                                    <div className="px-4 py-2.5 border-b border-border/40 bg-gradient-to-r from-blue-500/5 to-transparent flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Users className="w-4 h-4 text-blue-500" />
                                            <span className="text-xs font-bold text-foreground">Team Members</span>
                                            {maqalPairDates.date1 && maqalPairDates.date2 && (() => {
                                                const fmt = (d: string) => { const dt = new Date(d + 'T00:00:00Z'); return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }); };
                                                return (
                                                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full border bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400`}>
                                                        📌 {fmt(maqalPairDates.date1)} & {fmt(maqalPairDates.date2)}
                                                    </span>
                                                );
                                            })()}
                                        </div>
                                        <span className="text-[10px] font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                                            {filteredUsers.length}
                                        </span>
                                    </div>

                                    {usersLoading ? (
                                        <div className="flex flex-col items-center justify-center py-14 gap-3">
                                            <Loader2 className="w-7 h-7 animate-spin text-primary" />
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Loading...</p>
                                        </div>
                                    ) : filteredUsers.length === 0 ? (
                                        <div className="text-center py-14 px-6">
                                            <div className="w-14 h-14 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-3">
                                                <User className="w-7 h-7 text-muted-foreground/40" />
                                            </div>
                                            <p className="text-foreground font-bold text-sm">No Users Yet</p>
                                            <p className="text-muted-foreground text-xs mt-1 mb-4">Create user accounts for your team</p>
                                            {isSuperAdmin && (
                                                <Button onClick={handleOpenCreateDialog} size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-xl h-9 active:scale-95">
                                                    <Plus className="w-3.5 h-3.5 mr-1.5" /> Create User
                                                </Button>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="divide-y divide-border/30">
                                            {filteredUsers.map((user) => {
                                                const hasAvatar = !!user.avatar_url;
                                                const assignedCount = user.assigned_customer_ids?.filter(id => allCustomers.some(c => c.id === id)).length || 0;
                                                const isUserAdmin = user.role === 'ADMIN';

                                                return (
                                                    <div key={user.id} className="flex items-center gap-3 px-3 py-3 active:bg-muted/20 transition-colors">
                                                        {/* Avatar */}
                                                        <Avatar className="h-11 w-11 border border-border/60 bg-muted shrink-0 shadow-sm">
                                                            {hasAvatar ? (
                                                                <AvatarImage src={user.avatar_url} className="object-cover" />
                                                            ) : null}
                                                            <AvatarFallback className="text-sm font-black bg-primary/10 text-primary uppercase">
                                                                {user.gender === 'Female' ? '👩' : user.gender === 'Male' ? '👨' : user.name?.charAt(0) || '👤'}
                                                            </AvatarFallback>
                                                        </Avatar>

                                                        {/* Info */}
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-1.5">
                                                                <span className="font-black text-foreground text-xs uppercase truncate">{user.name}</span>
                                                                <span className={`shrink-0 px-1.5 py-0.5 rounded-md text-[8px] font-black tracking-wider uppercase ${isUserAdmin ? 'bg-amber-500/15 text-amber-500 border border-amber-500/30' : 'bg-blue-500/15 text-blue-500 border border-blue-500/30'}`}>
                                                                    {user.role}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-2 mt-0.5">
                                                                <span className="text-[10px] font-bold text-muted-foreground">@{user.username}</span>
                                                                {user.phone && (
                                                                    <span className="hidden sm:flex items-center gap-0.5 text-[10px] text-muted-foreground">
                                                                        <Phone className="w-2.5 h-2.5" /> {user.phone}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {/* Priority stars + Per-user Maqal badge — always visible */}
                                                            {(() => {
                                                                const userMaqal = perUserMaqal.find(m => m.user_id === user.id);
                                                                const solved = userMaqal?.solved || 0;
                                                                const total = userMaqal?.total || 0;
                                                                const remaining = total - solved;
                                                                const allDone = remaining === 0 && total > 0;
                                                                const customers = userMaqal?.customers || [];
                                                                return (
                                                                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                                        <div className="flex items-center gap-1">
                                                                            <Star className={`w-3 h-3 ${assignedCount > 0 ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground/40'}`} />
                                                                            <span className={`text-[9px] font-bold ${assignedCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground/50'}`}>{assignedCount} Priority</span>
                                                                        </div>
                                                                        {(user as any).is_kicked_out && (
                                                                            <span className="text-[8px] font-black bg-red-500/15 text-red-500 border border-red-500/30 px-1.5 py-0.5 rounded-md">🦵 KICKED OUT</span>
                                                                        )}
                                                                        {total > 0 && (
                                                                            <Popover>
                                                                                <PopoverTrigger asChild>
                                                                                    <button className={`relative flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-black transition-all hover:scale-105 cursor-pointer overflow-hidden ${
                                                                                        allDone
                                                                                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                                                                                            : 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'
                                                                                    }`}>
                                                                                        <span className="absolute inset-0 opacity-20"
                                                                                            style={{
                                                                                                background: allDone
                                                                                                    ? 'linear-gradient(90deg, transparent 0%, rgba(16,185,129,0.8) 50%, transparent 100%)'
                                                                                                    : 'linear-gradient(90deg, transparent 0%, rgba(251,191,36,0.8) 50%, transparent 100%)',
                                                                                                animation: 'lightningSwipe 1.8s ease-in-out infinite',
                                                                                            }}
                                                                                        />
                                                                                        {remaining > 0 && (
                                                                                            <span className="absolute -top-0.5 -right-0.5 flex h-1.5 w-1.5 z-10">
                                                                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                                                                                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500" />
                                                                                            </span>
                                                                                        )}
                                                                                        <span className="relative z-10 flex items-center gap-0.5 ml-1">
                                                                                            {customers.slice(0, 3).map((c: any) => (
                                                                                                <span key={c.id} className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[6px] font-black shrink-0 border ${c.has_payment ? 'bg-emerald-500 border-emerald-400 text-white' : 'bg-amber-500 border-amber-400 text-white'}`} title={c.name}>
                                                                                                    {c.avatar_url ? <img src={c.avatar_url} className="w-full h-full rounded-full object-cover" alt={c.name} /> : c.name.charAt(0).toUpperCase()}
                                                                                                </span>
                                                                                            ))}
                                                                                            {customers.length > 3 && (
                                                                                                <span className="text-[7px] font-bold text-muted-foreground ml-0.5">+{customers.length - 3}</span>
                                                                                            )}
                                                                                        </span>
                                                                                        <span className="relative z-10 font-black tabular-nums">{solved}/{total}</span>
                                                                                    </button>
                                                                                </PopoverTrigger>
                                                                                <PopoverContent className="w-56 p-0 bg-card border-border shadow-2xl rounded-xl z-50 overflow-hidden" align="start" sideOffset={6}>
                                                                                    <div className={`px-3 py-1.5 flex items-center justify-between ${allDone ? 'bg-emerald-500/10' : 'bg-amber-500/10'}`}>
                                                                                        <span className="text-[9px] font-black uppercase tracking-widest text-foreground">Maqal</span>
                                                                                        {allDone ? (
                                                                                            <span className="text-[8px] font-bold text-emerald-500 bg-emerald-500/20 px-1.5 py-0.5 rounded-full border border-emerald-500/30">Done ✓</span>
                                                                                        ) : (
                                                                                            <span className="text-[8px] font-bold text-amber-500 bg-amber-500/20 px-1.5 py-0.5 rounded-full border border-amber-500/30">{remaining} left</span>
                                                                                        )}
                                                                                    </div>
                                                                                    <div className="p-1.5 space-y-0.5 max-h-[180px] overflow-y-auto">
                                                                                        {customers.filter(c => !c.has_payment).map(c => (
                                                                                            <div key={c.id} className="flex items-center gap-1.5 p-1 rounded-lg bg-amber-500/5 border border-amber-500/20">
                                                                                                <span className="flex items-center justify-center w-4 h-4 rounded-full bg-amber-500 text-white text-[7px] font-black shrink-0">
                                                                                                    {c.avatar_url ? <img src={c.avatar_url} className="w-full h-full rounded-full object-cover" alt={c.name} /> : c.name.charAt(0).toUpperCase()}
                                                                                                </span>
                                                                                                <span className="text-[10px] font-semibold text-foreground truncate flex-1">{c.name}</span>
                                                                                                <Circle className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                                                                                            </div>
                                                                                        ))}
                                                                                        {customers.filter(c => !c.has_payment).length === 0 && (
                                                                                            <div className="p-3 text-center">
                                                                                                <CheckCircle2 className="w-5 h-5 text-emerald-500 mx-auto mb-1 opacity-50" />
                                                                                                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">All Done</p>
                                                                                            </div>
                                                                                        )}
                                                                                    </div>
                                                                                </PopoverContent>
                                                                            </Popover>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })()}
                                                        </div>

                                                        {/* Actions */}
                                                        {isSuperAdmin && (
                                                            <div className="flex items-center gap-1.5 shrink-0">
                                                                <button
                                                                    onClick={() => handleOpenEditDialog(user)}
                                                                    className="p-2 rounded-xl border border-border/50 hover:bg-muted/50 active:scale-90 transition-all"
                                                                >
                                                                    <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                                                                </button>
                                                                {(user as any).is_kicked_out ? (
                                                                    <button
                                                                        onClick={() => handleAllowUser(user.id)}
                                                                        title="Restore access"
                                                                        className="p-2 rounded-xl border border-emerald-500/30 hover:bg-emerald-500/10 active:scale-90 transition-all"
                                                                    >
                                                                        <span className="text-sm">✅</span>
                                                                    </button>
                                                                ) : (
                                                                    user.username !== currentUser?.username && (
                                                                        <button
                                                                            onClick={() => setKickoutTarget({ userId: user.id, name: user.name || user.username })}
                                                                            title="Kick out user"
                                                                            className="p-2 rounded-xl border border-orange-500/30 hover:bg-orange-500/10 active:scale-90 transition-all"
                                                                        >
                                                                            <span className="text-sm">🦵</span>
                                                                        </button>
                                                                    )
                                                                )}
                                                                {user.username !== 'admin' && (
                                                                    <button
                                                                        onClick={() => handleDeleteUser(user.id, user.username)}
                                                                        className="p-2 rounded-xl border border-destructive/20 hover:bg-destructive/10 active:scale-90 transition-all"
                                                                    >
                                                                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="flex justify-center mt-6">
                                <button
                                    onClick={() => {
                                        setMotherNameVal('');
                                        setPhoneVal('');
                                        setBirthYearVal('');
                                        setClearHistoryStep(1);
                                        setIsClearHistoryOpen(true);
                                    }}
                                    className="text-[9px] tracking-wide uppercase text-muted-foreground/35 hover:text-red-500 hover:bg-red-500/5 px-2.5 py-1 rounded-md transition-all font-bold border border-transparent hover:border-red-500/10 active:scale-95 duration-200 cursor-pointer animate-fade-in"
                                >
                                    Clear All History Customer
                                </button>
                            </div>
                        </TabsContent>
                    )}

                    {/* ── Appearance ── */}
                    <TabsContent value="appearance" className="mt-3">
                        <AppearanceTab />
                    </TabsContent>

                    {/* ── Recycle Bin / Trash ── */}
                    {isSuperAdmin && (
                        <TabsContent value="trash" className="mt-3">
                            <TrashTab currentUser={currentUser} />
                        </TabsContent>
                    )}

                    {/* ── Backup ── */}
                    {isAnyAdmin && (
                        <TabsContent value="backup" className="mt-3">
                            <div className="space-y-3">
                                {/* ★ OneDrive Backup — NEW */}
                                <div className="rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm">
                                    <div className="px-4 py-3 border-b border-border/40 bg-gradient-to-r from-blue-500/5 to-transparent">
                                        <div className="flex items-center gap-2.5">
                                            <div className="p-1.5 rounded-lg bg-blue-500/15">
                                                <HardDrive className="w-4 h-4 text-blue-500" />
                                            </div>
                                            <div>
                                                <h3 className="text-sm font-bold text-foreground">☁️ Save to OneDrive</h3>
                                                <p className="text-[10px] text-muted-foreground">Buuga Maqalka + Buuga Maalinlaha — saved to your OneDrive folder</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="p-4 space-y-3">
                                        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200/50 dark:border-blue-800/30 rounded-xl p-3 text-xs text-blue-800 dark:text-blue-300 space-y-1">
                                            <p className="font-bold">📁 Files saved to:</p>
                                            <p className="font-mono text-[10px] opacity-80">OneDrive/Desktop/dadcare app/Backups/</p>
                                            <p>Each backup includes:</p>
                                            <ul className="list-disc list-inside text-[11px] space-y-0.5 ml-1 opacity-90">
                                                <li><strong>Buuga Maqalka</strong> — Full ledger history for every customer</li>
                                                <li><strong>Buuga Maalinlaha</strong> — Complete daily book record</li>
                                                <li><strong>Beautiful HTML</strong> — Open in any browser to print</li>
                                                <li><strong>Text files</strong> — Readable on any device forever</li>
                                            </ul>
                                        </div>
                                        <Button
                                            onClick={async () => {
                                                setLoading(true);
                                                try {
                                                    const res = await fetch('/api/backup', { method: 'POST' });
                                                    const data = await res.json();
                                                    if (res.ok && data.success) {
                                                        toast.success(`✅ Backup saved! ${data.stats.filesGenerated} files saved to OneDrive`);
                                                    } else {
                                                        toast.error('Backup failed: ' + (data.error || 'Unknown error'));
                                                    }
                                                } catch (e) {
                                                    toast.error('Network error during backup');
                                                } finally {
                                                    setLoading(false);
                                                }
                                            }}
                                            disabled={loading}
                                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold h-12 rounded-xl shadow-lg shadow-blue-600/20 active:scale-[0.98] transition-all"
                                        >
                                            {loading ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                    Generating backup...
                                                </>
                                            ) : (
                                                <>
                                                    <HardDrive className="w-4 h-4 mr-2" />
                                                    ☁️ Generate OneDrive Backup Now
                                                </>
                                            )}
                                        </Button>
                                    </div>
                                </div>

                                {/* ── Restore & Verify ─────────────────────────────── */}
                                <div className="rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm">
                                    <div className="px-4 py-3 border-b border-border/40 bg-gradient-to-r from-rose-500/5 to-transparent">
                                        <div className="flex items-center gap-2.5">
                                            <div className="p-1.5 rounded-lg bg-rose-500/15">
                                                <Shield className="w-4 h-4 text-rose-500" />
                                            </div>
                                            <div>
                                                <h3 className="text-sm font-bold text-foreground">🔁 Restore & Verify Backup</h3>
                                                <p className="text-[10px] text-muted-foreground">Upload a backup JSON, verify its integrity, then restore if needed</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="p-4 space-y-3">

                                        {/* File picker */}
                                        <div
                                            onClick={() => restoreFileInputRef.current?.click()}
                                            className="border-2 border-dashed border-border/60 rounded-xl p-5 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/3 transition-all"
                                        >
                                            <input
                                                ref={restoreFileInputRef}
                                                type="file"
                                                accept=".json"
                                                className="hidden"
                                                onChange={async (e) => {
                                                    const file = e.target.files?.[0];
                                                    if (!file) return;
                                                    if (!file.name.endsWith('.json')) { toast.error('Please select a .json backup file'); return; }
                                                    setBackupFile(file);
                                                    setVerifyResult(null);
                                                    setRestoreConfirmText('');
                                                    try {
                                                        const text = await file.text();
                                                        const parsed = JSON.parse(text);
                                                        setBackupData(parsed.data || parsed);
                                                    } catch {
                                                        toast.error('Could not parse JSON file. Is it a valid backup?');
                                                        setBackupFile(null);
                                                    }
                                                }}
                                            />
                                            <HardDrive className="w-6 h-6 text-muted-foreground/40 mx-auto mb-2" />
                                            {backupFile ? (
                                                <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">📄 {backupFile.name}</p>
                                            ) : (
                                                <p className="text-xs text-muted-foreground">Click to select a <strong>.json</strong> backup file</p>
                                            )}
                                        </div>

                                        {/* Step 1: Verify */}
                                        {backupData && !verifyResult && (
                                            <Button
                                                onClick={async () => {
                                                    setVerifying(true);
                                                    try {
                                                        const res = await fetch('/api/verify-backup', {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ data: backupData }),
                                                        });
                                                        const result = await res.json();
                                                        setVerifyResult(result);
                                                        if (result.allPassed) toast.success('✅ Backup verified! All checks passed.');
                                                        else toast.error('⚠️ Backup has issues. Review the report before restoring.');
                                                    } catch { toast.error('Verification request failed'); }
                                                    finally { setVerifying(false); }
                                                }}
                                                disabled={verifying}
                                                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold h-10 rounded-xl"
                                            >
                                                {verifying ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Verifying...</> : <><CheckCircle2 className="w-4 h-4 mr-2" />Step 1: Verify Backup Integrity</>}
                                            </Button>
                                        )}

                                        {/* Verify Report */}
                                        {verifyResult && (
                                            <div className="space-y-2">
                                                <div className={cn(
                                                    "rounded-xl p-3 text-xs font-bold",
                                                    verifyResult.allPassed
                                                        ? "bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/60 text-emerald-700 dark:text-emerald-300"
                                                        : "bg-rose-50 dark:bg-rose-950/30 border border-rose-200/60 text-rose-700 dark:text-rose-300"
                                                )}>
                                                    {verifyResult.summary}
                                                </div>

                                                {verifyResult.stats && (
                                                    <div className="grid grid-cols-3 gap-2">
                                                        {[
                                                            { label: 'Customers', value: verifyResult.stats.customers },
                                                            { label: 'Ledger Rows', value: verifyResult.stats.ledger },
                                                            { label: 'Daily Books', value: verifyResult.stats.dailyBook },
                                                        ].map(s => (
                                                            <div key={s.label} className="bg-muted/30 rounded-lg p-2 text-center">
                                                                <p className="text-base font-black text-foreground">{s.value}</p>
                                                                <p className="text-[9px] text-muted-foreground">{s.label}</p>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                <div className="space-y-1.5">
                                                    {verifyResult.checks?.map((chk: any, i: number) => (
                                                        <div key={i} className={cn(
                                                            "flex items-start gap-2 rounded-lg px-3 py-2 text-xs",
                                                            chk.passed ? "bg-emerald-500/8 text-emerald-700 dark:text-emerald-300" : "bg-rose-500/8 text-rose-700 dark:text-rose-300"
                                                        )}>
                                                            {chk.passed ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
                                                            <div>
                                                                <p className="font-bold">{chk.name}</p>
                                                                <p className="opacity-80">{chk.detail}</p>
                                                                {chk.errors?.length > 0 && (
                                                                    <ul className="mt-1 space-y-0.5 list-disc list-inside opacity-90">
                                                                        {chk.errors.map((e: string, j: number) => <li key={j} className="text-[10px]">{e}</li>)}
                                                                    </ul>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>

                                                <div className="flex gap-2 pt-1">
                                                    <Button
                                                        onClick={async () => {
                                                            setVerifying(true);
                                                            try {
                                                                const res = await fetch('/api/verify-backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: backupData }) });
                                                                setVerifyResult(await res.json());
                                                            } catch { toast.error('Re-verify failed'); }
                                                            finally { setVerifying(false); }
                                                        }}
                                                        disabled={verifying}
                                                        variant="outline"
                                                        className="flex-1 h-9 text-xs rounded-xl"
                                                    >
                                                        {verifying ? <Loader2 className="w-3 h-3 animate-spin" /> : '↺ Re-verify'}
                                                    </Button>
                                                    <Button
                                                        onClick={() => { setRestoreConfirmText(''); setShowRestoreConfirm(true); }}
                                                        disabled={!verifyResult.allPassed}
                                                        className="flex-1 h-9 text-xs bg-rose-600 hover:bg-rose-700 text-white rounded-xl disabled:opacity-40"
                                                    >
                                                        🔁 Step 2: Restore Database
                                                    </Button>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Restore Confirmation Dialog */}
                                    <Dialog open={showRestoreConfirm} onOpenChange={setShowRestoreConfirm}>
                                        <DialogContent className="max-w-sm rounded-2xl">
                                            <DialogHeader>
                                                <DialogTitle className="text-rose-600 flex items-center gap-2">
                                                    <AlertTriangle className="w-5 h-5" />
                                                    Confirm Full Restore
                                                </DialogTitle>
                                                <DialogDescription className="text-xs leading-relaxed">
                                                    This will <strong>delete ALL current data</strong> and replace it with the backup contents. This cannot be undone. Type <strong>I CONFIRM RESTORE</strong> to proceed.
                                                </DialogDescription>
                                            </DialogHeader>
                                            <div className="space-y-3 pt-2">
                                                <Input
                                                    value={restoreConfirmText}
                                                    onChange={e => setRestoreConfirmText(e.target.value)}
                                                    placeholder="I CONFIRM RESTORE"
                                                    className="font-mono text-sm rounded-xl border-rose-300 focus-visible:ring-rose-400"
                                                />
                                                <Button
                                                    onClick={async () => {
                                                        if (restoreConfirmText !== 'I CONFIRM RESTORE') { toast.error('Type the confirmation text exactly'); return; }
                                                        setRestoring(true);
                                                        try {
                                                            const res = await fetch('/api/restore', {
                                                                method: 'POST',
                                                                headers: { 'Content-Type': 'application/json' },
                                                                body: JSON.stringify({ data: backupData, confirm: 'I CONFIRM RESTORE' }),
                                                            });
                                                            const result = await res.json();
                                                            if (res.ok && result.success) {
                                                                toast.success(`✅ Restore complete! ${result.restored.customers} customers, ${result.restored.ledger} ledger entries restored.`);
                                                                setShowRestoreConfirm(false);
                                                                setBackupFile(null); setBackupData(null); setVerifyResult(null); setRestoreConfirmText('');
                                                            } else {
                                                                toast.error('Restore failed: ' + (result.error || 'Unknown error'));
                                                            }
                                                        } catch { toast.error('Restore request failed'); }
                                                        finally { setRestoring(false); }
                                                    }}
                                                    disabled={restoreConfirmText !== 'I CONFIRM RESTORE' || restoring}
                                                    className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold h-11 rounded-xl disabled:opacity-40"
                                                >
                                                    {restoring ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Restoring...</> : '🔁 Execute Restore'}
                                                </Button>
                                            </div>
                                        </DialogContent>
                                    </Dialog>
                                </div>

                                {/* Export PDF Card (existing) */}

                                <div className="rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm">
                                    <div className="px-4 py-3 border-b border-border/40 bg-gradient-to-r from-amber-500/5 to-transparent">
                                        <div className="flex items-center gap-2.5">
                                            <div className="p-1.5 rounded-lg bg-amber-500/15">
                                                <Download className="w-4 h-4 text-amber-500" />
                                            </div>
                                            <div>
                                                <h3 className="text-sm font-bold text-foreground">PDF Download</h3>
                                                <p className="text-[10px] text-muted-foreground">Download a PDF receipt backup to your device</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="p-4">
                                        <Button
                                            onClick={handleExportPDF}
                                            disabled={loading}
                                            className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold h-12 rounded-xl shadow-lg shadow-amber-600/20 active:scale-[0.98] transition-all"
                                        >
                                            {loading ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                    Exporting...
                                                </>
                                            ) : (
                                                <>
                                                    <Download className="w-4 h-4 mr-2" />
                                                    Download PDF Backup
                                                </>
                                            )}
                                        </Button>
                                    </div>
                                </div>

                                {/* Security Info */}
                                <div className="rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm">
                                    <div className="px-4 py-3 border-b border-border/40">
                                        <div className="flex items-center gap-2.5">
                                            <div className="p-1.5 rounded-lg bg-emerald-500/15">
                                                <Shield className="w-4 h-4 text-emerald-500" />
                                            </div>
                                            <h3 className="text-sm font-bold text-foreground">Security Info</h3>
                                        </div>
                                    </div>
                                    <div className="p-4 space-y-3">
                                        {[
                                            { title: 'Cloud Database', desc: 'All data stored in Supabase (99.9% uptime) — never lost.' },
                                            { title: 'OneDrive Sync', desc: 'Backups auto-sync to Microsoft cloud via OneDrive.' },
                                            { title: 'Proof of Record', desc: 'Every transaction logged with timestamp & ID.' },
                                        ].map((item, i) => (
                                            <div key={i} className="flex gap-3 items-start">
                                                <div className="w-6 h-6 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0 mt-0.5">
                                                    <span className="text-[10px] font-black text-emerald-500">{i + 1}</span>
                                                </div>
                                                <div>
                                                    <p className="text-xs font-bold text-foreground">{item.title}</p>
                                                    <p className="text-[11px] text-muted-foreground leading-relaxed">{item.desc}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </TabsContent>
                    )}

                    {/* ── Audit Logs & Online Users ── */}
                    {isSuperAdmin && (
                        <TabsContent value="audit" className="mt-3">
                            <div className="space-y-3">

                                {/* Master Refresh (Only for Super Admin) */}
                                {isSuperAdmin && (
                                <div className="flex justify-end">
                                    <button
                                        onClick={async () => {
                                            setAuditLoading(true);
                                            await Promise.all([
                                                loadOnlineSessions(),
                                                loadAuditStats(),
                                                loadAuditLogs(auditFilterUser, auditFilterAction, true, false),
                                                loadUsers(),
                                            ]);
                                            setAuditLoading(false);
                                        }}
                                        disabled={auditLoading}
                                        className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-primary hover:text-primary/80 bg-primary/5 hover:bg-primary/10 border border-primary/20 px-3 py-1.5 rounded-xl transition-all active:scale-95 disabled:opacity-50"
                                    >
                                        <RefreshCw className={`w-3 h-3 ${auditLoading ? 'animate-spin' : ''}`} />
                                        Refresh All
                                    </button>
                                </div>
                                )}

                                {/* ── Live Online Status Bar ── */}
                                {(isSuperAdmin || isAdmin) && (
                                <div className="rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm">
                                    <div className="relative overflow-hidden px-4 py-3 border-b border-border/40 bg-gradient-to-r from-emerald-500/8 to-transparent flex items-center justify-between">
                                        <AnimatedBackground />
                                        <div className="flex items-center gap-2 relative z-10">
                                            <div className="p-1.5 rounded-lg bg-emerald-500/15">
                                                <Wifi className="w-4 h-4 text-emerald-500" />
                                            </div>
                                            <div>
                                                <h3 className="text-sm font-bold text-foreground">Who's Online Now</h3>
                                                <p className="text-[10px] text-muted-foreground">Real-time active status for all admins</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={async () => {
                                                await loadOnlineSessions();
                                                await loadUsers();
                                                await loadAuditLogs(auditFilterUser, auditFilterAction, false, true);
                                            }}
                                            className="p-1.5 rounded-lg hover:bg-muted/50 transition-all active:scale-90 relative z-10"
                                        >
                                            <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
                                        </button>
                                    </div>
                                    <div className="p-3">
                                        {adminStatusList.length === 0 ? (
                                            <div className="flex items-center gap-2.5 py-2 px-3 bg-muted/20 rounded-xl">
                                                <WifiOff className="w-4 h-4 text-muted-foreground/40" />
                                                <span className="text-xs text-muted-foreground">No admin accounts found</span>
                                            </div>
                                        ) : (
                                            <div className="flex flex-wrap gap-2">
                                                {adminStatusList.map((s: any, i: number) => {
                                                    const timeString = formatRelativeTime(s.lastSeen);
                                                    return (
                                                        <button key={i} onClick={() => openAdminDetail(s)} className={cn(
                                                            "flex items-center gap-2 border rounded-xl px-3 py-2 transition-all duration-200 active:scale-95 cursor-pointer text-left",
                                                            s.isOnline
                                                                ? "bg-emerald-500/8 border-emerald-500/20 shadow-sm shadow-emerald-500/5 hover:bg-emerald-500/15"
                                                                : "bg-muted/10 border-border/40 hover:bg-muted/30"
                                                        )}>
                                                            <div className="relative">
                                                                {s.avatarUrl ? (
                                                                    <Avatar className={cn("w-7 h-7 shrink-0", s.isOnline ? "border border-emerald-500/20" : "border border-border/50")}>
                                                                        <AvatarImage src={s.avatarUrl} className="object-cover" />
                                                                        <AvatarFallback className="text-[9px] font-black uppercase bg-muted text-muted-foreground">
                                                                            {(s.name || s.username).charAt(0)}
                                                                        </AvatarFallback>
                                                                    </Avatar>
                                                                ) : (
                                                                    <div className={cn(
                                                                        "w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[10px] font-black uppercase",
                                                                        s.isOnline ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground/80"
                                                                    )}>
                                                                        {(s.name || s.username).charAt(0)}
                                                                    </div>
                                                                )}
                                                                <div className={cn(
                                                                    "absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card",
                                                                    s.isOnline ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/40"
                                                                )} />
                                                            </div>
                                                            <div>
                                                                <p className="text-[10px] font-black text-foreground leading-tight">{s.name || s.username}</p>
                                                                <p className={cn(
                                                                    "text-[8px] font-black tracking-tight mt-0.5",
                                                                    s.isOnline ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground/70"
                                                                )}>
                                                                    {s.isOnline ? "ONLINE" : (s.lastSeen ? `LAST SEEN: ${s.lastSeen.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : timeString.toUpperCase())}
                                                                </p>
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                )}

                                {/* ── SUPER_ADMIN ONLY SECTIONS ── */}
                                {isSuperAdmin && (
                                    <>
                                        {/* ── Per-Admin Activity Cards Removed ── */}

                                {/* ── All-In-One Audit Logs Feed ── */}
                                <div className="rounded-3xl border border-white/10 bg-background/60 backdrop-blur-xl overflow-hidden shadow-2xl mt-6 relative before:absolute before:inset-0 before:bg-gradient-to-b before:from-white/5 before:to-transparent before:pointer-events-none">
                                    <div className="relative overflow-hidden px-4 py-3 border-b border-white/10 bg-gradient-to-r from-blue-500/10 to-transparent flex items-center justify-between z-10">
                                        <AnimatedBackground />
                                        <div className="flex items-center gap-3 relative z-10">
                                            <div className="p-2 rounded-xl bg-blue-500/20 shadow-inner border border-blue-500/20">
                                                <Activity className="w-4 h-4 text-blue-400" />
                                            </div>
                                            <div>
                                                <h3 className="text-sm font-black text-foreground tracking-tight">System Audit Log</h3>
                                                <p className="text-[10px] font-medium text-muted-foreground">Real-time security & event feed</p>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {/* Audit Header row */}
                                    <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-2 relative z-10">
                                        <div className="flex items-center gap-2">
                                            <span className="relative flex h-2 w-2">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                                            </span>
                                            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Live · Auto-refresh 30s</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => loadAuditLogs(auditFilterUser, auditFilterAction, false, false)}
                                                className="h-7 px-2.5 rounded-lg text-[9px] font-black uppercase tracking-widest bg-blue-500/10 hover:bg-blue-500/20 text-blue-500 border border-blue-500/20 transition-all flex items-center gap-1"
                                            >
                                                <RefreshCw className="w-3 h-3" />
                                                Refresh Now
                                            </button>
                                            <button
                                                onClick={handleClearAuditLogs}
                                                className="h-7 px-2.5 rounded-lg text-[9px] font-black uppercase tracking-widest bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 transition-all"
                                            >
                                                RESET ALL
                                            </button>
                                        </div>
                                    </div>

                                    {/* Filters */}
                                    <div className="px-4 py-2.5 border-b border-white/5 bg-black/5 dark:bg-white/5 grid grid-cols-2 gap-3 relative z-10">
                                        <div className="space-y-1">
                                            <Label className="text-[10px] font-bold text-muted-foreground uppercase">Filter Admin</Label>
                                            <select
                                                value={auditFilterUser}
                                                onChange={(e) => {
                                                    setAuditFilterUser(e.target.value);
                                                    loadAuditLogs(e.target.value, auditFilterAction);
                                                }}
                                                className="w-full bg-background border border-border/50 rounded-xl h-9 text-xs px-2 outline-none"
                                            >
                                                <option value="">All Admins</option>
                                                {auditUserStats.map(s => (
                                                    <option key={s.username} value={s.username}>{s.name || s.username}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-[10px] font-bold text-muted-foreground uppercase">Filter Action</Label>
                                            <select
                                                value={auditFilterAction}
                                                onChange={(e) => {
                                                    setAuditFilterAction(e.target.value);
                                                    loadAuditLogs(auditFilterUser, e.target.value);
                                                }}
                                                className="w-full bg-background border border-border/50 rounded-xl h-9 text-xs px-2 outline-none"
                                            >
                                                <option value="">All Actions</option>
                                                {auditActions.map(a => (
                                                    <option key={a} value={a}>{a}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    {/* Feed */}
                                    <div className="divide-y divide-white/5 max-h-[350px] overflow-y-auto relative z-10 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                                        {auditLoading && auditLogs.length === 0 ? (
                                            <div className="py-12 flex flex-col items-center justify-center gap-3">
                                                <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                                                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Loading Logs...</p>
                                            </div>
                                        ) : auditLogs.length === 0 ? (
                                            <div className="py-12 text-center text-[11px] text-muted-foreground">
                                                No logs found matching your filters.
                                            </div>
                                        ) : (
                                            auditLogs.map((log: any) => {
                                                const action = log.action as string;
                                                const isLogin = action === 'LOGIN';
                                                const isLogout = action === 'LOGOUT';
                                                const isFailed = action === 'LOGIN_FAILED';
                                                const isClear = action === 'CLEAR_AUDIT_LOGS';
                                                const logDate = new Date(log.created_at);
                                                return (
                                                    <div key={log.id} className="flex items-start gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors group">
                                                        {/* First-letter badge only — no photo */}
                                                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black uppercase shrink-0 mt-0.5 shadow-inner border ${
                                                            isLogin ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
                                                            : isLogout ? 'bg-slate-500/20 border-slate-500/30 text-slate-400'
                                                            : isFailed ? 'bg-red-500/20 border-red-500/30 text-red-400'
                                                            : isClear ? 'bg-orange-500/20 border-orange-500/30 text-orange-400'
                                                            : 'bg-blue-500/20 border-blue-500/30 text-blue-400'
                                                        }`}>
                                                            {(log.name || log.username || '?').charAt(0)}
                                                        </div>
                                                        <div className="flex-1 min-w-0 flex flex-col justify-center">
                                                            <div className="flex items-center justify-between flex-wrap gap-2">
                                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                                    <span className="text-[11px] font-black text-foreground drop-shadow-sm">{log.name || log.username}</span>
                                                                    <span className="text-[8px] font-black tracking-widest text-muted-foreground px-1.5 py-0.5 rounded-md bg-black/20 dark:bg-white/10 border border-white/5">
                                                                        {log.action}
                                                                    </span>
                                                                </div>
                                                                <div className="flex items-center gap-1.5 text-[8px] font-medium text-muted-foreground/70">
                                                                    <span>{logDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                                                                    {log.ip_address && (
                                                                        <>
                                                                            <span className="w-1 h-1 rounded-full bg-white/10"></span>
                                                                            <span className="font-mono text-[7px] bg-black/20 dark:bg-white/10 px-1 py-0.5 rounded border border-white/5">{log.ip_address}</span>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {log.details && <p className="text-[10px] text-muted-foreground/90 leading-relaxed mt-0.5 truncate group-hover:whitespace-normal group-hover:text-clip">{log.details}</p>}
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        )}
                                        {auditLogs.length > 0 && auditLogs.length < auditTotal && (
                                            <div className="p-4 flex justify-center border-t border-white/5">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={loadMoreAuditLogs}
                                                    disabled={auditLoadingMore}
                                                    className="rounded-xl font-bold text-xs border-white/10 bg-white/5 hover:bg-white/10"
                                                >
                                                    {auditLoadingMore ? 'Loading...' : `Load More (${auditTotal - auditLogs.length} remaining)`}
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                    </div>
                                    </>
                                )}
                            </div>
                        </TabsContent>
                    )}
                </Tabs>
            </div>

            {/* ── Clear Ledger History Dialog ── */}
            <Dialog open={isClearHistoryOpen} onOpenChange={setIsClearHistoryOpen}>
                <DialogContent className="border-border/50 max-w-[95vw] sm:max-w-md rounded-2xl p-0 overflow-hidden shadow-2xl">
                    <div className="border-b border-border/40 px-4 py-3">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2 text-foreground text-sm font-black">
                                <Shield className="w-4 h-4 text-destructive animate-pulse" />
                                Clear Customer Ledger History
                            </DialogTitle>
                            <DialogDescription className="text-muted-foreground text-[10px]">
                                Security verification is required to clear all customer ledger history.
                            </DialogDescription>
                        </DialogHeader>
                    </div>

                    <div className="p-4 space-y-4">
                        {clearHistoryStep === 1 ? (
                            <div className="space-y-3.5">
                                <div className="space-y-1">
                                    <Label className="text-[11px] font-bold text-foreground">
                                        1. What is your mother's name?
                                    </Label>
                                    <Input
                                        type="text"
                                        placeholder="Enter mother's name"
                                        value={motherNameVal}
                                        onChange={(e) => setMotherNameVal(e.target.value)}
                                        className="bg-background/50 border-border/50 rounded-xl h-10 text-xs animate-none"
                                    />
                                </div>

                                <div className="space-y-1">
                                    <Label className="text-[11px] font-bold text-foreground">
                                        2. Fill in the blank: what is the full phone number matching 06******75?
                                    </Label>
                                    <Input
                                        type="text"
                                        placeholder="06xxxxxxxx"
                                        value={phoneVal}
                                        onChange={(e) => setPhoneVal(e.target.value)}
                                        className="bg-background/50 border-border/50 rounded-xl h-10 text-xs font-mono animate-none"
                                    />
                                </div>

                                <div className="space-y-1">
                                    <Label className="text-[11px] font-bold text-foreground">
                                        3. Enter 4-digit PIN
                                    </Label>
                                    <Input
                                        type="password"
                                        placeholder="****"
                                        value={birthYearVal}
                                        onChange={(e) => setBirthYearVal(e.target.value)}
                                        className="bg-background/50 border-border/50 rounded-xl h-10 text-xs animate-none"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-2 pt-2">
                                    <Button
                                        variant="outline"
                                        onClick={() => setIsClearHistoryOpen(false)}
                                        className="border-border/50 rounded-xl font-bold h-10 text-xs active:scale-95 transition-all"
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        onClick={handleVerifyConditions}
                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-bold rounded-xl h-10 text-xs active:scale-95 transition-all"
                                    >
                                        Verify
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-3.5">
                                <div className="bg-red-500/10 border border-red-500/25 rounded-2xl p-4 flex flex-col items-center text-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center animate-pulse animate-duration-1000">
                                        <AlertTriangle className="w-5 h-5 text-red-500" />
                                    </div>
                                    <div>
                                        <p className="text-xs font-black text-red-500 uppercase tracking-wider">
                                            ⚠️ VERY IMPORTANT & HIGH RISK ⚠️
                                        </p>
                                        <p className="text-[11px] text-foreground font-semibold mt-2 leading-relaxed">
                                            This is a high-risk operation! Deleting all customer ledger history (maqalka ledger) is PERMANENT and CANNOT be undone.
                                        </p>
                                        <p className="text-[10px] text-muted-foreground mt-1 leading-normal">
                                            All customer ledger balances will be reset to $0. Note that Daily Book records (buuga maalinlaha) and customer profiles themselves are safe and will not be affected.
                                        </p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2 pt-2">
                                    <Button
                                        variant="outline"
                                        onClick={() => setClearHistoryStep(1)}
                                        className="border-border/50 rounded-xl font-bold h-10 text-xs active:scale-95 transition-all"
                                        disabled={isClearingHistory}
                                    >
                                        Back
                                    </Button>
                                    <Button
                                        onClick={handleClearLedgerHistory}
                                        className="bg-red-600 text-white hover:bg-red-700 font-bold rounded-xl h-10 text-xs flex items-center justify-center shadow-lg shadow-red-600/15 active:scale-95 transition-all"
                                        disabled={isClearingHistory}
                                    >
                                        {isClearingHistory ? (
                                            <>
                                                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                                Clearing...
                                            </>
                                        ) : (
                                            "Yes, Clear All History"
                                        )}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {/* ── Create/Edit User Dialog ── */}
            <Dialog open={isUserDialogOpen} onOpenChange={setIsUserDialogOpen}>
                <DialogContent className="border-border/50 max-w-[95vw] sm:max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl p-0">
                    {/* Dialog Header */}
                    <div className="sticky top-0 z-10 backdrop-blur-xl border-b border-border/40 px-4 py-3 rounded-t-2xl">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2 text-foreground text-sm">
                                {selectedUser ? <UserCheck className="w-4 h-4 text-primary" /> : <UserPlus className="w-4 h-4 text-primary" />}
                                {selectedUser ? 'Edit User' : 'New User'}
                            </DialogTitle>
                            <DialogDescription className="text-muted-foreground text-[10px]">
                                Set credentials, profile & priority customers.
                            </DialogDescription>
                        </DialogHeader>
                    </div>

                    <div className="px-4 pb-4 pt-2 space-y-4">
                        {/* Avatar */}
                        <div className="flex flex-col items-center py-3 bg-muted/20 border border-dashed border-border/60 rounded-2xl">
                            <Avatar className="h-16 w-16 border-2 border-primary/30 bg-background shadow-inner">
                                {userForm.avatar_url ? (
                                    <AvatarImage src={userForm.avatar_url} className="object-cover" />
                                ) : null}
                                <AvatarFallback className="text-xl font-black text-primary bg-primary/5 uppercase">
                                    {userForm.gender === 'Female' ? '👩' : userForm.gender === 'Male' ? '👨' : userForm.name?.charAt(0) || '👤'}
                                </AvatarFallback>
                            </Avatar>
                            <div className="mt-2 flex items-center gap-2">
                                <Label
                                    htmlFor="avatar-upload"
                                    className="cursor-pointer bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all shadow-sm flex items-center gap-1 active:scale-95"
                                >
                                    <ImageIcon className="w-3 h-3" />
                                    Upload
                                </Label>
                                <input
                                    id="avatar-upload"
                                    type="file"
                                    accept="image/*"
                                    onChange={handleFileChange}
                                    className="hidden"
                                />
                                {userForm.avatar_url && (
                                    <button
                                        onClick={() => setUserForm(p => ({ ...p, avatar_url: '' }))}
                                        className="text-destructive text-[10px] font-bold px-2 py-1.5 rounded-lg hover:bg-destructive/10 active:scale-95 transition-all"
                                    >
                                        Remove
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Form Fields - 2 column grid */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label className="text-foreground text-[10px] font-bold uppercase tracking-wider">Username *</Label>
                                <Input
                                    value={userForm.username}
                                    onChange={e => setUserForm({ ...userForm, username: e.target.value.toLowerCase().trim() })}
                                    placeholder="username"
                                    disabled={selectedUser !== null}
                                    className="bg-background/50 border-border/50 text-sm h-10 rounded-xl"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-foreground text-[10px] font-bold uppercase tracking-wider">Password *</Label>
                                <Input
                                    type="password"
                                    value={userForm.password}
                                    onChange={e => setUserForm({ ...userForm, password: e.target.value })}
                                    placeholder="••••••"
                                    className="bg-background/50 border-border/50 text-sm h-10 rounded-xl"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-foreground text-[10px] font-bold uppercase tracking-wider">Full Name *</Label>
                                <Input
                                    value={userForm.name}
                                    onChange={e => setUserForm({ ...userForm, name: e.target.value })}
                                    placeholder="Full name"
                                    className="bg-background/50 border-border/50 text-sm h-10 rounded-xl"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-foreground text-[10px] font-bold uppercase tracking-wider">Phone</Label>
                                <Input
                                    value={userForm.phone}
                                    onChange={e => setUserForm({ ...userForm, phone: e.target.value })}
                                    placeholder="Phone"
                                    type="tel"
                                    className="bg-background/50 border-border/50 text-sm h-10 rounded-xl"
                                />
                            </div>
                        </div>

                        {/* Gender */}
                        <div className="space-y-1.5">
                            <Label className="text-foreground text-[10px] font-bold uppercase tracking-wider">Gender</Label>
                            <div className="grid grid-cols-2 gap-2">
                                {['Male', 'Female'].map((g) => {
                                    const isSelected = userForm.gender === g;
                                    return (
                                        <button
                                            key={g}
                                            type="button"
                                            onClick={() => setUserForm({ ...userForm, gender: g })}
                                            className={`py-2.5 rounded-xl border text-xs font-bold transition-all active:scale-95 ${isSelected
                                                ? 'bg-primary/10 border-primary text-primary shadow-sm'
                                                : 'border-border/50 hover:border-primary/20 text-muted-foreground bg-background/50'
                                                }`}
                                        >
                                            {g === 'Male' ? '👨 Male' : '👩 Female'}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Role Assignment */}
                        {currentUser?.role === 'SUPER_ADMIN' && (
                            <div className="space-y-1.5">
                                <Label className="text-foreground text-[10px] font-bold uppercase tracking-wider">Role</Label>
                                <div className="grid grid-cols-3 gap-2">
                                    {['USER', 'ADMIN', 'SUPER_ADMIN'].map((r) => {
                                        const isSelected = userForm.role === r;
                                        return (
                                            <button
                                                key={r}
                                                type="button"
                                                onClick={() => setUserForm({ ...userForm, role: r })}
                                                className={`py-2.5 rounded-xl border text-[10px] font-bold transition-all active:scale-95 ${isSelected
                                                    ? 'bg-primary/10 border-primary text-primary shadow-sm'
                                                    : 'border-border/50 hover:border-primary/20 text-muted-foreground bg-background/50'
                                                    }`}
                                            >
                                                {r === 'SUPER_ADMIN' ? '👑 SUPER ADMIN' : r === 'ADMIN' ? '🛡️ ADMIN' : '👤 USER'}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Customer Assignment */}
                        <div className="space-y-2 border-t border-border/40 pt-3">
                            <div className="flex items-center justify-between">
                                <Label className="text-foreground text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5">
                                    <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                                    Priority Customers ({userForm.assigned_customer_ids.filter(id => allCustomers.some(c => c.id === id)).length})
                                </Label>
                            </div>
                            <p className="text-[9px] text-muted-foreground -mt-1">These customers appear first in their lists with a ★ star badge</p>

                            <div className="relative">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50" />
                                <Input
                                    placeholder="Search customers..."
                                    value={searchCustomer}
                                    onChange={e => setSearchCustomer(e.target.value)}
                                    className="pl-7 bg-background/50 border-border/40 h-8 text-[11px] rounded-xl"
                                />
                            </div>

                            <div className="border border-border/40 rounded-xl p-2 max-h-36 overflow-y-auto grid grid-cols-1 gap-1 bg-background/30 shadow-inner">
                                {filteredCustomers.length === 0 ? (
                                    <div className="py-4 text-center text-[10px] text-muted-foreground">
                                        No customers found
                                    </div>
                                ) : (
                                    filteredCustomers.map(customer => {
                                        const isAssigned = userForm.assigned_customer_ids.includes(customer.id);
                                        return (
                                            <button
                                                key={customer.id}
                                                type="button"
                                                onClick={() => handleToggleCustomerAssignment(customer.id)}
                                                className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-left border transition-all active:scale-[0.97] ${isAssigned
                                                    ? 'bg-amber-500/10 border-amber-500/30 text-foreground'
                                                    : 'border-transparent hover:bg-muted/30 text-foreground'
                                                    }`}
                                            >
                                                <div className={`w-4 h-4 rounded flex items-center justify-center border transition-all shrink-0 ${isAssigned ? 'bg-amber-500 border-amber-500' : 'border-muted-foreground/30 bg-background'
                                                    }`}>
                                                    {isAssigned && <Star className="w-2.5 h-2.5 text-white fill-white" />}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-[11px] truncate uppercase leading-tight font-bold">{customer.name}</p>
                                                    <p className="text-[9px] text-muted-foreground leading-none mt-0.5">#{customer.customer_code}</p>
                                                </div>
                                                {isAssigned && <Star className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0" />}
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                        </div>

                        {/* Action buttons */}
                        <div className="grid grid-cols-2 gap-2 border-t border-border/40 pt-3">
                            <Button
                                variant="outline"
                                onClick={() => setIsUserDialogOpen(false)}
                                className="border-border/50 rounded-xl font-bold h-11 active:scale-95 transition-all"
                                disabled={loading}
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleSaveUser}
                                className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold rounded-xl h-11 shadow-md shadow-primary/10 active:scale-95 transition-all"
                                disabled={loading}
                            >
                                {loading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                                        Saving...
                                    </>
                                ) : (
                                    'Save'
                                )}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* ── Admin Detail Dialog ── */}
            <Dialog open={adminDetailOpen} onOpenChange={setAdminDetailOpen}>
                <DialogContent className="max-w-md w-full rounded-2xl p-0 overflow-hidden border border-border/50 shadow-2xl">
                    <DialogHeader className="sr-only">
                        <DialogTitle>Admin Activity Details</DialogTitle>
                        <DialogDescription>Full activity timeline for {adminDetailUser?.name}</DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col max-h-[85vh]">
                        {/* Header */}
                        <div className="px-5 pt-5 pb-4 border-b border-border/30 bg-gradient-to-br from-violet-500/8 to-transparent shrink-0">
                            <div className="flex items-center gap-3">
                                {adminDetailUser?.avatarUrl ? (
                                    <Avatar className="w-12 h-12 border-2 border-violet-500/30 shadow-md">
                                        <AvatarImage src={adminDetailUser.avatarUrl} className="object-cover" />
                                        <AvatarFallback className="text-base font-black bg-violet-500/20 text-violet-600 dark:text-violet-400 uppercase">
                                            {(adminDetailUser?.name || '?').charAt(0)}
                                        </AvatarFallback>
                                    </Avatar>
                                ) : (
                                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500/30 to-indigo-500/20 flex items-center justify-center text-lg font-black text-violet-600 dark:text-violet-400 border border-violet-500/30 shadow-md uppercase">
                                        {(adminDetailUser?.name || '?').charAt(0)}
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="font-black text-foreground text-sm truncate">{adminDetailUser?.name}</span>
                                        <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-md ${adminDetailUser?.role === 'SUPER_ADMIN'
                                                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                                                : 'bg-blue-500/15 text-blue-500 border border-blue-500/30'
                                            }`}>{adminDetailUser?.role === 'SUPER_ADMIN' ? '👑 SUPER' : '🛡 ADMIN'}</span>
                                        {adminDetailUser?.isOnline
                                            ? <span className="text-[8px] font-black px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">● ONLINE</span>
                                            : <span className="text-[8px] font-black px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground border border-border/40">OFFLINE</span>
                                        }
                                    </div>
                                    <p className="text-[10px] text-muted-foreground mt-0.5">@{adminDetailUser?.username}</p>
                                    {adminDetailUser?.lastSeen && (
                                        <p className="text-[9px] text-muted-foreground/70 mt-0.5">
                                            Last active: {adminDetailUser.lastSeen.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Stats Row */}
                            {adminDetailStats && (
                                <div className="grid grid-cols-5 gap-2 mt-4">
                                    <div className="bg-background/60 rounded-xl p-2.5 text-center border border-border/30 flex flex-col justify-center">
                                        <p className="text-sm font-black text-foreground">{adminDetailStats.login_count}</p>
                                        <p className="text-[8px] text-muted-foreground font-bold truncate">Logins</p>
                                    </div>
                                    <div className="bg-background/60 rounded-xl p-2.5 text-center border border-border/30 flex flex-col justify-center">
                                        <p className="text-sm font-black text-foreground">{adminDetailStats.total_actions}</p>
                                        <p className="text-[8px] text-muted-foreground font-bold truncate">Actions</p>
                                    </div>
                                    <div className="bg-background/60 rounded-xl p-2.5 text-center border border-border/30 flex flex-col justify-center">
                                        <p className="text-sm font-black text-foreground">
                                            {users.find(u => u.username === adminDetailUser?.username)?.assigned_customer_ids?.length || 0}
                                        </p>
                                        <p className="text-[8px] text-muted-foreground font-bold truncate">Customers</p>
                                    </div>
                                    <div className="bg-background/60 rounded-xl p-2.5 text-center border border-border/30 flex flex-col justify-center">
                                        <p className="text-sm font-black text-foreground whitespace-nowrap">
                                            {(() => {
                                                const lastLogin = adminDetailStats.last_login ? new Date(adminDetailStats.last_login) : null;
                                                const lastSeen = adminDetailUser?.lastSeen ? new Date(adminDetailUser.lastSeen) : null;
                                                if (!lastLogin) return '-';
                                                const end = adminDetailUser?.isOnline ? new Date() : (lastSeen || new Date());
                                                const diff = end.getTime() - lastLogin.getTime();
                                                if (diff < 0) return '< 1m';
                                                const h = Math.floor(diff / 3600000);
                                                const m = Math.floor((diff % 3600000) / 60000);
                                                return h > 0 ? `${h}h ${m}m` : `${m}m`;
                                            })()}
                                        </p>
                                        <p className="text-[8px] text-muted-foreground font-bold truncate">Time Spent</p>
                                    </div>
                                    <div className={`rounded-xl p-2.5 text-center border flex flex-col justify-center ${parseInt(adminDetailStats.failed_logins) > 0
                                            ? 'bg-red-500/10 border-red-500/20'
                                            : 'bg-background/60 border-border/30'
                                        }`}>
                                        <p className={`text-sm font-black ${parseInt(adminDetailStats.failed_logins) > 0 ? 'text-red-500' : 'text-foreground'
                                            }`}>{adminDetailStats.failed_logins}</p>
                                        <p className="text-[8px] text-muted-foreground font-bold truncate">Failed</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Activity Feed */}
                        <div className="flex-1 overflow-y-auto">
                            <div className="px-4 py-3 border-b border-border/20 sticky top-0 z-10">
                                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Full Activity Timeline</p>
                            </div>

                            {adminDetailLoading ? (
                                <div className="flex flex-col items-center justify-center py-16 gap-3">
                                    <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
                                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Loading...</p>
                                </div>
                            ) : adminDetailLogs.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                                    <div className="w-12 h-12 rounded-2xl bg-muted/30 flex items-center justify-center mb-3">
                                        <Activity className="w-6 h-6 text-muted-foreground/30" />
                                    </div>
                                    <p className="text-sm font-bold text-muted-foreground">No activity yet</p>
                                    <p className="text-[10px] text-muted-foreground mt-1">Events will appear here as they use the system</p>
                                </div>
                            ) : (
                                <div className="divide-y divide-border/20">
                                    {adminDetailLogs.map((log: any) => {
                                        const action = log.action as string;
                                        const isLogin = action === 'LOGIN';
                                        const isLogout = action === 'LOGOUT';
                                        const isFailed = action === 'LOGIN_FAILED';
                                        const logDate = new Date(log.created_at);
                                        return (
                                            <div key={log.id} className="flex items-start gap-3 px-4 py-3">
                                                <div className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${isLogin ? 'bg-emerald-500/15 border border-emerald-500/20'
                                                        : isLogout ? 'bg-slate-500/15 border border-slate-500/20'
                                                            : isFailed ? 'bg-red-500/15 border border-red-500/20'
                                                                : 'bg-violet-500/15 border border-violet-500/20'
                                                    }`}>
                                                    {isLogin ? <LogIn className="w-3.5 h-3.5 text-emerald-500" />
                                                        : isLogout ? <LogOut className="w-3.5 h-3.5 text-slate-500" />
                                                            : isFailed ? <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                                                                : <Zap className="w-3.5 h-3.5 text-violet-500" />}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs font-bold text-foreground">{log.action}</p>
                                                    {log.details && <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed truncate">{log.details}</p>}
                                                    <p className="text-[9px] text-muted-foreground/60 mt-0.5">
                                                        {logDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} · {logDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                                                        {log.ip_address && <span className="ml-2 px-1 py-0.5 bg-muted rounded text-[8px]">{log.ip_address}</span>}
                                                        {log.user_agent && <span className="ml-1 px-1 py-0.5 bg-muted rounded text-[8px] truncate max-w-[120px] inline-block align-bottom" title={log.user_agent}>{log.user_agent.split(' ')[0]}</span>}
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* ── Kickout PIN Dialog (Settings Users tab) ── */}
            <Dialog open={!!kickoutTarget} onOpenChange={(open) => { if (!open) { setKickoutTarget(null); setKickPin1(''); setKickPin2(''); } }}>
                <DialogContent className="max-w-sm rounded-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-destructive">🦵 Kick Out {kickoutTarget?.name}?</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <p className="text-sm text-muted-foreground">
                            ⚠️ <strong>WARNING:</strong> This will immediately log out <strong>{kickoutTarget?.name}</strong> and block them from accessing the system until you restore their access.
                        </p>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">PIN 1</label>
                            <input
                                type="password"
                                value={kickPin1}
                                onChange={e => setKickPin1(e.target.value)}
                                placeholder="Enter PIN 1"
                                className="w-full h-10 px-3 rounded-xl border border-border/60 bg-background/50 text-sm focus:outline-none focus:ring-2 focus:ring-destructive/30"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">PIN 2</label>
                            <input
                                type="password"
                                value={kickPin2}
                                onChange={e => setKickPin2(e.target.value)}
                                placeholder="Enter PIN 2"
                                className="w-full h-10 px-3 rounded-xl border border-border/60 bg-background/50 text-sm focus:outline-none focus:ring-2 focus:ring-destructive/30"
                            />
                        </div>
                        <div className="flex gap-2 pt-1">
                            <Button variant="outline" onClick={() => { setKickoutTarget(null); setKickPin1(''); setKickPin2(''); }} className="flex-1">Cancel</Button>
                            <Button onClick={handleKickout} disabled={kickoutLoading || !kickPin1 || !kickPin2} className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                {kickoutLoading ? 'Kicking...' : '🦵 Kick Out'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
