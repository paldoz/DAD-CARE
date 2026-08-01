import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { calculateCustomerReliability } from '@/app/utils/ledgerHelpers';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const name = searchParams.get('name');
        
        if (!name) {
            return NextResponse.json({ error: "Please provide a name parameter, e.g., ?name=hamdi" }, { status: 400 });
        }

        const customerQuery = `SELECT id, name FROM "Customer" WHERE name ILIKE $1 OR REPLACE(name, ' ', '') ILIKE REPLACE($1, ' ', '') LIMIT 1`;
        const customerRes = await pool.query(customerQuery, [`%${name}%`]);
        
        if (customerRes.rows.length === 0) {
            return NextResponse.json({ error: `No customer found matching name: ${name}` }, { status: 404 });
        }
        
        const customer = customerRes.rows[0];
        
        const ledgerQuery = `SELECT id, type, amount, created_at, reference_date, customer_id, maqal_id, receipt_id, previous_debt, new_debt FROM "Ledger" WHERE customer_id = $1 AND deleted_at IS NULL ORDER BY COALESCE(reference_date::date, created_at::date) ASC, created_at ASC`;
        const ledgerRes = await pool.query(ledgerQuery, [customer.id]);
        
        const { score, debugMaqals, perfect_maqals, last_completed_reesto } = calculateCustomerReliability(ledgerRes.rows);

        return NextResponse.json({
            success: true,
            results: [{
                customer_name: customer.name,
                calculated_score_from_debug: score,
                perfect_maqals,
                last_completed_reesto,
                maqals: debugMaqals
            }]
        });

    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
