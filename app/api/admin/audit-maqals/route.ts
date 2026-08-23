import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('mode');

    if (!mode || (mode !== 'audit' && mode !== 'apply')) {
        return NextResponse.json({ error: 'Please specify ?mode=audit or ?mode=apply' }, { status: 400 });
    }

    try {
        // 1. Determine exact DailyBook pairs
        const pairsResult = await pool.query(`
            WITH past_dates AS (
                SELECT DISTINCT date::date AS db_date
                FROM "DailyBook"
                WHERE deleted_at IS NULL
            ),
            numbered_dates AS (
                SELECT db_date,
                       ROW_NUMBER() OVER (ORDER BY db_date DESC) as rn
                FROM past_dates
            )
            SELECT date1, date2,
                   ROW_NUMBER() OVER (ORDER BY date2 ASC) as mq_num
            FROM (
                SELECT n2.db_date::date as date1, n1.db_date::date as date2
                FROM numbered_dates n1
                JOIN numbered_dates n2 ON n1.rn = n2.rn - 1
                WHERE n1.rn % 2 = 1
            ) all_pairs
            ORDER BY mq_num ASC;
        `);

        const dateToMqNum = new Map<string, { num: number; pair: any }>();
        for (const pair of pairsResult.rows) {
            const d1 = new Date(pair.date1).toISOString().split('T')[0];
            const d2 = new Date(pair.date2).toISOString().split('T')[0];
            const num = Number(pair.mq_num);
            dateToMqNum.set(d1, { num, pair });
            dateToMqNum.set(d2, { num, pair });
        }

        // 2. Fetch all PRODUCT ledger entries
        const productsResult = await pool.query(`
            SELECT id, customer_id, reference_date, created_at, amount, maqal_id
            FROM "Ledger"
            WHERE type = 'PRODUCT' AND deleted_at IS NULL
        `);

        const audit = {
            meta: {
                timestamp: new Date().toISOString(),
                total_product_rows: productsResult.rows.length,
                total_assigned: 0,
                total_already_correct: 0,
                unassigned_reasons: {} as Record<string, number>
            },
            assignments_needed: [] as any[],
            unassigned: [] as any[]
        };

        for (const p of productsResult.rows) {
            const refDate = new Date(p.reference_date || p.created_at);
            const dateStr = refDate.toISOString().split('T')[0];

            const match = dateToMqNum.get(dateStr);

            if (match) {
                if (p.maqal_id === match.num) {
                    audit.meta.total_already_correct++;
                } else {
                    const d1 = new Date(match.pair.date1).toISOString().split('T')[0];
                    const d2 = new Date(match.pair.date2).toISOString().split('T')[0];
                    audit.assignments_needed.push({
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
