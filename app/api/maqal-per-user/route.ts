import { NextResponse, NextRequest } from 'next/server';
import pool from '@/lib/db';
import { requireSession } from '@/lib/require-session';
import { trackApiRoute } from '@/lib/egress-tracker';

export const dynamic = 'force-dynamic'; // Always fetch fresh — no caching

// Returns per-user maqal progress based on assigned_customer_ids.
//
// PAIR LOGIC (updated):
//   EPOCH = 2026-06-28. Each pair is 2 days.
//   offset = days since epoch in Africa/Mogadishu time.
//
//   current pair = floor(offset / 2) * 2   → pair that INCLUDES today
//   ACTIVE pair  = current pair - 2         → the pair BEFORE today (users must have processed this)
//   WAITING pair = current pair             → the next pair users will work on
//
//   AUTO-ADVANCE: The active pair advances from (ACTIVE→WAITING) only when
//   a DailyBook entry exists for (waitingPairDay2 + 1 day), i.e. the day AFTER
//   the waiting pair ends. Until then the tracker stays locked on the ACTIVE pair.
//
//   Example (today = Jul 5, offset=7):
//     currentPairOffset = 6  → Jul 4 & Jul 5
//     ACTIVE pair offset = 4  → Jul 2 & Jul 3  ← tracker focuses here
//     WAITING pair offset = 6 → Jul 4 & Jul 5  ← shown as "coming next"
//     Auto-advance fires when DailyBook has a Jul 6 entry (offset 8)

async function getMaqalData() {
        // 1. Get all users with assigned_customer_ids
        const { rows: users } = await pool.query(`
            SELECT id, username, name, assigned_customer_ids
            FROM "User"
            WHERE assigned_customer_ids IS NOT NULL 
              AND array_length(assigned_customer_ids, 1) > 0
        `);

        if (users.length === 0) {
            return { users: [] };
        }

        // 2. Compute pair offsets
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Africa/Mogadishu',
            year: 'numeric', month: '2-digit', day: '2-digit'
        });
        const todayStr = formatter.format(new Date());
        const EPOCH = '2026-06-28';
        const epochMs = new Date(`${EPOCH}T00:00:00Z`).getTime();
        const todayMs = new Date(`${todayStr}T00:00:00Z`).getTime();
        const diffDaysToday = Math.floor((todayMs - epochMs) / 86400000);

        const currentPairOffset = Math.floor(diffDaysToday / 2) * 2;
        const activePairOffset = Math.max(0, currentPairOffset - 2);
        const waitingPairOffset = activePairOffset + 2;

        const toDateStr = (offsetDays: number): string => {
            const d = new Date(epochMs + offsetDays * 86400000);
            const y = d.getUTCFullYear();
            const m = String(d.getUTCMonth() + 1).padStart(2, '0');
            const day = String(d.getUTCDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };

        const activePairDate1 = toDateStr(activePairOffset);
        const activePairDate2 = toDateStr(activePairOffset + 1);
        const waitingPairDate1 = toDateStr(waitingPairOffset);
        const waitingPairDate2 = toDateStr(waitingPairOffset + 1);
        const autoAdvanceTriggerDate = toDateStr(waitingPairOffset + 2);

        const triggerRes = await pool.query(`
            SELECT EXISTS (
                SELECT 1 FROM "DailyBook"
                WHERE deleted_at IS NULL
                  AND (date AT TIME ZONE 'Africa/Mogadishu')::date = $1::date
            ) as has_trigger
        `, [autoAdvanceTriggerDate]);
        const hasAutoAdvanceTrigger = triggerRes.rows[0]?.has_trigger === true;

        let trackerDate1: string;
        let trackerDate2: string;
        let nextDate1: string;
        let nextDate2: string;

        if (hasAutoAdvanceTrigger) {
            trackerDate1 = waitingPairDate1;
            trackerDate2 = waitingPairDate2;
            nextDate1 = toDateStr(waitingPairOffset + 2);
            nextDate2 = toDateStr(waitingPairOffset + 3);
        } else {
            trackerDate1 = activePairDate1;
            trackerDate2 = activePairDate2;
            nextDate1 = waitingPairDate1;
            nextDate2 = waitingPairDate2;
        }

        if (!trackerDate1 || !trackerDate2) {
            return { users: [], date1: null, date2: null };
        }

        const allAssignedIds = [...new Set(users.flatMap((u: any) => u.assigned_customer_ids || []))];

        const { rows: customerData } = await pool.query(`
            SELECT 
                c.id,
                c.name,
                c.customer_code,
                (
                    SELECT COUNT(DISTINCT COALESCE(prod.reference_date::date, prod.created_at::date))
                    FROM "Ledger" prod
                    WHERE prod.customer_id = c.id
                      AND prod.type = 'PRODUCT'
                      AND prod.deleted_at IS NULL
                      AND COALESCE(prod.reference_date::date, prod.created_at::date) IN ($1::date, $2::date)
                ) >= 2 as is_processed
            FROM "Customer" c
            WHERE c.id = ANY($3::text[])
              AND c.deleted_at IS NULL
        `, [trackerDate1, trackerDate2, allAssignedIds]);

        const customerMap = new Map(customerData.map((c: any) => [c.id, c]));

        const perUserData = users.map((user: any) => {
            const assignedIds: string[] = user.assigned_customer_ids || [];
            const customers = assignedIds
                .map((id: string) => customerMap.get(id))
                .filter(Boolean)
                .map((c: any) => ({
                    id: c.id,
                    name: c.name,
                    customer_code: c.customer_code,
                    has_payment: c.is_processed
                }));

            return {
                user_id: user.id,
                username: user.username,
                total: customers.length,
                solved: customers.filter((c: any) => c.has_payment).length,
                customers: customers.filter((c: any) => !c.has_payment),
            };
        });

        return {
            users: perUserData,
            date1: trackerDate1,
            date2: trackerDate2,
            waitingDate1: nextDate1,
            waitingDate2: nextDate2,
            autoAdvanced: hasAutoAdvanceTrigger,
        };
}

export const GET = trackApiRoute('/api/maqal-per-user', async (request: NextRequest) => {
    try {
        const sessionRes = await requireSession(request);
        if (sessionRes instanceof NextResponse) return sessionRes;

        const data = await getMaqalData();

        const res = NextResponse.json(data);
        res.headers.set('Cache-Control', 'private, max-age=120, stale-while-revalidate=300');
        return res;

    } catch (error: any) {
        console.error('Error fetching per-user maqal:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
