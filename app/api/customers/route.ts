import pool from '@/lib/db';
import { groupTransactionsInfoReceipts, Transaction } from '@/app/utils/ledgerHelpers';
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit';
import { requireSession } from '@/lib/require-session';
import { revalidatePath, revalidateTag } from 'next/cache';
import bcrypt from 'bcryptjs';
import { unstable_cache } from 'next/cache';
import { trackApiRoute } from '@/lib/egress-tracker';

import { getAllCustomerStats } from '@/app/utils/rankHelpers';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const customerSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    customer_code: z.string().optional().nullable(),
    gender: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
});

async function getCustomers(options: {
    maqalD1?: string | null;
    maqalD2?: string | null;
    maxAllTimeDate?: string | null;
    page?: number;
    limit?: number;
    search?: string | null;
    tab?: string | null;
    sort?: string | null;
    username?: string | null;
}) {
    const { maqalD1, maqalD2, maxAllTimeDate, page = 1, limit = 20, search, tab = 'active', sort, username } = options;
    const offset = (page - 1) * limit;

    const stats = await getAllCustomerStats(pool);
    const jsScoresCte = `
        js_scores (customer_id, reliability_score, perfect_maqals, last_completed_reesto, rank_maqal) AS (
            VALUES 
            ${stats.length > 0 ? stats.map((s: any) => `('${s.id}'::text, ${s.pct}::int, ${s.perfect_maqals}::int, ${s.last_completed_reesto}::numeric, ${s.rank_maqal}::int)`).join(',\n            ') : `(NULL::text, 0::int, 0::int, 0::numeric, 0::int)`}
        ),
        reliability_scores AS (
            SELECT customer_id, reliability_score, last_completed_reesto, rank_maqal FROM js_scores WHERE customer_id IS NOT NULL
        ),
        gs_scores AS (
            SELECT customer_id, perfect_maqals FROM js_scores WHERE customer_id IS NOT NULL
        ),
    `;

    // Add filtering based on search and tab
    let filterCondition = "1=1";
    if (search) {
        // If searching, show all customers regardless of active/inactive tab
        filterCondition = "1=1";
    } else if (tab === 'inactive') {
        filterCondition += " AND c.deleted_at IS NOT NULL";
    } else {
        filterCondition += " AND c.deleted_at IS NULL"; // Ensure active tab hides deleted customers
    }

    let searchCondition = "1=1";
    if (search) {
        searchCondition = `(
            c.name ILIKE $1 
            OR REPLACE(c.name, ' ', '') ILIKE REPLACE($1, ' ', '') 
            OR c.customer_code ILIKE $1
            OR c.phone ILIKE $1
            OR REPLACE(c.phone, ' ', '') ILIKE REPLACE($1, ' ', '')
        )`;
    }

    // Add sorting logic
    let orderClause = "ORDER BY CASE WHEN c.customer_code ~ '^[0-9]+$' THEN c.customer_code::int ELSE 9999 END ASC, c.name ASC";
    if (tab === 'inactive' && !search) {
        orderClause = "ORDER BY c.deleted_at DESC NULLS LAST"; // Show recently deleted at the top
    }

    let priorityJoin = "";
    if (sort === 'priority' && username) {
        // Use the User table's assigned_customer_ids array to determine priority.
        // This is the canonical source of truth (set in Settings → Users).
        const safeUsername = username.replace(/'/g, "''");
        priorityJoin = `LEFT JOIN LATERAL (
            SELECT (u.assigned_customer_ids @> ARRAY[c.id::text]) AS is_priority
            FROM "User" u WHERE u.username = '${safeUsername}' LIMIT 1
        ) prio ON true`;
        orderClause = "ORDER BY CASE WHEN prio.is_priority = true THEN 0 ELSE 1 END ASC, CASE WHEN c.customer_code ~ '^[0-9]+$' THEN c.customer_code::int ELSE 9999 END ASC, c.name ASC";
    }
    else if (sort === 'best_lacag' || sort === 'best') orderClause = "ORDER BY (COALESCE(lk.total_ledger_debt, 0) - COALESCE(p.total_paid, 0)) ASC, COALESCE(p.total_paid, 0) DESC NULLS LAST";
    else if (sort === 'worst_lacag' || sort === 'worst') orderClause = "ORDER BY (COALESCE(lk.total_ledger_debt, 0) - COALESCE(p.total_paid, 0)) DESC NULLS LAST";
    else if (sort === 'best_maqal') {
        if (maqalD1 && maqalD2) {
            orderClause = `ORDER BY CASE WHEN COALESCE(sms.maqal_total, 0) > 0 THEN 0 ELSE 1 END ASC, selected_maqal_pct DESC, c.created_at ASC, c.id ASC`;
        } else {
            // Rule 8: Use the single global ranking engine for standard sorting
            orderClause = `ORDER BY rs.rank_maqal ASC NULLS LAST`;
        }
    }
    else if (sort === 'worst_maqal') {
        if (maqalD1 && maqalD2) {
            orderClause = `ORDER BY CASE WHEN COALESCE(sms.maqal_total, 0) > 0 THEN 0 ELSE 1 END ASC, selected_maqal_pct ASC, c.created_at DESC, c.id DESC`;
        } else {
            // Rule 8: Use the single global ranking engine for standard sorting
            orderClause = `ORDER BY rs.rank_maqal DESC NULLS LAST`;
        }
    }
    else if (sort === 'most_paid') orderClause = "ORDER BY total_paid DESC NULLS LAST";
    else if (sort === 'least_paid') orderClause = "ORDER BY total_paid ASC NULLS LAST";
    else if (sort === 'most_kg') orderClause = "ORDER BY total_kg DESC NULLS LAST";
    else if (sort === 'least_kg') orderClause = "ORDER BY total_kg ASC NULLS LAST";

    const query = `
        -- ── PAIR EPOCH = 2026-06-28. offset = CURRENT_DATE - epoch ─────────────────
        WITH target_pair AS (
            SELECT
                ('2026-06-28'::date + (
                    GREATEST(0, ((NOW() AT TIME ZONE 'Africa/Mogadishu')::date - '2026-06-28'::date) - 2) / 2 * 2
                )::int * '1 day'::interval)::date AS date1,
                ('2026-06-28'::date + (
                    GREATEST(0, ((NOW() AT TIME ZONE 'Africa/Mogadishu')::date - '2026-06-28'::date) - 2) / 2 * 2 + 1
                )::int * '1 day'::interval)::date AS date2
        ),
        prev_pair AS (
            SELECT
                ('2026-06-28'::date + (
                    GREATEST(0, ((NOW() AT TIME ZONE 'Africa/Mogadishu')::date - '2026-06-28'::date) - 2) / 2 * 2 - 2
                )::int * '1 day'::interval)::date AS date1,
                ('2026-06-28'::date + (
                    GREATEST(0, ((NOW() AT TIME ZONE 'Africa/Mogadishu')::date - '2026-06-28'::date) - 2) / 2 * 2 - 1
                )::int * '1 day'::interval)::date AS date2
        ),
        latest_product_receipt_raw AS (
            SELECT 
                customer_id,
                MIN(created_at) as first_receipt_created_at,
                MAX(created_at) as last_receipt_created_at
            FROM "Ledger"
            WHERE type = 'PRODUCT' AND deleted_at IS NULL 
            AND COALESCE(reference_date::date, created_at::date) IN (SELECT date1 FROM target_pair UNION SELECT date2 FROM target_pair)
            GROUP BY customer_id
        ),
        latest_product_next_receipts AS (
            SELECT DISTINCT ON (l.customer_id) 
                l.customer_id, l.created_at
            FROM "Ledger" l
            JOIN latest_product_receipt_raw lpr ON l.customer_id = lpr.customer_id
            WHERE l.type = 'PRODUCT' AND l.deleted_at IS NULL AND l.created_at > lpr.last_receipt_created_at
            ORDER BY l.customer_id, l.created_at ASC
        ),
        latest_product_receipt AS (
            SELECT 
                lpr.customer_id,
                lpr.first_receipt_created_at,
                lpr.last_receipt_created_at,
                COALESCE(nr.created_at, 'infinity'::timestamp) as next_receipt_created_at
            FROM latest_product_receipt_raw lpr
            LEFT JOIN latest_product_next_receipts nr ON lpr.customer_id = nr.customer_id
        ),
        latest_maqal_stats AS (
            SELECT 
                lpr.customer_id,
                SUM(l.amount)::float as maqal_total
            FROM latest_product_receipt lpr
            JOIN "Ledger" l ON l.customer_id = lpr.customer_id 
                AND l.type = 'PRODUCT' 
                AND l.deleted_at IS NULL
                AND COALESCE(l.reference_date::date, l.created_at::date) IN (SELECT date1 FROM target_pair UNION SELECT date2 FROM target_pair)
            GROUP BY lpr.customer_id
        ),
        latest_prev_debt AS (
            SELECT
                customer_id,
                SUM(amount)::float as prev_debt
            FROM "Ledger"
            WHERE type = 'PRODUCT' AND deleted_at IS NULL
            AND COALESCE(reference_date::date, created_at::date) < (SELECT date1 FROM target_pair)
            GROUP BY customer_id
        ),
        selected_product_receipt_raw AS (
            SELECT 
                customer_id,
                MIN(created_at) as first_receipt_created_at,
                MAX(created_at) as last_receipt_created_at
            FROM "Ledger"
            WHERE type = 'PRODUCT' AND deleted_at IS NULL
            ${maqalD1 && maqalD2 ? `AND COALESCE(reference_date::date, created_at::date) IN ('${maqalD1}', '${maqalD2}')` : `AND 1=0`}
            GROUP BY customer_id
        ),
        selected_product_next_receipts AS (
            SELECT DISTINCT ON (l.customer_id) 
                l.customer_id, l.created_at
            FROM "Ledger" l
            JOIN selected_product_receipt_raw lpr ON l.customer_id = lpr.customer_id
            WHERE l.type = 'PRODUCT' AND l.deleted_at IS NULL AND l.created_at > lpr.last_receipt_created_at
            ORDER BY l.customer_id, l.created_at ASC
        ),
        ${jsScoresCte}
        selected_product_receipt AS (
            SELECT 
                spr.customer_id,
                spr.first_receipt_created_at,
                spr.last_receipt_created_at,
                COALESCE(nr.created_at, 'infinity'::timestamp) as next_receipt_created_at
            FROM selected_product_receipt_raw spr
            LEFT JOIN selected_product_next_receipts nr ON spr.customer_id = nr.customer_id
        ),
        selected_maqal_stats AS (
            SELECT 
                spr.customer_id,
                SUM(CASE WHEN l.type = 'PRODUCT' THEN l.amount ELSE 0 END)::float as maqal_total
            FROM selected_product_receipt spr
            JOIN "Ledger" l ON l.customer_id = spr.customer_id 
                AND l.type IN ('PRODUCT', 'ADJUSTMENT') 
                AND l.deleted_at IS NULL
                ${maqalD1 && maqalD2 ? `AND COALESCE(l.reference_date::date, l.created_at::date) IN ('${maqalD1}', '${maqalD2}')` : `AND 1=0`}
            GROUP BY spr.customer_id
        ),
        selected_prev_debt AS (
            SELECT
                customer_id,
                SUM(amount)::float as prev_debt
            FROM "Ledger"
            WHERE type IN ('PRODUCT', 'ADJUSTMENT') AND deleted_at IS NULL
            ${maqalD1 && maqalD2 ? `AND COALESCE(reference_date::date, created_at::date) < '${maqalD1}'` : `AND 1=0`}
            GROUP BY customer_id
        ),

        latest_ledger_entries AS (
            SELECT DISTINCT ON (customer_id)
                customer_id,
                new_debt,
                type,
                receipt_id,
                id
            FROM "Ledger"
            WHERE deleted_at IS NULL
            ORDER BY customer_id, created_at DESC, id DESC
        ),
        latest_ledger_with_payment_check AS (
            SELECT 
                l.customer_id,
                l.new_debt,
                l.type,
                false as last_receipt_has_payment
            FROM latest_ledger_entries l
        ),
        base_customers AS (
            SELECT 
                c.id, c.name, c.customer_code, c.gender, c.phone, c.created_at, c.deleted_at
            FROM "Customer" c
            WHERE ${filterCondition} AND ${searchCondition}
        )
        SELECT 
            c.id, c.name, c.customer_code, c.gender, c.phone, c.created_at, c.deleted_at,
            COALESCE(l.new_debt, 0)::float as current_balance,
            COALESCE(l.type, null) as last_transaction_type,
            COALESCE(p.total_paid, 0)::float as total_paid,
            COALESCE(dbk.total_daily_kg, 0)::float as total_kg,
            COALESCE(l.last_receipt_has_payment, false) as last_receipt_has_payment,
            COALESCE(dbk.total_books_count, 0) as total_books_count,
            CASE WHEN ROUND(COALESCE(dbk.total_daily_kg, 0)::numeric, 2) > ROUND(COALESCE(lk.total_ledger_kg, 0)::numeric, 2) THEN 1 ELSE 0 END as unprocessed_books_count,
            CASE
                WHEN COALESCE(td.target_pair_ledger_count, 0) >= 2 THEN true
                WHEN (c.created_at AT TIME ZONE 'Africa/Mogadishu')::date > (SELECT date2 FROM target_pair) THEN true
                ELSE false
            END as is_target_days_done,
            tp.date1::text as pair_date1,
            tp.date2::text as pair_date2,
            CASE WHEN c.deleted_at IS NOT NULL THEN true ELSE false END as is_inactive,
            
            -- Priority 3: Last Completed Reesto (from new reliability logic)
            COALESCE(rs.last_completed_reesto, 0) as last_completed_reesto,
            
            -- Reliability Score
            COALESCE(rs.reliability_score, 0)::int as reliability_score,
            
            -- Global Rank
            COALESCE(rs.rank_maqal, 0)::int as rank_maqal,
            
            -- Priority 4: Perfect Maqals
            COALESCE(gs.perfect_maqals, 0) as perfect_maqals,
            
            -- Latest Maqal
            COALESCE(lms.maqal_total, 0)::float as latest_maqal_total,
            CASE 
                WHEN COALESCE(lms.maqal_total, 0) = 0 THEN 0
                ELSE LEAST(100, ROUND((GREATEST(0, COALESCE(p.total_paid, 0) - COALESCE(lpd.prev_debt, 0)) / lms.maqal_total) * 100))::int
            END as latest_maqal_pct,

            
            -- Selected Maqal (if pair provided)
            COALESCE(sms.maqal_total, 0)::float as selected_maqal_total,
            CASE 
                WHEN COALESCE(sms.maqal_total, 0) = 0 THEN 0
                ELSE LEAST(100, ROUND((GREATEST(0, COALESCE(p.total_paid, 0) - COALESCE(spd.prev_debt, 0)) / sms.maqal_total) * 100))::int
            END as selected_maqal_pct
        FROM base_customers c
        LEFT JOIN latest_ledger_with_payment_check l ON c.id = l.customer_id
        LEFT JOIN (
            SELECT customer_id, SUM(amount) as total_paid
            FROM "Ledger"
            WHERE type = 'PAYMENT' AND deleted_at IS NULL
            ${maxAllTimeDate ? `AND COALESCE(reference_date::date, created_at::date) <= '${maxAllTimeDate}'` : ''}
            GROUP BY customer_id
        ) p ON c.id = p.customer_id
        LEFT JOIN (
            SELECT 
                dbi.customer_id,
                COUNT(DISTINCT dbi.id) as total_books_count,
                SUM(dbi.kg) as total_daily_kg
            FROM "DailyBookItem" dbi
            WHERE dbi.kg > 0 AND dbi.deleted_at IS NULL
            GROUP BY dbi.customer_id
        ) dbk ON c.id = dbk.customer_id
        LEFT JOIN (
            SELECT 
                customer_id,
                SUM(kg) as total_ledger_kg,
                SUM(CASE WHEN type = 'PRODUCT' THEN amount ELSE 0 END) as total_ledger_maqal,
                SUM(amount) as total_ledger_debt
            FROM "Ledger"
            WHERE type IN ('PRODUCT', 'ADJUSTMENT') AND deleted_at IS NULL
            ${maxAllTimeDate ? `AND COALESCE(reference_date::date, created_at::date) <= '${maxAllTimeDate}'` : ''}
            GROUP BY customer_id
        ) lk ON c.id = lk.customer_id
        LEFT JOIN (
            SELECT
                customer_id,
                COUNT(DISTINCT COALESCE((reference_date AT TIME ZONE 'Africa/Mogadishu')::date, (created_at AT TIME ZONE 'Africa/Mogadishu')::date)) as target_pair_ledger_count
            FROM "Ledger"
            WHERE type = 'PRODUCT' AND deleted_at IS NULL
              AND COALESCE((reference_date AT TIME ZONE 'Africa/Mogadishu')::date, (created_at AT TIME ZONE 'Africa/Mogadishu')::date)
                    IN (SELECT date1 FROM target_pair UNION SELECT date2 FROM target_pair)
            GROUP BY customer_id
        ) td ON c.id = td.customer_id
        LEFT JOIN target_pair tp ON true
        LEFT JOIN latest_maqal_stats lms ON c.id = lms.customer_id
        LEFT JOIN latest_prev_debt lpd ON c.id = lpd.customer_id
        LEFT JOIN selected_maqal_stats sms ON c.id = sms.customer_id
        LEFT JOIN selected_prev_debt spd ON c.id = spd.customer_id

        LEFT JOIN gs_scores gs ON c.id::text = gs.customer_id::text
        LEFT JOIN reliability_scores rs ON c.id::text = rs.customer_id::text
        ${priorityJoin}
        ${orderClause}
        LIMIT $${search ? '2' : '1'} OFFSET $${search ? '3' : '2'};
    `;

    const values: any[] = [];
    if (search) {
        values.push(`%${search}%`);
    }
    values.push(limit);
    values.push(offset);

    const { rows } = await pool.query(query, values);
    
    // PERFECT LABEL SYNC LOGIC
    if (rows.length > 0) {
        const customerIds = rows.map(c => c.id);
        const ledgerResult = await pool.query(
            `SELECT * FROM "Ledger" WHERE customer_id = ANY($1) AND deleted_at IS NULL ORDER BY created_at ASC`,
            [customerIds]
        );
        const ledgerRows = ledgerResult.rows;
        for (const c of rows) {
            const custTxns = ledgerRows.filter(r => r.customer_id === c.id) as Transaction[];
            if (custTxns.length > 0) {
                let groups = groupTransactionsInfoReceipts(custTxns);
                if (maqalD1 || maqalD2) {
                    groups = groups.filter(g => {
                        const mDate = String(g.mainDate);
                        return (maqalD1 && mDate.includes(maqalD1)) || (maqalD2 && mDate.includes(maqalD2));
                    });
                }
                if (groups.length > 0) {
                    c.last_receipt_has_payment = groups[0].totalPaid > 0;
                } else {
                    c.last_receipt_has_payment = false;
                }
            } else {
                c.last_receipt_has_payment = false;
            }
        }
    }

    return rows;
}

const getCachedCustomersLite = unstable_cache(
    async () => {
        // ✅ Use DISTINCT ON JOIN instead of correlated subquery — fixes N+1 egress bug.
        // Old query ran 1 extra DB query per customer (e.g. 50 customers = 50 extra queries).
        const query = `
            WITH latest_balances AS (
                SELECT DISTINCT ON (customer_id)
                    customer_id, new_debt
                FROM "Ledger"
                WHERE deleted_at IS NULL
                ORDER BY customer_id, created_at DESC, id DESC
            )
            SELECT 
                c.id, c.name, c.customer_code, c.phone, c.is_kabarka, c.is_unassignable,
                COALESCE(lb.new_debt, 0)::float as current_balance,
                CASE WHEN c.deleted_at IS NOT NULL THEN true ELSE false END as is_inactive
            FROM "Customer" c
            LEFT JOIN latest_balances lb ON c.id = lb.customer_id
            -- Removed WHERE c.deleted_at IS NULL so lite search returns all customers including inactive
            ORDER BY
                CASE WHEN c.customer_code ~ '^[0-9]+$' THEN c.customer_code::int ELSE 9999 END ASC,
                c.name ASC;
        `;
        const { rows } = await pool.query(query);
        return rows;
    },
    ['customers-lite-data'],
    { revalidate: 300, tags: ['customers', 'max'] }
);

const getCachedCustomersLedger = unstable_cache(
    async () => {
        const query = `
            WITH target_pair AS (
                SELECT
                    ('2026-06-28'::date + (
                        GREATEST(0, ((NOW() AT TIME ZONE 'Africa/Mogadishu')::date - '2026-06-28'::date) - 2) / 2 * 2
                    )::int * '1 day'::interval)::date AS date1,
                    ('2026-06-28'::date + (
                        GREATEST(0, ((NOW() AT TIME ZONE 'Africa/Mogadishu')::date - '2026-06-28'::date) - 2) / 2 * 2 + 1
                    )::int * '1 day'::interval)::date AS date2
            )
            SELECT
                c.id, c.name, c.customer_code, c.is_kabarka, c.is_unassignable,
                CASE WHEN c.deleted_at IS NOT NULL THEN true ELSE false END as is_inactive,
                COALESCE(dbk.total_books_count, 0) as total_books_count,
                CASE WHEN ROUND(COALESCE(dbk.total_daily_kg, 0)::numeric, 2) > ROUND(COALESCE(lk.total_ledger_kg, 0)::numeric, 2) THEN 1 ELSE 0 END as unprocessed_books_count,
                CASE
                    WHEN COALESCE(td.target_pair_ledger_count, 0) >= 2 THEN true
                    WHEN (c.created_at AT TIME ZONE 'Africa/Mogadishu')::date > (SELECT date2 FROM target_pair) THEN true
                    ELSE false
                END as is_target_days_done
            FROM "Customer" c
            LEFT JOIN (
                SELECT customer_id, COUNT(DISTINCT id) as total_books_count, SUM(kg) as total_daily_kg
                FROM "DailyBookItem" WHERE kg > 0 AND deleted_at IS NULL GROUP BY customer_id
            ) dbk ON c.id = dbk.customer_id
            LEFT JOIN (
                SELECT customer_id, SUM(kg) as total_ledger_kg
                FROM "Ledger" WHERE type = 'PRODUCT' AND deleted_at IS NULL GROUP BY customer_id
            ) lk ON c.id = lk.customer_id
            LEFT JOIN (
                SELECT customer_id,
                    COUNT(DISTINCT COALESCE((reference_date AT TIME ZONE 'Africa/Mogadishu')::date, (created_at AT TIME ZONE 'Africa/Mogadishu')::date)) as target_pair_ledger_count
                FROM "Ledger"
                WHERE type = 'PRODUCT' AND deleted_at IS NULL
                  AND COALESCE((reference_date AT TIME ZONE 'Africa/Mogadishu')::date, (created_at AT TIME ZONE 'Africa/Mogadishu')::date)
                        IN (SELECT date1 FROM target_pair UNION SELECT date2 FROM target_pair)
                GROUP BY customer_id
            ) td ON c.id = td.customer_id
            ORDER BY c.name ASC;
        `;
        const { rows } = await pool.query(query);
        return rows;
    },
    ['customers-ledger-data'],
    { revalidate: 600, tags: ['customers', 'max'] }
);

// Dynamic paginated/sorted data should not be cached on the server, SWR handles it on the client.

export const GET = trackApiRoute('/api/customers', async (request: Request) => {
    const { errorResponse, session } = await requireSession(request);
    if (errorResponse) return errorResponse;
    const { searchParams } = new URL(request.url);
    const isLite = searchParams.get('lite') === 'true';
    const mode = searchParams.get('mode');
    const maqalD1 = searchParams.get('maqal_d1');
    const maqalD2 = searchParams.get('maqal_d2');
    const maxAllTimeDate = searchParams.get('max_all_time_date');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    let search = searchParams.get('search');
    if (!search || search === 'null' || search === 'undefined' || search.trim() === '') {
        search = null;
    }
    const tab = searchParams.get('tab') || 'active';
    const sort = searchParams.get('sort') || null;

    try {
        let customers: any[] = [];
        if (isLite) {
            const customersLite = await getCachedCustomersLite();
            const res = NextResponse.json(customersLite);
            res.headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
            return res;
        }

        if (mode === 'ledger') {
            customers = await getCachedCustomersLedger();

            // Apply the ADMIN assignment filter in the Ledger page (Select Customer dropdown)
            if (session && session.role === 'ADMIN') {
                const assignedCustomerIds = session.assigned_customer_ids || [];
                customers = customers.filter((c: any) => assignedCustomerIds.includes(c.id));
            }

            const res = NextResponse.json(customers);
            res.headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
            return res;
        }

        const usernameForSort = sort === 'priority' ? session?.username : null;
        customers = await getCustomers({ maqalD1, maqalD2, maxAllTimeDate, page, limit, search, tab, sort, username: usernameForSort });

        const res = NextResponse.json(customers);
        res.headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
        return res;
    } catch (error: any) {
        console.error('API Error:', error);
        return NextResponse.json({ 
            error: String(error.message),
            stack: String(error.stack)
        }, { status: 500 });
    }
});

export const POST = trackApiRoute('/api/customers', async (request: Request) => {
    const { errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;
    const body = await request.json();
    const result = customerSchema.safeParse(body);
    if (!result.success) {
        return NextResponse.json({ error: result.error.issues[0].message }, { status: 400 });
    }
    const { name, gender, phone, customer_code: hintCode } = result.data;

    try {
        // ✅ ALWAYS auto-generate a sequential numeric code server-side.
        // This prevents UUID-corrupted codes from ever being stored.
        // The client hint is used ONLY if it is already a valid positive integer.
        let customer_code: string;
        const hintIsValid = hintCode && /^\d+$/.test(hintCode.trim()) && parseInt(hintCode.trim()) > 0;
        if (hintIsValid) {
            customer_code = hintCode!.trim();
        } else {
            // Auto-assign: max existing numeric code + 1
            const { rows } = await pool.query(`
                SELECT COALESCE(MAX(customer_code::int), 0) + 1 as next_code
                FROM "Customer"
                WHERE customer_code ~ '^[0-9]+$' AND LENGTH(customer_code) < 8
            `);
            customer_code = String(rows[0].next_code);
        }

        // Hash default password '123' securely
        const salt = await bcrypt.genSalt(10);
        const hashedDefaultPassword = await bcrypt.hash('123', salt);

        // 1. Create the User account first
        try {
            await pool.query(
                `INSERT INTO "User" (id, username, email, name, password, role, is_active, created_at, updated_at)
                 VALUES (gen_random_uuid(), $1, $2, $3, $4, 'CUSTOMER', true, NOW(), NOW())`,
                [
                    customer_code.toLowerCase().replace(/\s+/g, ''),
                    `${customer_code.toLowerCase().replace(/\s+/g, '')}@dadwork.com`,
                    name,
                    hashedDefaultPassword
                ]
            );
        } catch (userError: any) {
            console.error('Error creating linked user:', userError);
        }

        // 2. Create the Customer record
        const { rows: inserted } = await pool.query(
            `INSERT INTO "Customer" (id, name, customer_code, gender, phone, created_at, updated_at)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
             RETURNING *`,
            [name, customer_code, gender || null, phone || null]
        );

        const data = inserted[0];
        if (!data) throw new Error('Failed to create customer record');
        await logAudit(request, 'CREATE_CUSTOMER', `Created customer ${name} (${customer_code})`);
        revalidatePath('/api/customers');
        revalidatePath('/api/daily-book-init');
        // @ts-ignore
        revalidateTag('customers');
        // @ts-ignore
        revalidateTag('dashboard');
        return NextResponse.json(data);
    } catch (error: any) {
        console.error('Create Customer Error:', error);
        return NextResponse.json({ error: error.message || 'Creation failed' }, { status: 500 });
    }
});

export const DELETE = trackApiRoute('/api/customers', async (request: Request) => {
    const { errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const permanent = searchParams.get('permanent') === 'true';
    const restore = searchParams.get('restore') === 'true';

    try {
        if (restore) {
            // RESTORE: clear deleted_at and assign a clean numeric customer_code if it was corrupted with a UUID
            await pool.query(`
                WITH next_code AS (
                    SELECT COALESCE(MAX(customer_code::int), 0) + 1 as val
                    FROM "Customer"
                    WHERE deleted_at IS NULL 
                      AND customer_code ~ '^[0-9]+$'
                      AND LENGTH(customer_code) < 8
                )
                UPDATE "Customer" 
                SET deleted_at = NULL, 
                    customer_code = CASE 
                        WHEN customer_code LIKE 'del_%' OR LENGTH(customer_code) > 20 THEN (SELECT val::text FROM next_code)
                        ELSE customer_code 
                    END
                WHERE id = $1
            `, [id]);
            await logAudit(request, 'RESTORE_CUSTOMER', `Restored customer ID: ${id}`);
        } else if (permanent) {
            // PERMANENT DELETE: cascade-delete all associated data, then the customer
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await client.query('DELETE FROM "DailyBookItem" WHERE customer_id = $1', [id]);
                await client.query('DELETE FROM "Ledger" WHERE customer_id = $1', [id]);
                await client.query('UPDATE "User" SET assigned_customer_ids = array_remove(assigned_customer_ids, $1) WHERE $1 = ANY(assigned_customer_ids)', [id]);
                await client.query('DELETE FROM "Customer" WHERE id = $1', [id]);
                await client.query('COMMIT');
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }
            await logAudit(request, 'PERMANENT_DELETE_CUSTOMER', `Permanently deleted customer ID: ${id} and all records`);
        } else {
            // SOFT DELETE (default): just sets deleted_at — moves to Inactive tab, history preserved
            const timestamp = new Date().toISOString();
            await pool.query('UPDATE "Customer" SET deleted_at = $1 WHERE id = $2', [timestamp, id]);
            await pool.query('UPDATE "User" SET assigned_customer_ids = array_remove(assigned_customer_ids, $1) WHERE $1 = ANY(assigned_customer_ids)', [id]);
            await logAudit(request, 'DEACTIVATE_CUSTOMER', `Soft-deleted (deactivated) customer ID: ${id}`);
        }

        revalidatePath('/api/customers');
        revalidatePath('/api/daily-book-init');
        // @ts-ignore
        revalidateTag('customers');
        // @ts-ignore
        revalidateTag('dashboard');
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Delete Customer Error:', error);
        return NextResponse.json({ error: error.message || 'Operation failed' }, { status: 500 });
    }
});

export const PATCH = trackApiRoute('/api/customers', async (request: Request) => {
    const { errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const body = await request.json();
    const result = customerSchema.safeParse(body);
    if (!result.success) {
        return NextResponse.json({ error: result.error.issues[0].message }, { status: 400 });
    }
    const { name, gender, phone, customer_code } = result.data;

    try {
        const query = `
            UPDATE "Customer"
            SET name = $1, customer_code = $2, gender = $3, phone = $4
            WHERE id = $5
            RETURNING id, name, customer_code, gender, phone, created_at, deleted_at;
        `;
        const values = [name, customer_code, gender || null, phone || null, id];
        const { rows } = await pool.query(query, values);

        if (rows.length === 0) {
            throw new Error('Customer not found');
        }

        const data = rows[0];

        await logAudit(request, 'UPDATE_CUSTOMER', `Updated customer ${name} (${customer_code})`);
        revalidatePath('/api/customers');
        revalidatePath('/api/daily-book-init');
        // @ts-ignore
        revalidateTag('customers');
        // @ts-ignore
        revalidateTag('dashboard');
        return NextResponse.json(data);
    } catch (error: any) {
        console.error('Update Customer Error:', error);
        return NextResponse.json({ error: error.message || 'Update failed' }, { status: 500 });
    }
});
