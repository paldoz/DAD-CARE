import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/require-session';
import { trackApiRoute } from '@/lib/egress-tracker';
import { getAllCustomerStats } from '@/app/utils/rankHelpers';

export const dynamic = 'force-dynamic';

export const GET = trackApiRoute('/api/audit/ranking', async (request: Request) => {
    const { errorResponse } = await requireSession(request);
    if (errorResponse) return errorResponse;

    try {
        const stats = await getAllCustomerStats(pool);
        
        const auditLog = stats.map((c: any) => {
            const lastCompleted = c.debugMaqals && c.debugMaqals.length > 0 ? c.debugMaqals[0] : null;
            
            return {
                customerId: c.id,
                FinalRank: c.rank_maqal,
                Reliability: c.pct,
                LastCompletedMaqalReesto: lastCompleted ? lastCompleted.reesto : 0,
                Heyn: lastCompleted ? lastCompleted.heyn : 0,
                FiveCompletedMaqals: c.debugMaqals || [],
                SortKeysUsed: {
                    Reliability: c.pct,
                    Reesto: lastCompleted ? lastCompleted.reesto : 0,
                    Heyn: lastCompleted ? lastCompleted.heyn : 0
                }
            };
        });

        // Return perfectly sorted array by rank
        auditLog.sort((a, b) => a.FinalRank - b.FinalRank);

        return NextResponse.json({
            status: 'Success',
            totalCustomers: auditLog.length,
            audit: auditLog
        });
    } catch (error: any) {
        console.error('Fetch Audit Ranking Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
