/**
 * Accurate Hijri date utility.
 * Uses Intl API to get the numeric Hijri month, then maps to real Hijri month names.
 * Auto-updates at midnight via a scheduled timeout.
 */

const HIJRI_MONTHS = [
    'Muharram', 'Safar', "Rabi' al-Awwal", "Rabi' al-Thani",
    'Jumada al-Awwal', 'Jumada al-Thani', 'Rajab', "Sha'ban",
    'Ramadan', 'Shawwal', "Dhu al-Qi'dah", 'Dhu al-Hijjah',
];

export function getHijriDate(date: Date = new Date()): string {
    try {
        // Use islamic-umalqura = Saudi Arabia's official Umm al-Qura calendar
        const fmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
            day: 'numeric',
            month: 'numeric',
            year: 'numeric',
        });
        const parts = fmt.formatToParts(date);
        const get = (t: string) => parts.find(p => p.type === t)?.value || '';

        const day = parseInt(get('day'), 10);
        const month = parseInt(get('month'), 10); // 1-based
        const year = parseInt(get('year'), 10);

        if (!day || !month || !year) throw new Error('parse failed');

        const monthName = HIJRI_MONTHS[month - 1] || `Month ${month}`;
        return `${day} ${monthName} ${year}`;
    } catch {
        return '';
    }
}

export function getStandardDate(date: Date = new Date()): string {
    return new Intl.DateTimeFormat('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric',
    }).format(date);
}

/**
 * Calls `callback` immediately with today's dates, then re-calls at every midnight.
 * Returns a cleanup function to cancel the timer.
 */
export function subscribeToDailyDates(
    callback: (standard: string, hijri: string) => void
): () => void {
    let timeoutId: ReturnType<typeof setTimeout>;

    const fire = () => {
        const now = new Date();
        callback(getStandardDate(now), getHijriDate(now));

        // Schedule next fire at the next midnight
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 100); // 100ms past midnight to be safe
        const msUntilMidnight = tomorrow.getTime() - now.getTime();
        timeoutId = setTimeout(fire, msUntilMidnight);
    };

    fire();

    return () => clearTimeout(timeoutId);
}
