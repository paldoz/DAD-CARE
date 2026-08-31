import { NextResponse } from 'next/server';
import { format } from 'date-fns';
import fs from 'fs';
import path from 'path';
import { requireSuperAdmin } from '@/lib/require-session';
import pool from '@/lib/db';
import { trackApiRoute } from '@/lib/egress-tracker';
import { rateLimitResponse } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ──────────────────────────────────────────────
// Helper: group transactions into receipt groups 
// (mirrors client-side grouping logic)
// ──────────────────────────────────────────────
function groupTransactions(txns: any[]) {
    if (!txns || txns.length === 0) return [];

    const sorted = [...txns].sort((a, b) => {
        const timeA = new Date(a.created_at).getTime();
        const timeB = new Date(b.created_at).getTime();
        if (timeA !== timeB) return timeB - timeA;
        return a.id.localeCompare(b.id);
    });

    const withRid = sorted.filter(t => t.receipt_id);
    const withoutRid = sorted.filter(t => !t.receipt_id);

    const groups: any[][] = [];

    const byRid = withRid.reduce((acc: any, t: any) => {
        const rid = t.receipt_id;
        if (!acc[rid]) acc[rid] = [];
        acc[rid].push(t);
        return acc;
    }, {} as Record<string, any[]>);
    Object.values(byRid).forEach((group: any) => groups.push(group));

    if (withoutRid.length > 0) {
        let cur: any[] = [];
        withoutRid.forEach((txn: any, i: number) => {
            if (i === 0) { cur.push(txn); }
            else {
                const diff = Math.abs(new Date(txn.created_at).getTime() - new Date(withoutRid[i - 1].created_at).getTime());
                if (diff < 15000) cur.push(txn);
                else { groups.push(cur); cur = [txn]; }
            }
        });
        if (cur.length > 0) groups.push(cur);
    }

    return groups.map((group, idx) => {
        const last = group[0];
        const first = group[group.length - 1];
        const totalKilos = group.reduce((s: number, t: any) => s + (t.kg || 0), 0);
        const totalMaqalka = group.filter((t: any) => t.type === 'PRODUCT').reduce((s: number, t: any) => s + (t.amount || 0), 0);
        const totalPaid = group.filter((t: any) => t.type === 'PAYMENT').reduce((s: number, t: any) => s + (t.amount || 0), 0);
        const totalAdjustment = group.filter((t: any) => t.type === 'ADJUSTMENT').reduce((s: number, t: any) => s + (t.amount || 0), 0);

        const productDates = group.filter((t: any) => t.type === 'PRODUCT').map((t: any) => new Date(t.reference_date));
        let titleString = format(new Date(last.created_at), 'EEEE, MMMM dd, yyyy');
        if (productDates.length > 0) {
            productDates.sort((a: Date, b: Date) => a.getTime() - b.getTime());
            const uniqueDates = Array.from(new Set(productDates.map((d: Date) => format(d, 'dd MMM'))));
            if (uniqueDates.length === 1) titleString = `Maqalka ${uniqueDates[0]}`;
            else titleString = `Maqalka ${uniqueDates[0]} - ${uniqueDates[uniqueDates.length - 1]}`;
        }

        return {
            titleString,
            entries: [...group].reverse(),
            totalKilos, totalMaqalka, totalPaid, totalAdjustment,
            openingBalance: first.previous_debt,
            closingBalance: last.new_debt,
            note: group.find((t: any) => t.note)?.note
        };
    }).sort((a, b) =>
        new Date(a.entries[0].created_at).getTime() - new Date(b.entries[0].created_at).getTime()
    );
}

