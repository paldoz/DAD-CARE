import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
    return NextResponse.json(
        { error: 'Endpoint permanently deprecated and disabled' },
        { status: 410 }
    );
}
