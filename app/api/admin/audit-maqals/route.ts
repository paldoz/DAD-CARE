import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requireSession } from '@/lib/require-session';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

import { MAQAL_PAIRS_CTE, validateMaqalPairs } from '@/lib/maqal-utils';

export async function GET(req: NextRequest) {
    const { errorResponse, session } = await requireSession(req);
    if (errorResponse) return errorResponse;

    if (session?.role !== 'SUPER_ADMIN') {
        return NextResponse.json({ error: 'Unauthorized: Super Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('mode');

    if (!mode || (mode !== 'audit' && mode !== 'apply')) {
        return NextResponse.json({ error: 'Please specify ?mode=audit or ?mode=apply' }, { status: 400 });
    }

    try {
        // 1. Determine exact DailyBook pairs (Authoritative Chronological ASC)
        const pairsResult = await pool.query(`
            ${MAQAL_PAIRS_CTE}
            SELECT mq_num, date1::text, date2::text
            FROM pairs
            ORDER BY mq_num ASC;
        `);

        const allPairs = pairsResult.rows.map(r => ({
            mq_num: Number(r.mq_num),
            date1: String(r.date1).split('T')[0],
            date2: String(r.date2).split('T')[0]
        }));
        validateMaqalPairs(allPairs);

        const dateToMqNum = new Map<string, { num: number; pair: any }>();
        for (const pair of allPairs) {
            const d1 = pair.date1;
            const d2 = pair.date2;
            const num = pair.mq_num;
            dateToMqNum.set(d1, { num, pair });
            dateToMqNum.set(d2, { num, pair });
        }

        // 2. Fetch all PRODUCT ledger entries
        const productsResult = await pool.query(`
            SELECT id, customer_id, reference_date, created_at, amount, maqal_id, receipt_id
            FROM "Ledger"
            WHERE type = 'PRODUCT' AND deleted_at IS NULL
        `);

        // 3. Fetch all PAYMENT ledger entries
        const paymentsResult = await pool.query(`
            SELECT id, customer_id, reference_date, created_at, amount, maqal_id, receipt_id
            FROM "Ledger"
            WHERE type = 'PAYMENT' AND deleted_at IS NULL
        `);

        const audit = {
            meta: {
                timestamp: new Date().toISOString(),
                total_product_rows: productsResult.rows.length,
                total_payment_rows: paymentsResult.rows.length,
                total_assigned: 0,
                total_already_correct: 0,
                unassigned_reasons: {} as Record<string, number>
            },
            assignments_needed: [] as any[],
            unassigned: [] as any[]
        };

        const productMqMap = new Map<string, number>(); // ledger_id -> mq_num
        const receiptMqMap = new Map<string, number>(); // receipt_id -> mq_num

        for (const p of productsResult.rows) {
            const refDate = new Date(p.reference_date || p.created_at);
            const dateStr = refDate.toISOString().split('T')[0];

            const match = dateToMqNum.get(dateStr);

            if (match) {
                productMqMap.set(p.id, match.num);
                if (p.receipt_id) receiptMqMap.set(p.receipt_id, match.num);

                if (p.maqal_id === match.num) {
                    audit.meta.total_already_correct++;
                } else {
                    const d1 = new Date(match.pair.date1).toISOString().split('T')[0];
                    const d2 = new Date(match.pair.date2).toISOString().split('T')[0];
                    audit.assignments_needed.push({
                        type: 'PRODUCT',
                        ledger_id: p.id,
                        customer_id: p.customer_id,
                        reference_date: dateStr,
                        amount: p.amount,
                        old_maqal_id: p.maqal_id,
                        new_maqal_id: match.num,
                        evidence: 'Matched DailyBook date ' + dateStr + ' belonging to MQ#' + match.num + ' (Pair: ' + d1 + ' - ' + d2 + ')'
                    });
                    audit.meta.total_assigned++;
                }
            } else {
                audit.unassigned.push({
                    type: 'PRODUCT',
                    ledger_id: p.id,
                    customer_id: p.customer_id,
                    reference_date: dateStr,
                    amount: p.amount,
                    old_maqal_id: p.maqal_id,
                    reason: 'No matching DailyBook pair found for date ' + dateStr
                });
                audit.meta.unassigned_reasons[dateStr] = (audit.meta.unassigned_reasons[dateStr] || 0) + 1;
            }
        }

        // Align PAYMENT records
        for (const pay of paymentsResult.rows) {
            let targetMqNum: number | null = null;

            if (pay.receipt_id && receiptMqMap.has(pay.receipt_id)) {
                targetMqNum = receiptMqMap.get(pay.receipt_id)!;
            } else if (pay.maqal_id != null && pay.maqal_id >= 1 && pay.maqal_id <= pairsResult.rows.length) {
                targetMqNum = pay.maqal_id;
            }

            if (targetMqNum != null) {
                if (pay.maqal_id === targetMqNum) {
                    audit.meta.total_already_correct++;
                } else {
                    audit.assignments_needed.push({
                        type: 'PAYMENT',
                        ledger_id: pay.id,
                        customer_id: pay.customer_id,
                        reference_date: pay.reference_date,
                        amount: pay.amount,
                        old_maqal_id: pay.maqal_id,
                        new_maqal_id: targetMqNum,
                        evidence: 'Linked via receipt_id / authoritative pair to MQ#' + targetMqNum
                    });
                    audit.meta.total_assigned++;
                }
            }
        }

        if (mode === 'apply') {
            const confirmation = searchParams.get('confirm');
            if (confirmation !== 'yes') {
                return NextResponse.json({
                    error: 'Safety check: to apply changes, you must pass ?mode=apply&confirm=yes',
                    audit_preview: audit
                });
            }

            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                for (const change of audit.assignments_needed) {
                    await client.query(
                        'UPDATE "Ledger" SET maqal_id = $1 WHERE id = $2',
                        [change.new_maqal_id, change.ledger_id]
                    );
                }

                await client.query('COMMIT');
                return NextResponse.json({
                    success: true,
                    message: 'Successfully migrated ' + audit.assignments_needed.length + ' records.',
                    audit
                });
            } catch (e) {
                await client.query('ROLLBACK');
                throw e;
            } finally {
                client.release();
            }
        }

        // Return audit JSON
        return new NextResponse(JSON.stringify(audit, null, 2), {
            headers: {
                'Content-Type': 'application/json',
                'Content-Disposition': 'attachment; filename="maqal_migration_audit.json"'
            }
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
