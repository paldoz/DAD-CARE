import pool from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET() {
    try {
        const countRes = await pool.query('SELECT COUNT(*) FROM "Customer" WHERE deleted_at IS NULL');
        const count = countRes.rows[0].count;
        
        // Show partial DB URL to confirm which DB Vercel is using
        const dbUrl = process.env.DATABASE_URL || 'NOT SET';
        const masked = dbUrl.length > 30 ? dbUrl.substring(0, 50) + '...' : dbUrl;
        
        return NextResponse.json({ 
            customer_count: count,
            db_url_start: masked,
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
