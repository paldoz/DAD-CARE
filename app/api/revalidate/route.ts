import { revalidatePath, revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    revalidatePath('/', 'layout');
    return NextResponse.json({ revalidated: true, time: Date.now() });
}
