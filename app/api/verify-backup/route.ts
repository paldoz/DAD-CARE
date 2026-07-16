import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const { errorResponse } = await requireSuperAdmin(request);
    if (errorResponse) return errorResponse;

    try {
        const body = await request.json();
        const { data } = body;

        if (!data) {
            return NextResponse.json({ error: 'No backup data provided' }, { status: 400 });
        }

        const { customers = [], ledger = [], dailyBook = [], dailyBookItems = [], users = [] } = data;

        const checks: Array<{
            name: string;
            passed: boolean;
            detail: string;
            errors: string[];
        }> = [];

        // ── Check 1: Basic Structure ───────────────────────────────────────────
        const structureErrors: string[] = [];
        if (!Array.isArray(customers)) structureErrors.push('customers is not an array');
        if (!Array.isArray(ledger)) structureErrors.push('ledger is not an array');
        if (!Array.isArray(dailyBook)) structureErrors.push('dailyBook is not an array');
        if (!Array.isArray(dailyBookItems)) structureErrors.push('dailyBookItems is not an array');
        if (!Array.isArray(users)) structureErrors.push('users is not an array');
        checks.push({
            name: 'Backup Structure',
            passed: structureErrors.length === 0,
            detail: `Found: ${customers.length} customers, ${ledger.length} ledger rows, ${dailyBook.length} daily books, ${dailyBookItems.length} daily book items, ${users.length} users`,
            errors: structureErrors,
        });

        // ── Check 2: No Orphaned Ledger Entries ───────────────────────────────
        const customerIds = new Set(customers.map((c: any) => c.id));
        const orphanedLedger: string[] = [];
        for (const row of ledger) {
            if (!customerIds.has(row.customer_id)) {
                orphanedLedger.push(`Ledger row ${row.id} references missing customer ${row.customer_id}`);
                if (orphanedLedger.length >= 5) { orphanedLedger.push('... and more'); break; }
            }
        }
        checks.push({
            name: 'Ledger → Customer Integrity',
            passed: orphanedLedger.length === 0,
            detail: `${ledger.length} ledger entries checked against ${customers.length} customers`,
            errors: orphanedLedger,
        });

        // ── Check 3: No Orphaned DailyBookItems ───────────────────────────────
        const dailyBookIds = new Set(dailyBook.map((db: any) => db.id));
        const orphanedItems: string[] = [];
        for (const item of dailyBookItems) {
            if (!dailyBookIds.has(item.daily_book_id)) {
                orphanedItems.push(`DailyBookItem ${item.id} references missing DailyBook ${item.daily_book_id}`);
                if (orphanedItems.length >= 5) { orphanedItems.push('... and more'); break; }
            }
            if (!customerIds.has(item.customer_id)) {
                orphanedItems.push(`DailyBookItem ${item.id} references missing customer ${item.customer_id}`);
                if (orphanedItems.length >= 5) { orphanedItems.push('... and more'); break; }
            }
        }
        checks.push({
            name: 'DailyBookItem → DailyBook Integrity',
            passed: orphanedItems.length === 0,
            detail: `${dailyBookItems.length} daily book items checked`,
            errors: orphanedItems,
        });

        // ── Check 4: Ledger Balance Chain ─────────────────────────────────────
        // For each customer, sort their ledger rows by created_at.
        // Each row's previous_debt must equal the prior row's new_debt.
        const chainErrors: string[] = [];
        const ledgerByCustomer: Record<string, any[]> = {};
        for (const row of ledger) {
            if (!ledgerByCustomer[row.customer_id]) ledgerByCustomer[row.customer_id] = [];
            ledgerByCustomer[row.customer_id].push(row);
        }

        let chainsChecked = 0;
        for (const [custId, rows] of Object.entries(ledgerByCustomer)) {
            // Sort by created_at ascending so we can walk the chain
            const sorted = [...rows].sort((a, b) =>
                new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
            chainsChecked++;
            for (let i = 1; i < sorted.length; i++) {
                const prev = sorted[i - 1];
                const curr = sorted[i];
                // Allow 1-unit float rounding tolerance
                if (Math.abs((curr.previous_debt ?? 0) - (prev.new_debt ?? 0)) > 1) {
                    const cust = customers.find((c: any) => c.id === custId);
                    chainErrors.push(
                        `Customer "${cust?.name || custId}": row ${i + 1} previous_debt=${curr.previous_debt} ≠ prior new_debt=${prev.new_debt}`
                    );
                    if (chainErrors.length >= 10) { chainErrors.push('... and more'); break; }
                }
            }
            if (chainErrors.length >= 10) break;
        }

        checks.push({
            name: 'Ledger Balance Chain Integrity',
            passed: chainErrors.length === 0,
            detail: `Checked balance chain for ${chainsChecked} customers`,
            errors: chainErrors,
        });

        // ── Check 5: No Duplicate Customer Codes ─────────────────────────────
        const codeSeen = new Map<string, string>();
        const dupCodes: string[] = [];
        for (const c of customers) {
            if (c.customer_code) {
                if (codeSeen.has(c.customer_code)) {
                    dupCodes.push(`Duplicate customer_code "${c.customer_code}" on customers: ${codeSeen.get(c.customer_code)} and ${c.id}`);
                } else {
                    codeSeen.set(c.customer_code, c.id);
                }
            }
        }
        checks.push({
            name: 'Duplicate Customer Codes',
            passed: dupCodes.length === 0,
            detail: `Checked ${customers.length} customer codes for uniqueness`,
            errors: dupCodes,
        });

        // ── Final Result ──────────────────────────────────────────────────────
        const allPassed = checks.every(c => c.passed);
        const failCount = checks.filter(c => !c.passed).length;

        return NextResponse.json({
            success: true,
            allPassed,
            summary: allPassed
                ? `✅ All ${checks.length} checks passed. This backup is valid and safe to restore.`
                : `❌ ${failCount} of ${checks.length} checks failed. Do NOT restore until issues are fixed.`,
            checks,
            stats: {
                customers: customers.length,
                ledger: ledger.length,
                dailyBook: dailyBook.length,
                dailyBookItems: dailyBookItems.length,
                users: users.length,
                backupTimestamp: data.timestamp || 'Unknown',
            },
        });

    } catch (error: any) {
        return NextResponse.json({ error: 'Failed to parse or verify backup: ' + error.message }, { status: 500 });
    }
}
