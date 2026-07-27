import useSWR from 'swr';
import { useMemo } from 'react';
import { Customer, SavedEntry, DailyBookItem } from '@/types';

// Generic fetcher — silently returns null on 401/403 (session expired),
// throws on other errors so SWR can retry them once.
// Uses cookies ONLY (credentials: 'include') — NO x-session-token header.
// Custom headers prevent ALL CDN caching; cookies allow Vercel CDN to cache
// responses and serve them without hitting Supabase on every request.
export const fetcher = async (url: string) => {
    let res: Response;
    try {
        res = await fetch(url, {
            credentials: 'include', // Cookie-only auth — CDN-cacheable
            headers: {
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });
    } catch (networkErr: any) {
        // Network / timeout — log quietly, don't spam
        console.warn(`[SWR] Network error for ${url}:`, networkErr?.message || networkErr);
        throw networkErr;
    }

    if (!res.ok) {
        // 401 / 403 — session gone, return null gracefully (no throw = no SWR retry loop)
        if (res.status === 401 || res.status === 403) {
            console.warn(`[SWR] Session expired for ${url} — will retry on next user action`);
            return null;
        }
        const errorData = await res.json().catch(() => ({}));
        const msg = errorData.error || `HTTP ${res.status}`;
        console.warn(`[SWR] Fetch error for ${url}:`, msg);
        throw new Error(msg);
    }

    return res.json();
};

export interface DailyBookInitData {
    customers: Customer[];
    history: SavedEntry[];
    latestDate: string | null;
    historyCount?: number;
}

// Hook for the initial Daily Book load (Customers + History)
export function useDailyBookInit() {
    const { data, error, mutate, isLoading } = useSWR<DailyBookInitData | null>(
        '/api/daily-book-init',
        fetcher,
        {
            revalidateOnFocus: false,
            keepPreviousData: true,
            dedupingInterval: 30000,  // ⚡ 30s — was 5s (saves ~83% of reload calls)
            revalidateIfStale: true,
            revalidateOnReconnect: false,
            shouldRetryOnError: false,
        }
    );

    return { data, isLoading, isError: error, mutate };
}

// Hook for fetching a specific date's entries
export function useDailyBookDate(dateStr: string | null) {
    const { data, error, mutate, isLoading } = useSWR(
        dateStr ? `/api/daily-book?date=${dateStr}` : null,
        fetcher,
        {
            revalidateOnFocus: false,
            keepPreviousData: true,
            dedupingInterval: 0,  // always re-fetch when mutate() is called
            revalidateIfStale: true,
            revalidateOnReconnect: false,
            shouldRetryOnError: false,
        }
    );

    return { data, isLoading, isError: error, mutate };
}

// Hook for fetching ledger status for a date
export function useLedgerStatusForDate(dateStr: string | null) {
    const { data, error, mutate, isLoading } = useSWR<string[] | null>(
        dateStr ? `/api/ledger-by-date?date=${dateStr}` : null,
        fetcher,
        {
            revalidateOnFocus: false,   // FIX: was 'true' — was hitting DB on every tab switch
            revalidateOnReconnect: false,
            revalidateIfStale: false,
            dedupingInterval: 30000,    // FIX: was 5000 — 30s dedup window
            shouldRetryOnError: false,
        }
    );

    const processedCustomerIds = useMemo(() => {
        return Array.isArray(data) ? new Set(data) : new Set<string>();
    }, [data]);

    return { processedCustomerIds, isLoading, isError: error, mutate };
}

import useSWRInfinite from 'swr/infinite';

// Hook for fetching the full daily book history list with pagination
export function useDailyBookHistory() {
    const getKey = (pageIndex: number, previousPageData: SavedEntry[] | null) => {
        if (previousPageData && !previousPageData.length) return null; // reached the end
        return `/api/daily-book-history?limit=7&offset=${pageIndex * 7}`;
    };

    const { data, error, mutate, size, setSize, isValidating } = useSWRInfinite<SavedEntry[]>(
        getKey,
        fetcher,
        {
            revalidateFirstPage: false,      // ⚡ don't re-fetch all pages on every mutate
            revalidateOnFocus: false,        // ⚡ don't re-fetch on every tab-switch
            revalidateOnReconnect: false,
            revalidateAll: false,
            persistSize: true,
            dedupingInterval: 30000,         // ⚡ 30s dedup window
        }
    );

    const historyData = useMemo(() => data ? data.flat() : [], [data]);
    const isLoadingInitialData = !data && !error;
    const isLoadingMore = isLoadingInitialData || (size > 0 && data && typeof data[size - 1] === 'undefined');
    const isEmpty = data?.[0]?.length === 0;
    const isReachingEnd = isEmpty || (data && data[data.length - 1]?.length < 7);

    return { 
        data: historyData, 
        isLoading: isLoadingInitialData, 
        isLoadingMore,
        isReachingEnd,
        isError: error, 
        mutate,
        size,
        setSize,
        isValidating
    };
}