// ──────────────────────────────────────────────
// Build a plain-text formatted backup string
// ──────────────────────────────────────────────
function buildMaqalkaText(customer: any, txns: any[]) {
    const receipts = groupTransactions(txns);
    let text = '';
    text += '═'.repeat(60) + '\n';
    text += `  BUUGA MAQALKA — ${customer.name.toUpperCase()} (ID: ${customer.customer_code})\n`;
    text += `  Generated: ${format(new Date(), 'MMMM dd, yyyy HH:mm')}\n`;
    text += '═'.repeat(60) + '\n\n';

    if (receipts.length === 0) {
        text += '  No transactions found.\n\n';
        return text;
    }

    receipts.forEach((r, i) => {
        text += `── Receipt #${i + 1}: ${r.titleString} ──\n`;

        const products = r.entries.filter((e: any) => e.type === 'PRODUCT');
        if (products.length > 0) {
            text += '  MAQALKA:\n';
            products.forEach((e: any) => {
                const dateStr = format(new Date(e.reference_date), 'MMM dd');
                text += `    ${dateStr}  |  ${Math.round(e.kg || 0)} KG @ $${e.price_per_kg}  =  $${Math.round(e.amount).toLocaleString()}\n`;
            });
        }

        if (r.openingBalance !== 0) {
            text += `  Reesto (Previous Balance): $${Math.round(r.openingBalance).toLocaleString()}\n`;
        }

        const adjustments = r.entries.filter((e: any) => e.type === 'ADJUSTMENT');
        adjustments.forEach((e: any) => {
            text += `  Adjustment: +$${Math.round(e.amount).toLocaleString()}${e.note ? ` (${e.note})` : ''}\n`;
        });

        if (r.totalMaqalka > 0) {
            const subtotal = r.totalMaqalka + r.totalAdjustment + r.openingBalance;
            text += `  Lacagta Guud (Total Due): $${Math.round(subtotal).toLocaleString()}\n`;
        }

        const payments = r.entries.filter((e: any) => e.type === 'PAYMENT');
        if (payments.length > 0) {
            text += '  LACAGAHA (PAYMENTS):\n';
            payments.forEach((e: any) => {
                const dateStr = format(new Date(e.reference_date), 'MMM dd');
                text += `    ${dateStr}  Payment  =  -$${Math.round(e.amount).toLocaleString()}\n`;
            });
        }

        text += `  ➤ CLOSING BALANCE: $${Math.round(r.closingBalance).toLocaleString()}`;
        text += r.closingBalance > 0 ? ' (Owed)\n' : ' (Settled)\n';
        text += '─'.repeat(50) + '\n\n';
    });

    return text;
}

function buildMaalinlahaText(entries: any[]) {
    const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
    let text = '';
    text += '═'.repeat(60) + '\n';
    text += `  BUUGA MAALINLAHA — DAILY BOOK BACKUP\n`;
    text += `  Total Days: ${sorted.length}\n`;
    text += `  Generated: ${format(new Date(), 'MMMM dd, yyyy HH:mm')}\n`;
    text += '═'.repeat(60) + '\n\n';

    sorted.forEach((day) => {
        let dateObj: Date;
        try { dateObj = new Date(day.date); } catch { dateObj = new Date(); }

        text += `── ${format(dateObj, 'EEEE, MMMM dd, yyyy').toUpperCase()} ──\n`;
        text += `   Total KG: ${Math.round(day.totalKg)}\n\n`;

        text += '   ID    | CUSTOMER NAME              | STATUS  | KG    | NOTE\n';
        text += '   ' + '─'.repeat(56) + '\n';

        const sortedItems = [...day.items].sort((a: any, b: any) => {
            const codeA = parseInt(a.customer?.customer_code?.replace(/\D/g, '') || '0') || 0;
            const codeB = parseInt(b.customer?.customer_code?.replace(/\D/g, '') || '0') || 0;
            return codeA - codeB;
        });

        sortedItems.forEach((item: any) => {
            const code = (item.customer?.customer_code || '—').padEnd(5);
            const name = (item.customer?.name || 'Unknown').toUpperCase().padEnd(26).substring(0, 26);
            const status = item.present === false ? 'ABSENT ' : 'PRESENT';
            const kg = `${Math.round(item.kg || 0)} KG`.padStart(5);
            const note = item.note || '';
            text += `   #${code}| ${name} | ${status} | ${kg} | ${note}\n`;
        });

        text += '\n' + '─'.repeat(60) + '\n\n';
    });

    return text;
}

