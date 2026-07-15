import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-session';
import { getEgressStats } from '@/lib/egress-tracker';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { errorResponse } = await requireSuperAdmin(request);
    if (errorResponse) return errorResponse;

    const stats = getEgressStats();
    return NextResponse.json(stats);
}
