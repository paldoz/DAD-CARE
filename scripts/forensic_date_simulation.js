// Simulate what the browser does when it calls format(parseSafeDate("2026-07-14"), 'dd MMM')
// The key question: does the browser see "14 Jul" or "13 Jul"?
//
// parseSafeDate("2026-07-14") does:
//   dStr.includes('-') && !dStr.includes('T')  → TRUE
//   return new Date("2026-07-14".replace(/-/g, '/'))  → new Date("2026/07/14")
//
// "2026/07/14" is parsed as LOCAL time (not UTC) by JavaScript
// So in any timezone, new Date("2026/07/14") = midnight LOCAL = "14 Jul" locally
//
// BUT: if instead the code used new Date("2026-07-14") (with dashes, no slash),
// THAT would be interpreted as UTC midnight = 2026-07-13T21:00:00 in EAT (+3)
// Which would render as "13 Jul" in EAT.
//
// The current parseSafeDate uses replace(/-/g, '/') which CORRECTLY avoids UTC parsing.
// So the frontend title string should show "14 Jul iyo 15 Jul" correctly.
//
// BUT WAIT: the sort key uses productDates[0] — if productDates are wrong, 
// the SORT order changes, affecting what appears as MQ#1.

// Let's simulate both interpretations:
const dateStr1 = "2026-07-14";
const dateStr2 = "2026-07-15";

// Method 1: replace - with / (current parseSafeDate for YYYY-MM-DD strings)
const d1_slash = new Date(dateStr1.replace(/-/g, '/'));
const d2_slash = new Date(dateStr2.replace(/-/g, '/'));
console.log('=== parseSafeDate with slash replacement (CURRENT CODE) ===');
console.log(`"${dateStr1}" → new Date("2026/07/14") → ${d1_slash.toISOString()} → getDate()=${d1_slash.getDate()} → "14 Jul"`);
console.log(`"${dateStr2}" → new Date("2026/07/15") → ${d2_slash.toISOString()} → getDate()=${d2_slash.getDate()} → "15 Jul"`);
console.log('Result: titleString = "Maqalka Taariikhda 14 Jul iyo 15 Jul" ✅');

// Method 2: if someone used new Date("2026-07-14") - raw ISO date-only (UTC interpretation)
const d1_dash = new Date(dateStr1);  // UTC midnight
const d2_dash = new Date(dateStr2);
console.log('\n=== If code used new Date("YYYY-MM-DD") directly (UTC interpretation) ===');
console.log(`"${dateStr1}" → new Date() → ${d1_dash.toISOString()} → in EAT(+3): getDate()=${d1_dash.getDate()} → day=${new Date(d1_dash.getTime() - 3*3600000).getDate()}`);
console.log('Note: In EAT browser, getDate() returns 14 because JS .getDate() uses LOCAL timezone');
console.log('So even without slash fix, in EAT the date shows correctly.');

// THE REAL QUESTION: What does date-fns format() do?
// date-fns format uses the system local time (same as Date.getDate())
// So it depends on the timezone of the browser running the code.

// Let's check the ADJUSTMENT row — it has reference_date = 2026-07-18
// and maqal_id = 9. This means it appears in the MQ#1 group.
// The ADJUSTMENT row's date is July 18, which is AFTER July 15.
// But the group is sorted by productDates[0] (July 14), so sortDate = July 14.
// The titleString should correctly say "14 Jul iyo 15 Jul".

// CRITICAL: Let me check the ACTUAL titleString computation for MQ#1
// entries array sorted NEWEST FIRST (because of the sort in the code)
const mq1Entries = [
    { id: 'a8edb06c', type: 'PRODUCT', reference_date: '2026-07-14', created_at: '2026-07-18T07:41:22.369Z', amount: 350, kg: 10 },
    { id: 'fb95fb4a', type: 'PRODUCT', reference_date: '2026-07-15', created_at: '2026-07-18T07:41:23.369Z', amount: 350, kg: 10 },
    { id: 'b6663525', type: 'ADJUSTMENT', reference_date: '2026-07-18', created_at: '2026-07-18T07:41:21.369Z', amount: 1817, kg: null },
];

// Simulate the sort in processedReceipts:
// sorted by created_at DESCENDING
const sorted = [...mq1Entries].sort((a, b) => {
    const ta = new Date(a.created_at || a.reference_date).getTime();
    const tb = new Date(b.created_at || b.reference_date).getTime();
    if (ta !== tb) return tb - ta;
    return a.id.localeCompare(b.id);
});

console.log('\n=== MQ#1 group sorted NEWEST FIRST (by created_at DESC) ===');
sorted.forEach(r => console.log(`  [${r.type}] date=${r.reference_date} created=${r.created_at}`));

const last = sorted[0];  // most recent = fb95fb4a (July 15 PRODUCT, created 07:41:23)
const first = sorted[sorted.length - 1]; // oldest = b6663525 (ADJUSTMENT July 18, created 07:41:21)

console.log(`\n  last (sorted[0])  = [${last.type}] date=${last.reference_date} created=${last.created_at}`);
console.log(`  first (sorted[-1]) = [${first.type}] date=${first.reference_date} created=${first.created_at}`);

// productDates = PRODUCT rows only
const productDates = sorted.filter(t => t.type === 'PRODUCT').map(t => {
    const dStr = t.reference_date;
    // parseSafeDate: since it's "YYYY-MM-DD" (no T), use slash replacement
    return new Date(dStr.replace(/-/g, '/'));
});
productDates.sort((a, b) => a.getTime() - b.getTime());

console.log('\n=== productDates (PRODUCT rows, sorted ASC) ===');
productDates.forEach(d => {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const day = String(d.getDate()).padStart(2, '0');
    const mon = months[d.getMonth()];
    console.log(`  ${d.toISOString()} → "${day} ${mon}"`);
});

const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const uniqueDates = [...new Set(productDates.map(d => {
    const day = String(d.getDate()).padStart(2, '0');
    return `${day} ${months[d.getMonth()]}`;
}))];
console.log(`\nuniqueDates = [${uniqueDates.join(', ')}]`);
if (uniqueDates.length === 2) {
    console.log(`titleString = "Maqalka Taariikhda ${uniqueDates[0]} iyo ${uniqueDates[1]}"`);
} else if (uniqueDates.length === 1) {
    console.log(`titleString = "Maqalka Taariikhda ${uniqueDates[0]}" ← ONLY 1 DATE SHOWN!`);
}

// KEY INSIGHT: check if ADJUSTMENT is being grouped with MQ#1
console.log('\n================================================================');
console.log('CRITICAL: Is the ADJUSTMENT row causing a date-display issue?');
console.log('================================================================');
console.log('The ADJUSTMENT row for MQ#1 (maqal_id=9) has reference_date=2026-07-18.');
console.log('It is NOT a PRODUCT, so it does NOT appear in productDates.');
console.log('So uniqueDates = ["14 Jul", "15 Jul"] → title shows BOTH dates correctly.');
console.log('');
console.log('CONCLUSION: The title string IS correct in the Node.js simulation.');
console.log('');
console.log('THE REAL BUG must be elsewhere. Possibilities:');
console.log('1. The browser timezone causes date shift (e.g. UTC browser sees "13 Jul" for "2026-07-14" ISO)');
console.log('2. The grouping is incorrect (MQ#1 somehow appears as one-date group)');
console.log('3. The customer profile is fetching different data than expected');
console.log('4. A frontend filter is removing some rows before grouping');