// ──────────────────────────────────────────────
// HTML Report Generator (Beautiful & Printable)
// ──────────────────────────────────────────────
function buildMaqalkaHTML(customer: any, txns: any[]) {
    const receipts = groupTransactions(txns);
    let html = `
    <div style="page-break-before: always; font-family: 'Segoe UI', Arial, sans-serif; padding: 20px; max-width: 700px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #1e3a5f, #2563eb); color: white; padding: 20px 24px; border-radius: 12px; margin-bottom: 16px;">
            <h2 style="margin: 0; font-size: 20px; letter-spacing: 1px;">📒 BUUGA MAQALKA</h2>
            <h3 style="margin: 4px 0 0; font-size: 16px; font-weight: 800; text-transform: uppercase;">${customer.name}</h3>
            <p style="margin: 4px 0 0; font-size: 11px; opacity: 0.8;">ID: ${customer.customer_code} • Generated: ${format(new Date(), 'MMM dd, yyyy')}</p>
        </div>`;

    if (receipts.length === 0) {
        html += `<p style="text-align: center; color: #888; padding: 40px;">No transactions found.</p>`;
    }

    receipts.forEach((r, i) => {
        const isSettled = r.closingBalance <= 0;
        html += `
        <div style="border: 1px solid #e2e8f0; border-radius: 10px; margin-bottom: 12px; overflow: hidden;">
            <div style="background: #f8fafc; padding: 10px 16px; border-bottom: 1px solid #e2e8f0;">
                <strong style="font-size: 12px; color: #334155;">#${i + 1} — ${r.titleString}</strong>
            </div>
            <div style="padding: 12px 16px; font-size: 12px;">`;

        const products = r.entries.filter((e: any) => e.type === 'PRODUCT');
        if (products.length > 0) {
            html += `<table style="width: 100%; border-collapse: collapse; margin-bottom: 8px;">
                <tr style="background: #f1f5f9;"><th style="text-align: left; padding: 6px 8px; font-size: 10px; color: #64748b;">DATE</th><th style="text-align: left; padding: 6px 8px; font-size: 10px; color: #64748b;">KG</th><th style="text-align: right; padding: 6px 8px; font-size: 10px; color: #64748b;">AMOUNT</th></tr>`;
            products.forEach((e: any) => {
                html += `<tr><td style="padding: 5px 8px; border-bottom: 1px solid #f1f5f9;">${format(new Date(e.reference_date), 'MMM dd')}</td><td style="padding: 5px 8px; border-bottom: 1px solid #f1f5f9;">${Math.round(e.kg || 0)} KG @ $${e.price_per_kg}</td><td style="padding: 5px 8px; border-bottom: 1px solid #f1f5f9; text-align: right; font-weight: 700;">$${Math.round(e.amount).toLocaleString()}</td></tr>`;
            });
            html += `</table>`;
        }

        if (r.openingBalance !== 0) {
            html += `<div style="display: flex; justify-content: space-between; padding: 4px 0; color: #64748b;"><span>Reesto</span><span>$${Math.round(r.openingBalance).toLocaleString()}</span></div>`;
        }

        const payments = r.entries.filter((e: any) => e.type === 'PAYMENT');
        if (payments.length > 0) {
            payments.forEach((e: any) => {
                html += `<div style="display: flex; justify-content: space-between; padding: 4px 0; color: #16a34a;"><span>💵 Payment (${format(new Date(e.reference_date), 'MMM dd')})</span><span style="font-weight: 700;">-$${Math.round(e.amount).toLocaleString()}</span></div>`;
            });
        }

        html += `<div style="margin-top: 8px; padding-top: 8px; border-top: 2px solid ${isSettled ? '#16a34a' : '#ef4444'}; display: flex; justify-content: space-between; align-items: center;">
            <strong style="color: ${isSettled ? '#16a34a' : '#ef4444'}; font-size: 13px;">CLOSING BALANCE</strong>
            <strong style="font-size: 16px; color: ${isSettled ? '#16a34a' : '#ef4444'};">$${Math.round(Math.abs(r.closingBalance)).toLocaleString()}</strong>
        </div>`;

        html += `</div></div>`;
    });

    html += `</div>`;
    return html;
}

