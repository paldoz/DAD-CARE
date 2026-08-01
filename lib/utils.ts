import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Single Source of Truth for Customer Reliability Tiers
 * Takes the raw percentage from the backend and maps it to a standardized UI label and color.
 */
export function getReliabilityTier(pct: number) {
    if (pct >= 100) return { label: '🥇 Kaamil', colorClass: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30' };
    if (pct >= 98) return { label: '🏆 Heer Sare', colorClass: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' };
    if (pct >= 95) return { label: '⭐ Wanaagsan', colorClass: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30' };
    if (pct >= 90) return { label: '⚖️ Dhexdhexaad', colorClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30' };
    if (pct >= 80) return { label: '⚠️ Horumar u Baahan', colorClass: 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30' };
    return { label: '🚫 Heer Hoose', colorClass: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30' };
}
