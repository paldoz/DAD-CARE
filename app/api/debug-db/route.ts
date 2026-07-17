import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { validateSession } from '@/lib/sessions-store';

export async function GET(request: Request) {
    const results: any = {};
    
    // Test 1: Count active customers
    try {
        const r = await pool.query('SELECT COUNT(*) FROM "Customer" WHERE deleted_at IS NULL');
        results.active_count = r.rows[0].count;
    } catch (e: any) { results.active_count_error = e.message; }

    // Test 2: Check session from cookie (dadwork_session cookie)
    try {
        const cookieHeader = request.headers.get('cookie') || '';
        // Try both cookie names the app might use
        const tokenMatch = cookieHeader.match(/dadwork_session=([^;]+)/) || 
                           cookieHeader.match(/session=([^;]+)/);
        const token = tokenMatch?.[1];
        if (token) {
            const session = await validateSession(decodeURIComponent(token));
            results.session = session ? { username: session.username, role: session.role } : 'INVALID TOKEN';
        } else {
            results.session = 'NO SESSION COOKIE - cookies: ' + cookieHeader.slice(0, 200);
        }
    } catch (e: any) { results.session_error = e.message; }

    // Test 3: Check AdminSession table count  
    try {
        const r = await pool.query('SELECT COUNT(*) FROM "AdminSession" WHERE expires_at > NOW()');
        results.active_sessions = r.rows[0].count;
    } catch (e: any) { results.adminsession_error = e.message; }

    // Test 4: Run the exact customers query
    try {
        const { rows } = await pool.query(`
            SELECT COUNT(*) as total FROM "Customer" WHERE 1=1
        `);
        results.customers_from_query = rows[0].total;
    } catch (e: any) { results.customers_query_error = e.message; }

    results.timestamp = new Date().toISOString();
    return NextResponse.json(results);
}
