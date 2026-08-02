import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import pool from '@/lib/db';
import { getAllCustomerStats } from '@/app/utils/rankHelpers';
import { getCustomers } from '@/app/api/customers/route';

// Vercel Serverless requires writing to /tmp/
const SNAPSHOT_PATH = path.join('/tmp', 'before_optimization_snapshot.json');

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode');

    if (!mode || (mode !== 'save' && mode !== 'compare')) {
        return NextResponse.json({ error: 'Provide ?mode=save or ?mode=compare' }, { status: 400 });
    }

    try {
        console.log(`[Verify Optimization] Starting ${mode}...`);
        
        // 1. Gather stats directly from ranking engine
        const stats = await getAllCustomerStats(pool);
        
        // 2. Gather list payload (tests massive join logic + N+1 payment loop)
        const customersList = await getCustomers({ limit: 1000, page: 1, tab: 'active' });

        // 3. Gather raw ledger totals to verify nothing changed in Ledger aggregation
        const { rows: ledgerTotals } = await pool.query(`
            SELECT customer_id,
                COALESCE(SUM(CASE WHEN type = 'PRODUCT' THEN kg ELSE 0 END), 0)::float as total_kg,
                COALESCE(SUM(CASE WHEN type = 'PAYMENT' THEN amount ELSE 0 END), 0)::float as total_paid
            FROM "Ledger"
            WHERE deleted_at IS NULL
            GROUP BY customer_id
        `);

        // 4. Gather first 200 txns for each customer to verify FIFO order didn't change
        const { rows: first200Txns } = await pool.query(`
            WITH RankedLedger AS (
                SELECT 
                    id, customer_id, type, amount, kg, new_debt, previous_debt,
                    ROW_NUMBER() OVER(PARTITION BY customer_id ORDER BY COALESCE(reference_date::date, created_at::date) DESC, id DESC) as rn
                FROM "Ledger"
                WHERE deleted_at IS NULL
            )
            SELECT * FROM RankedLedger WHERE rn <= 200
        `);

        const currentState = {
            stats: stats.map((s: any) => ({
                id: s.id,
                pct: s.pct,
                rank_maqal: s.rank_maqal,
                perfect_maqals: s.perfect_maqals,
                last_completed_reesto: s.last_completed_reesto,
                debugMaqals: s.debugMaqals, // Captures Last 5 completed Maqals + Every Maqal percentage + Ignored/open Maqal
                current_debt: s.current_debt // Captures Heyn
            })),
            list: customersList.map((c: any) => ({
                id: c.id,
                name: c.name,
                reliability_score: c.reliability_score,
                rank_maqal: c.rank_maqal, // Filter rank, List rank
                total_paid: c.total_paid,
                total_ledger_debt: c.total_ledger_debt,
                last_receipt_has_payment: c.last_receipt_has_payment
            })),
            totals: ledgerTotals.map((t: any) => ({
                id: t.customer_id,
                total_kg: t.total_kg,
                total_paid: t.total_paid
            })),
            history: first200Txns.map((t: any) => ({
                id: t.id,
                customer_id: t.customer_id,
                rn: t.rn, // Exact order
                type: t.type,
                amount: t.amount,
                new_debt: t.new_debt
            }))
        };

        if (mode === 'save') {
            fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(currentState, null, 2), 'utf-8');
            return NextResponse.json({ 
                success: true, 
                message: 'Snapshot saved securely. (Includes Profile, Ranks, List, History, Reesto, Balances, Heyn, Maqals, and Percentages)',
                path: SNAPSHOT_PATH,
                customers_audited: currentState.list.length
            });
        } 
        
        if (mode === 'compare') {
            if (!fs.existsSync(SNAPSHOT_PATH)) {
                return NextResponse.json({ error: 'No snapshot found. Run ?mode=save first.' }, { status: 400 });
            }

            const savedState = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8'));
            
            let differences = 0;
            const mismatched: string[] = [];

            // Compare Stats (Profile, Maqals, Ranks, Reesto, Heyn)
            for (const saved of savedState.stats) {
                const current = currentState.stats.find((s: any) => s.id === saved.id);
                if (!current) { differences++; mismatched.push(`Customer ${saved.id} missing in current stats`); continue; }
                if (JSON.stringify(saved) !== JSON.stringify(current)) {
                    differences++; mismatched.push(`Customer ${saved.id} stats changed: Saved=${JSON.stringify(saved)} Current=${JSON.stringify(current)}`);
                }
            }

            // Compare List (Filter ranks, balances, flags)
            for (const saved of savedState.list) {
                const current = currentState.list.find((c: any) => c.id === saved.id);
                if (!current) { differences++; mismatched.push(`Customer ${saved.id} missing in list`); continue; }
                if (JSON.stringify(saved) !== JSON.stringify(current)) {
                    differences++; mismatched.push(`Customer ${saved.id} list changed: Saved=${JSON.stringify(saved)} Current=${JSON.stringify(current)}`);
                }
            }

            // Compare Totals
            for (const saved of savedState.totals) {
                const current = currentState.totals.find((t: any) => t.id === saved.id);
                if (!current) { differences++; mismatched.push(`Customer ${saved.id} missing in totals`); continue; }
                if (JSON.stringify(saved) !== JSON.stringify(current)) {
                    differences++; mismatched.push(`Customer ${saved.id} totals changed`);
                }
            }

            // Compare History Order & Debt calculation
            for (const saved of savedState.history) {
                const current = currentState.history.find((t: any) => t.id === saved.id);
                if (!current) { differences++; mismatched.push(`Txn ${saved.id} missing in history`); continue; }
                if (JSON.stringify(saved) !== JSON.stringify(current)) {
                    differences++; mismatched.push(`Txn ${saved.id} history changed`);
                }
            }

            return NextResponse.json({
                success: differences === 0,
                customers_audited: currentState.list.length,
                differences_found: differences,
                mismatched_details: mismatched.slice(0, 50) // limit to top 50
            });
        }

    } catch (err: any) {
        console.error('Verification Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
