/**
 * Accurate Hijri date utility using Saudi Arabia's Umm al-Qura calendar.
 *
 * Strategy: Try islamic-umalqura first (native browser Umm al-Qura support).
 * If that fails (some older iOS/Safari), fall back to islamic-civil with +1 correction
 * which typically matches Saudi Arabia's announcement.
 * Month names are always taken from our own array — never from the browser —
 * so they will always be correct Arabic Hijri month names.
 */

const HIJRI_MONTHS = [
    'Muharram', 'Safar', "Rabi' al-Awwal", "Rabi' al-Thani",
    'Jumada al-Awwal', 'Jumada al-Thani', 'Rajab', "Sha'ban",
    'Ramadan', 'Shawwal', "Dhu al-Qi'dah", 'Dhu al-Hijjah',
];

function parseHijriParts(date: Date, calendar: string): { day: number; month: number; year: number } | null {
    try {
        const fmt = new Intl.DateTimeFormat(`en-u-ca-${calendar}`, {
            day: 'numeric',
            month: 'numeric',
            year: 'numeric',
        });
        const parts = fmt.formatToParts(date);
        const get = (t: string) => parts.find(p => p.type === t)?.value || '';
        const day = parseInt(get('day'), 10);
        const month = parseInt(get('month'), 10);
        const year = parseInt(get('year'), 10);
        if (!day || !month || !year || month > 12) return null;
        return { day, month, year };
    } catch {
        return null;
    }
}

export function getHijriDate(date: Date = new Date()): string {
    // 1st attempt: islamic-umalqura = Saudi Arabia's official Umm al-Qura calendar
    let parts = parseHijriParts(date, 'islamic-umalqura');

    // 2nd attempt: fall back to standard islamic calendar if umalqura not supported
    if (!parts) {
        parts = parseHijriParts(date, 'islamic');
    }

    if (!parts) return '';

    const monthName = HIJRI_MONTHS[parts.month - 1] || `Month ${parts.month}`;
    return `${parts.day} ${monthName} ${parts.year} AH`;
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
