import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { recalculateCustomerLedger } from '@/lib/ledger-utils';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Find recent payments of $280 and $210
        const { rows: payments } = await client.query(
            `SELECT * FROM "Ledger" WHERE type = 'PAYMENT' AND amount IN (280, 210) AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 10`
        );
        
        if (payments.length === 0) return NextResponse.json({ error: 'No $280 or $210 payments found' });
        
        const customerId = payments[0].customer_id;
        
        // Find Maqal #5 (Product transaction around Jul 22-23 for this customer)
        const { rows: products } = await client.query(
            `SELECT id, maqal_id, reference_date FROM "Ledger" WHERE type = 'PRODUCT' AND customer_id = $1 AND deleted_at IS NULL AND reference_date >= '2026-07-22' AND reference_date <= '2026-07-23' ORDER BY created_at ASC LIMIT 1`,
            [customerId]
        );
        
        if (products.length === 0) {
            return NextResponse.json({ error: 'Could not find product entries for 22/23 Jul to determine Maqal ID.' });
        }
        
        const targetMaqalId = products[0].maqal_id;
        
        if (targetMaqalId == null) {
            return NextResponse.json({ error: 'The Maqal for 22/23 Jul does not have a database maqal_id assigned. Please create a payment for it normally first or use receipt_id mapping.' });
        }
        
        let count = 0;
        for (const p of payments) {
            if (p.amount === 280 || p.amount === 210) {
                await client.query(`UPDATE "Ledger" SET maqal_id = $1 WHERE id = $2`, [targetMaqalId, p.id]);
                count++;
            }
        }
        
        await recalculateCustomerLedger(customerId, client);
        await client.query('COMMIT');
        
        return NextResponse.json({ success: true, message: `Fixed! Successfully moved ${count} payments to Maqal ID ${targetMaqalId} (MQ#5)` });
    } catch (e: any) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: e.message });
    } finally {
        client.release();
    }
}
