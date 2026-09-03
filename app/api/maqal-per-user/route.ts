import { NextResponse, NextRequest } from 'next/server';
import pool from '@/lib/db';
import { requireSession } from '@/lib/require-session';
import { trackApiRoute } from '@/lib/egress-tracker';
import { fetchAuthoritativeMaqalPairs } from '@/lib/maqal-utils';

export const dynamic = 'force-dynamic'; // Always fetch fresh — no caching

// Returns per-user maqal progress based on assigned_customer_ids.
//
// PAIR LOGIC:
//   Uses authoritative pairs from fetchAuthoritativeMaqalPairs (holiday-aware).
//   current pair = pair that INCLUDES today (or latest pair if today is ahead)
//   ACTIVE pair  = pair immediately before current pair
//   WAITING pair = current pair (or active pair + 1)
//
//   AUTO-ADVANCE: The active pair advances from (ACTIVE→WAITING) only when
//   a DailyBook entry exists for the trigger date (start of the pair after waiting).
//   Until then the tracker stays locked on the ACTIVE pair.

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

        // 2. Load authoritative pairs (single fast batch query, zero N+1)
        const pairs = await fetchAuthoritativeMaqalPairs(pool);
        if (pairs.length === 0) {
            return { users: [], date1: null, date2: null };
        }

        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Africa/Mogadishu',
            year: 'numeric', month: '2-digit', day: '2-digit'
        });
        const todayStr = formatter.format(new Date());

        // Find pair index matching today or closest current pair
        let currentIdx = pairs.findIndex(p => todayStr >= p.date1 && todayStr <= p.date2);
        if (currentIdx === -1) {
            // If today is past the last pair, use the last pair; if before, use first
            currentIdx = todayStr > pairs[pairs.length - 1].date2 ? pairs.length - 1 : 0;
        }

        const activeIdx = Math.max(0, currentIdx - 1);
        const waitingIdx = Math.min(pairs.length - 1, activeIdx + 1);

        const activePair = pairs[activeIdx];
        const waitingPair = pairs[waitingIdx];
        const pairAfterWaiting = waitingIdx + 1 < pairs.length ? pairs[waitingIdx + 1] : null;

        const autoAdvanceTriggerDate = pairAfterWaiting ? pairAfterWaiting.date1 : null;

        let hasAutoAdvanceTrigger = false;
        if (autoAdvanceTriggerDate) {
            const triggerRes = await pool.query(`
                SELECT EXISTS (
                    SELECT 1 FROM "DailyBook"
                    WHERE deleted_at IS NULL
                      AND (date AT TIME ZONE 'Africa/Mogadishu')::date = $1::date
                ) as has_trigger
            `, [autoAdvanceTriggerDate]);
            hasAutoAdvanceTrigger = triggerRes.rows[0]?.has_trigger === true;
        }

        let trackerDate1: string;
        let trackerDate2: string;
        let nextDate1: string | null;
        let nextDate2: string | null;

        if (hasAutoAdvanceTrigger && pairAfterWaiting) {
            trackerDate1 = waitingPair.date1;
            trackerDate2 = waitingPair.date2;
            nextDate1 = pairAfterWaiting.date1;
            nextDate2 = pairAfterWaiting.date2;
        } else {
            trackerDate1 = activePair.date1;
            trackerDate2 = activePair.date2;
            nextDate1 = waitingPair.date1;
            nextDate2 = waitingPair.date2;
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