function buildMaalinlahaHTML(entries: any[]) {
    const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
    let html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; padding: 20px; max-width: 700px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #92400e, #d97706); color: white; padding: 20px 24px; border-radius: 12px; margin-bottom: 16px;">
            <h2 style="margin: 0; font-size: 20px; letter-spacing: 1px;">📖 BUUGA MAALINLAHA</h2>
            <p style="margin: 4px 0 0; font-size: 12px; opacity: 0.9;">Daily Book Backup • ${sorted.length} Days</p>
            <p style="margin: 4px 0 0; font-size: 11px; opacity: 0.7;">Generated: ${format(new Date(), 'MMMM dd, yyyy HH:mm')}</p>
        </div>`;

    sorted.forEach((day) => {
        let dateObj: Date;
        try { dateObj = new Date(day.date); } catch { dateObj = new Date(); }

        html += `
        <div style="page-break-inside: avoid; border: 1px solid #e2e8f0; border-radius: 10px; margin-bottom: 12px; overflow: hidden;">
            <div style="background: #fffbeb; padding: 10px 16px; border-bottom: 1px solid #fde68a; display: flex; justify-content: space-between; align-items: center;">
                <strong style="font-size: 13px; color: #92400e;">${format(dateObj, 'EEEE, MMMM dd, yyyy')}</strong>
                <span style="background: #f59e0b; color: white; padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: 800;">${Math.round(day.totalKg)} KG</span>
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                <tr style="background: #f8fafc;"><th style="text-align: left; padding: 6px 10px; font-size: 10px; color: #64748b;">ID</th><th style="text-align: left; padding: 6px 10px; font-size: 10px; color: #64748b;">NAME</th><th style="text-align: center; padding: 6px 10px; font-size: 10px; color: #64748b;">STATUS</th><th style="text-align: right; padding: 6px 10px; font-size: 10px; color: #64748b;">KG</th></tr>`;

        const sortedItems = [...day.items].sort((a: any, b: any) => {
            const cA = parseInt(a.customer?.customer_code?.replace(/\D/g, '') || '0') || 0;
            const cB = parseInt(b.customer?.customer_code?.replace(/\D/g, '') || '0') || 0;
            return cA - cB;
        });

        sortedItems.forEach((item: any) => {
            const statusColor = item.present === false ? '#ef4444' : '#16a34a';
            const statusText = item.present === false ? 'ABSENT' : 'PRESENT';
            html += `<tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 5px 10px; color: #94a3b8; font-weight: 700;">#${item.customer?.customer_code || '—'}</td>
                <td style="padding: 5px 10px; font-weight: 600; text-transform: uppercase;">${item.customer?.name || 'Unknown'}</td>
                <td style="padding: 5px 10px; text-align: center;"><span style="color: ${statusColor}; font-weight: 700; font-size: 10px;">${statusText}</span></td>
                <td style="padding: 5px 10px; text-align: right; font-weight: 800;">${Math.round(item.kg || 0)}</td>
            </tr>`;
        });

        html += `</table></div>`;
    });

    html += `</div>`;
    return html;
}

function getBackupDir(): string {
    if (process.env.USERPROFILE) {
        return path.join(process.env.USERPROFILE, 'OneDrive', 'Desktop', 'dadcare app', 'Backups');
    }
    return path.resolve(process.cwd(), '..', 'Backups');
}

// ──────────────────────────────────────────────
// MAIN API: Generate and Save Backups
// ──────────────────────────────────────────────
export const POST = trackApiRoute('/api/backup', async (request: Request) => {
    const { errorResponse } = await requireSuperAdmin(request);
    if (errorResponse) return errorResponse;
    const backupDir = getBackupDir();
    const dateStr = format(new Date(), 'yyyy-MM-dd');
    const todayDir = path.join(backupDir, dateStr);

    try {
        // Ensure backup directories exist
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
        if (!fs.existsSync(todayDir)) fs.mkdirSync(todayDir, { recursive: true });
        const maqalkaDir = path.join(todayDir, 'Buuga-Maqalka');
        const maalinlahaDir = path.join(todayDir, 'Buuga-Maalinlaha');
        if (!fs.existsSync(maqalkaDir)) fs.mkdirSync(maqalkaDir, { recursive: true });
        if (!fs.existsSync(maalinlahaDir)) fs.mkdirSync(maalinlahaDir, { recursive: true });

        // ─── 1. Fetch ALL customers ───
        const { rows: customers } = await pool.query(`
            SELECT id, name, customer_code, gender, phone
            FROM "Customer"
            ORDER BY name ASC
        `);

        // ─── 2. Build Buuga Maqalka per customer ───
        let combinedMaqalkaText = '';
        let combinedMaqalkaHTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Buuga Maqalka Backup - ${dateStr}</title><style>body{margin:0;padding:20px;background:#fff;} @media print { div { page-break-inside: avoid; } }</style></head><body>`;

        let customerCount = 0;
        let totalTransactions = 0;

        // Fetch top 100 transactions per customer in ONE query (reduced from 500 to cut Supabase egress)
        const { rows: allTxns } = await pool.query(`
            SELECT id, customer_id, type, reference_date, kg, price_per_kg, amount, previous_debt, new_debt, note, receipt_id, created_at FROM (
                SELECT id, customer_id, type, reference_date, kg, price_per_kg, amount, previous_debt, new_debt, note, receipt_id, created_at,
                       ROW_NUMBER() OVER(PARTITION BY customer_id ORDER BY created_at DESC) as rn
                FROM "Ledger"
                WHERE deleted_at IS NULL
            ) t
            WHERE rn <= 100
        `);

        // Group transactions by customer in memory
        const txnsByCustomer = (allTxns || []).reduce((acc: any, txn: any) => {
            if (!acc[txn.customer_id]) acc[txn.customer_id] = [];
            acc[txn.customer_id].push(txn);
            return acc;
        }, {});

        for (const cust of (customers || [])) {
            const txns = txnsByCustomer[cust.id] || [];

            if (!txns || txns.length === 0) continue;
            customerCount++;
            totalTransactions += txns.length;

            // Per-customer text file
            const custText = buildMaqalkaText(cust, txns);
            fs.writeFileSync(
                path.join(maqalkaDir, `${cust.customer_code}-${cust.name.replace(/[^a-zA-Z0-9]/g, '_')}.txt`),
                custText, 'utf-8'
            );

            combinedMaqalkaText += custText + '\n\n';
            combinedMaqalkaHTML += buildMaqalkaHTML(cust, txns);
        }

        combinedMaqalkaHTML += `</body></html>`;

        // Save combined files
        fs.writeFileSync(path.join(todayDir, `BUUGA-MAQALKA-FULL-BACKUP-${dateStr}.txt`), combinedMaqalkaText, 'utf-8');
        fs.writeFileSync(path.join(todayDir, `BUUGA-MAQALKA-FULL-BACKUP-${dateStr}.html`), combinedMaqalkaHTML, 'utf-8');

        // ─── 3. Build Buuga Maalinlaha ───
        const { rows: historyResult } = await pool.query(`
            SELECT 
                db.id, 
                db.date,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'id', dbi.id,
                            'kg', dbi.kg,
                            'present', dbi.present,
                            'note', dbi.note,
                            'customer_id', dbi.customer_id,
                            'customer', json_build_object(
                                'id', c.id,
                                'name', c.name,
                                'customer_code', c.customer_code,
                                'gender', c.gender
                            )
                        )
                    ) FILTER (WHERE dbi.id IS NOT NULL), 
                    '[]'::json
                ) as items
            FROM "DailyBook" db
            LEFT JOIN "DailyBookItem" dbi ON dbi.daily_book_id = db.id AND dbi.deleted_at IS NULL
            LEFT JOIN "Customer" c ON c.id = dbi.customer_id
            WHERE db.deleted_at IS NULL
            GROUP BY db.id, db.date
            ORDER BY db.date DESC
            LIMIT 90
        `);

        const history = (historyResult || []).map((book: any) => {
            const itemsList = typeof book.items === 'string' ? JSON.parse(book.items) : (book.items || []);
            return {
                date: book.date,
                totalKg: itemsList.reduce((s: number, i: any) => s + (i.kg || 0), 0),
                items: itemsList.map((item: any) => ({
                    customer_id: item.customer?.id,
                    kg: item.kg,
                    present: item.present,
                    note: item.note,
                    customer: item.customer
                }))
            };
        });

        const maalinlahaText = buildMaalinlahaText(history);
        const maalinlahaHTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Buuga Maalinlaha Backup - ${dateStr}</title><style>body{margin:0;padding:20px;background:#fff;} @media print { div { page-break-inside: avoid; } }</style></head><body>${buildMaalinlahaHTML(history)}</body></html>`;

        fs.writeFileSync(path.join(todayDir, `BUUGA-MAALINLAHA-FULL-BACKUP-${dateStr}.txt`), maalinlahaText, 'utf-8');
        fs.writeFileSync(path.join(todayDir, `BUUGA-MAALINLAHA-FULL-BACKUP-${dateStr}.html`), maalinlahaHTML, 'utf-8');

        // ─── 4. Build Summary ───
        const summaryText = [
            '═'.repeat(60),
            '  DADCARE BACKUP SUMMARY',
            `  Date: ${format(new Date(), 'MMMM dd, yyyy HH:mm:ss')}`,
            '═'.repeat(60),
            '',
            `  Total Customers: ${customers?.length || 0}`,
            `  Customers with Transactions: ${customerCount}`,
            `  Total Ledger Transactions: ${totalTransactions}`,
            `  Total Daily Book Days: ${history.length}`,
            '',
            '  Files Generated:',
            `    📒 BUUGA-MAQALKA-FULL-BACKUP-${dateStr}.html`,
            `    📒 BUUGA-MAQALKA-FULL-BACKUP-${dateStr}.txt`,
            `    📖 BUUGA-MAALINLAHA-FULL-BACKUP-${dateStr}.html`,
            `    📖 BUUGA-MAALINLAHA-FULL-BACKUP-${dateStr}.txt`,
            `    📁 Buuga-Maqalka/ (${customerCount} individual customer files)`,
            '',
            '  This backup is stored in your OneDrive folder and',
            '  will be automatically synced to the cloud.',
            '',
            '═'.repeat(60),
        ].join('\n');

        fs.writeFileSync(path.join(todayDir, 'BACKUP-SUMMARY.txt'), summaryText, 'utf-8');

        return NextResponse.json({
            success: true,
            path: todayDir,
            stats: {
                customers: customers?.length || 0,
                customersWithTxns: customerCount,
                totalTransactions,
                dailyBookDays: history.length,
                filesGenerated: customerCount + 5 // individual + combined + summary
            }
        });
    } catch (error: any) {
        console.error('Backup Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});

export const GET = trackApiRoute('/api/backup', async (request: Request) => {
    // Requires SUPER_ADMIN
    const { errorResponse } = await requireSuperAdmin(request);
    if (errorResponse) return errorResponse;

    // Rate Limit: 1 backup allowed per hour per IP/User to protect bandwidth
    const limited = rateLimitResponse(request, 1, 3_600_000);
    if (limited) return NextResponse.json({ error: 'Rate limit exceeded. You can only backup the database once per hour.' }, { status: 429 });

    const backupDir = getBackupDir();

    try {
        if (!fs.existsSync(backupDir)) {
            return NextResponse.json({ backups: [] });
        }

        const folders = fs.readdirSync(backupDir)
            .filter(f => fs.statSync(path.join(backupDir, f)).isDirectory())
            .sort((a, b) => b.localeCompare(a));

        const backups = folders.map(folder => {
            const folderPath = path.join(backupDir, folder);
            const files = fs.readdirSync(folderPath, { recursive: true }) as string[];
            const stats = fs.statSync(folderPath);
            return {
                date: folder,
                fileCount: files.length,
                createdAt: stats.mtime.toISOString()
            };
        });

        return NextResponse.json({ backups });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
