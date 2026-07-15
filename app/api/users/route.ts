import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit';
import { requireSuperAdmin, evictSessionCache } from '@/lib/require-session';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

const userSchema = z.object({
    username: z.string().min(3, 'Username must be at least 3 characters'),
    password: z.string().min(4, 'Password must be at least 4 characters'),
    name: z.string().optional().nullable(),
    role: z.string().optional(),
    gender: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    avatar_url: z.string().url().optional().nullable(),
    assigned_customer_ids: z.array(z.string()).optional()
});

export async function GET(request: Request) {
    const { errorResponse } = await requireSuperAdmin(request);
    if (errorResponse) return errorResponse;
    try {
        const { rows } = await pool.query('SELECT id, username, name, role, is_active, gender, phone, CASE WHEN length(avatar_url) > 255 THEN NULL ELSE avatar_url END as avatar_url, assigned_customer_ids, created_at, updated_at FROM "User" ORDER BY created_at DESC');
        const res = NextResponse.json(rows);
        res.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
        return res;
    } catch (error: any) {
        console.error('Fetch Users Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const { errorResponse } = await requireSuperAdmin(request);
    if (errorResponse) return errorResponse;
    const body = await request.json();
    const result = userSchema.safeParse(body);
    if (!result.success) {
        return NextResponse.json({ error: result.error.issues[0].message }, { status: 400 });
    }
    const { username, name, password, role, gender, phone, avatar_url, assigned_customer_ids } = result.data;

    try {

        const { rows: existing } = await pool.query('SELECT id FROM "User" WHERE username = $1', [username]);
        if (existing.length > 0) {
            return NextResponse.json({ error: 'Username already exists' }, { status: 400 });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const { rows: inserted } = await pool.query(
            `INSERT INTO "User" (id, username, email, name, password, role, is_active, gender, phone, avatar_url, assigned_customer_ids, created_at, updated_at)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW()) RETURNING id, username, name, role, is_active, gender, phone, avatar_url, assigned_customer_ids, created_at, updated_at`,
            [
                username,
                `${username}@example.com`,
                name,
                hashedPassword,
                role || 'CUSTOMER',
                true,
                gender || null,
                phone || null,
                (avatar_url && avatar_url.startsWith('data:image')) ? null : (avatar_url || null),
                Array.isArray(assigned_customer_ids) ? assigned_customer_ids : []
            ]
        );

        await logAudit(request, 'CREATE_USER', `Created user ${username} with role ${role || 'CUSTOMER'}`);
        return NextResponse.json(inserted[0]);
    } catch (error: any) {
        console.error('Create User Error:', error);
        return NextResponse.json({ error: error.message || 'Creation failed' }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    const { errorResponse } = await requireSuperAdmin(request);
    if (errorResponse) return errorResponse;
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
        return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    try {
        await pool.query('DELETE FROM "User" WHERE id = $1', [id]);
        await logAudit(request, 'DELETE_USER', `Deleted user ID: ${id}`);
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Delete User Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    const { errorResponse } = await requireSuperAdmin(request);
    if (errorResponse) return errorResponse;
    const body = await request.json();
    const { id, action, pin1, pin2, assigned_customer_ids } = body;

    if (!id) {
        return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    try {
        if (action === 'kickout') {
            // Verify PINs
            if (pin1 !== '1234' || pin2 !== '5678') {
                return NextResponse.json({ error: 'Invalid security PINs' }, { status: 403 });
            }

            // Deactivate user
            await pool.query('UPDATE "User" SET is_active = false, updated_at = NOW() WHERE id = $1', [id]);

            // Kill all their sessions immediately
            const { rows: userRows } = await pool.query('SELECT username FROM "User" WHERE id = $1', [id]);
            if (userRows.length > 0) {
                // Get the tokens before deleting so we can evict cache
                const { rows: sessionRows } = await pool.query('SELECT token FROM "AdminSession" WHERE username = $1', [userRows[0].username]);
                await pool.query('DELETE FROM "AdminSession" WHERE username = $1', [userRows[0].username]);
                // Evict all their tokens from the in-memory session cache
                sessionRows.forEach((s: any) => evictSessionCache(s.token));
            }

            await logAudit(request, 'KICKOUT_USER', `Kicked out user ID: ${id}`);
            return NextResponse.json({ success: true, message: 'User kicked out and all sessions destroyed' });
        }

        if (action === 'allow') {
            // Reactivate user
            await pool.query('UPDATE "User" SET is_active = true, updated_at = NOW() WHERE id = $1', [id]);
            await logAudit(request, 'ALLOW_USER', `Reactivated user ID: ${id}`);
            return NextResponse.json({ success: true, message: 'User reactivated' });
        }

        if (action === 'deny') {
            // Keep user deactivated, nothing to change — just log
            await logAudit(request, 'DENY_USER', `Denied reactivation for user ID: ${id}`);
            return NextResponse.json({ success: true, message: 'User access denied' });
        }

        if (action === 'update_priority') {
            if (!Array.isArray(assigned_customer_ids)) {
                return NextResponse.json({ error: 'assigned_customer_ids must be an array' }, { status: 400 });
            }
            await pool.query(
                'UPDATE "User" SET assigned_customer_ids = $1, updated_at = NOW() WHERE id = $2',
                [assigned_customer_ids, id]
            );
            await logAudit(request, 'UPDATE_USER_PRIORITY', `Updated priority list for user ID: ${id}`);
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error: any) {
        console.error('Patch User Error:', error);
        return NextResponse.json({ error: error.message || 'Update failed' }, { status: 500 });
    }
}
