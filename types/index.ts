export interface Customer {
    id: string;
    name: string;
    customer_code: string;
    gender?: string;
    phone?: string;
    avatar_url?: string;
    unprocessed_books_count?: number;
    total_books_count?: number;
    is_target_days_done?: boolean;
}

export interface UserData {
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

export interface DailyBookItem {
    customer_id: string;
    kg: number;
    present?: boolean;
    note?: string;
    customer?: Customer;
}

export interface SavedEntry {
    date: string;
    totalKg: number;
    items: DailyBookItem[];
}

export interface Transaction {
    id: string;
    type: 'PRODUCT' | 'PAYMENT' | 'ADJUSTMENT';
    reference_date: string;
    kg?: number;
    price_per_kg?: number;
    amount: number;
    previous_debt?: number;
    new_debt: number;
    created_at?: string;
    receipt_id?: string;
    note?: string;
}

export interface CustomerSummary {
    totalKg: number;
    totalPaid: number;
    currentBalance: number;
}

export interface VipCaadiCategory {
    id: string;
    label: string;
    customerIds: string[];
    customerPrices: Record<string, string>;
    date?: string;
    created_at?: string;
}

export interface DailyBookRecord {
    date: string;
    kg: number;
    processed: boolean;
    note?: string | null;
}
