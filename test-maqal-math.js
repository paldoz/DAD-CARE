const EPOCH = '2026-06-28';
const epochMs = new Date(`${EPOCH}T00:00:00Z`).getTime();

// Try testing July 17
const todayStr = '2026-07-17';
const todayMs = new Date(`${todayStr}T00:00:00Z`).getTime();
const diffDaysToday = Math.floor((todayMs - epochMs) / 86400000);

const currentPairOffset = Math.floor(diffDaysToday / 2) * 2;
const activePairOffset = Math.max(0, currentPairOffset - 2);
const waitingPairOffset = activePairOffset + 2;

const toDateStr = (offsetDays) => {
    const d = new Date(epochMs + offsetDays * 86400000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

console.log('diffDaysToday:', diffDaysToday);
console.log('activePairOffset:', activePairOffset, '->', toDateStr(activePairOffset), '&', toDateStr(activePairOffset+1));
