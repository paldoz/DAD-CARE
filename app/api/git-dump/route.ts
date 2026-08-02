import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const cwd = path.resolve(process.cwd());
        const output = execSync('git show HEAD~3:app/utils/ledgerHelpers.ts', { cwd }).toString();
        return NextResponse.json({ content: output });
    } catch (e: any) {
        return NextResponse.json({ error: e.message });
    }
}
