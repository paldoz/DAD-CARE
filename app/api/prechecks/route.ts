import { NextResponse } from 'next/server';
import { Pool } from 'pg';

export async function GET() {
    let tempPool;
    try {
        tempPool = new Pool({
            connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });

        const constraintCheck = await tempPool.query(`
            SELECT conname
            FROM pg_constraint
            WHERE conname = 'Customer_customer_code_key';
        `);

        const indexCheck = await tempPool.query(`
            SELECT indexname
            FROM pg_indexes
            WHERE indexname = 'Customer_customer_code_key';
        `);

        const duplicateCheck = await tempPool.query(`
            SELECT customer_code, COUNT(*) as count
            FROM "Customer"
            WHERE deleted_at IS NULL
            GROUP BY customer_code
            HAVING COUNT(*) > 1;
        `);

        return NextResponse.json({
            isConstraint: constraintCheck.rows.length > 0,
            isIndex: indexCheck.rows.length > 0,
            duplicates: duplicateCheck.rows,
            duplicateCount: duplicateCheck.rows.length
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 });
    } finally {
        if (tempPool) await tempPool.end();
    }
}
