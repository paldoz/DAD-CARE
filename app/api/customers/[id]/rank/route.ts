import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/require-session';
import { trackApiRoute } from '@/lib/egress-tracker';
import { getAllCustomerStats, getCachedAllCustomerStats } from '@/app/utils/rankHelpers';

export const dynamic = 'force-dynamic';

export const GET = trackApiRoute('/api/customers/[id]/rank', async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const { errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;

    try {
        const stats = await getCachedAllCustomerStats();
        const target = stats.find((c: any) => c.id === id);
        
        if (!target) {
            return NextResponse.json({ rank_maqal: null, rank_lacag: null, pct: null, total_customers: 0 });
        }
        
        return NextResponse.json({
            rank_maqal: (target as any).rank_maqal,
            rank_lacag: (target as any).rank_lacag,
            pct: target.pct,
            total_customers: stats.length
        });
    } catch (error: any) {
        console.error('Fetch Rank Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
