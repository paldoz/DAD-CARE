import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit';
import { requireSuperAdmin } from '@/lib/require-session';
import bcrypt from 'bcryptjs';

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { errorResponse } = await requireSuperAdmin(request);
    if (errorResponse) return errorResponse;
    const { id } = await params;
    const body = await request.json();

    try {
        let updateFields: string[] = [];
        let values: any[] = [];
        let index = 1;

        for (const [key, value] of Object.entries(body)) {
            if (key === 'password' && typeof value === 'string' && value.length > 0) {
                const salt = await bcrypt.genSalt(10);
                const hashedPassword = await bcrypt.hash(value, salt);
                updateFields.push(`"${key}" = $${index}`);
                values.push(hashedPassword);
                index++;
            } else if (key !== 'password') {
                updateFields.push(`"${key}" = $${index}`);
                if (key === 'avatar_url' && typeof value === 'string' && value.length > 100000) {
                    values.push(null);
                } else {
                    values.push(key === 'assigned_customer_ids' && Array.isArray(value) ? value : value);
                }
                index++;
            }
        }
        
        if (updateFields.length === 0) {
            return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
        }

        values.push(id);
        const query = `UPDATE "User" SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = $${index} RETURNING id, username, role, name, is_active, avatar_url, created_at, assigned_customer_ids`;
        
        const { rows } = await pool.query(query, values);

        if (rows.length === 0) throw new Error('User not found');

        await logAudit(request, 'UPDATE_USER', `Updated user ID: ${id}`);
        return NextResponse.json(rows[0]);
    } catch (error: any) {
        console.error('Update User Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { errorResponse } = await requireSuperAdmin(request);
    if (errorResponse) return errorResponse;
    const { id } = await params;

    try {
        const { rows } = await pool.query('SELECT id, username, role, name, is_active, avatar_url, created_at, assigned_customer_ids FROM "User" WHERE id = $1', [id]);
        if (rows.length === 0) throw new Error('User not found');
        return NextResponse.json(rows[0]);
    } catch (error: any) {
        console.error('Fetch User Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
