import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-session';
import { getRouteStats } from '@/lib/egress-tracker';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { errorResponse } = await requireSuperAdmin(request);
    if (errorResponse) return errorResponse;

    const stats = getRouteStats();
    return NextResponse.json(stats);
}
