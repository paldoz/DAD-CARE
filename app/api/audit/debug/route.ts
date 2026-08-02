import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { getAllCustomerStats } from '@/app/utils/rankHelpers';

export const dynamic = 'force-dynamic';

export const GET = async () => {
    try {
        const stats = await getAllCustomerStats(pool);
        
        const top5 = stats.sort((a: any, b: any) => a.rank_maqal - b.rank_maqal).slice(0, 10).map((c: any) => ({
            rank: c.rank_maqal,
            id: c.id,
            pct: c.pct,
            current_debt: c.current_debt,
            maqals: (c.debugMaqals || []).map((m: any) => ({
                title: m.title,
                reesto: m.reesto,
                heyn: m.heyn
            }))
        }));

        return NextResponse.json({
            top10: top5
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
};
