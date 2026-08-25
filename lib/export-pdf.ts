import jsPDF from 'jspdf';
import { format } from 'date-fns';

const formatMoney = (val: number): string => {
    const num = Number(val || 0);
    const hasCents = Math.abs(num % 1) > 0.001;
    return num.toLocaleString('en-US', {
        minimumFractionDigits: hasCents ? 2 : 0,
        maximumFractionDigits: 2
    });
};

const formatKg = (val: number | string): string => {
    const num = parseFloat(String(val)) || 0;
    return Number(num.toFixed(2)).toString();
};

// Define types based on what's used
interface Transaction {
    id: string;
    type: 'PRODUCT' | 'PAYMENT' | 'ADJUSTMENT';
    reference_date: string;
    kg?: number;
    price_per_kg?: number;
    amount: number;
    previous_debt: number;
    new_debt: number;
    created_at: string;
    note?: string;
    receipt_id?: string | null;
}

interface ReceiptGroup {
    id: string;
    mainDate: string;
    kind: 'TRANSACTION' | 'ADJUSTMENT';
    entries: Transaction[];
    totalKilos: number;
    totalMaqalka: number;
    totalAdjustment: number;
    totalPaid: number;
    openingBalance: number;
    closingBalance: number;
    note?: string;
    titleString?: string;
}

// Reuse the exact grouping logic from the UI
export function groupTransactionsInfoReceipts(txns: Transaction[]): ReceiptGroup[] {
    if (!txns || txns.length === 0) return [];

    const sortedTxns = [...txns].sort((a, b) => {
        const timeA = new Date(a.created_at).getTime();
        const timeB = new Date(b.created_at).getTime();
        if (timeA !== timeB) return timeB - timeA;
        return a.id.localeCompare(b.id);
    });

    const withReceiptId = sortedTxns.filter(t => t.receipt_id);
    const withoutReceiptId = sortedTxns.filter(t => !t.receipt_id);

    const receiptGroups: Transaction[][] = [];

    const groupedByReceiptId = withReceiptId.reduce((acc, t) => {
        const rid = t.receipt_id!;
        if (!acc[rid]) acc[rid] = [];
        acc[rid].push(t);
        return acc;
    }, {} as Record<string, Transaction[]>);

    Object.values(groupedByReceiptId).forEach(group => receiptGroups.push(group));

    if (withoutReceiptId.length > 0) {
        let currentGroup: Transaction[] = [];
        withoutReceiptId.forEach((txn, i) => {
            if (i === 0) {
                currentGroup.push(txn);
            } else {
                const prev = withoutReceiptId[i - 1];
                const diff = Math.abs(new Date(txn.created_at).getTime() - new Date(prev.created_at).getTime());
                if (diff < 15000) {
                    currentGroup.push(txn);
                } else {
                    receiptGroups.push(currentGroup);
                    currentGroup = [txn];
                }
            }
        });
        if (currentGroup.length > 0) receiptGroups.push(currentGroup);
    }

    const processedReceipts = receiptGroups.map((group, idx) => {
        const last = group[0];
        const first = group[group.length - 1];

        const totalKilos = group.reduce((sum, t) => sum + (t.kg || 0), 0);
        const totalMaqalka = group.filter(t => t.type === 'PRODUCT').reduce((sum, t) => sum + (t.amount || 0), 0);
        const totalPaid = group.filter(t => t.type === 'PAYMENT').reduce((sum, t) => sum + (t.amount || 0), 0);
        const totalAdjustment = group.filter(t => t.type === 'ADJUSTMENT').reduce((sum, t) => sum + (t.amount || 0), 0);
        const isAdjustmentOnly = group.length === group.filter(t => t.type === 'ADJUSTMENT').length;

        const productDates = group.filter(t => t.type === 'PRODUCT').map(t => new Date(t.reference_date));
        let titleString = format(new Date(last.created_at), 'EEEE, MMMM dd, yyyy');

        if (productDates.length > 0) {
            productDates.sort((a, b) => a.getTime() - b.getTime());
            const uniqueDates = Array.from(new Set(productDates.map(d => format(d, 'dd MMM'))));
            if (uniqueDates.length === 1) titleString = `Maqalka Taariikhda ${uniqueDates[0]}`;
            else if (uniqueDates.length === 2) titleString = `Maqalka Taariikhda ${uniqueDates[0]} iyo ${uniqueDates[1]}`;
            else titleString = `Maqalka Taariikhda ${uniqueDates[0]} ila ${uniqueDates[uniqueDates.length - 1]}`;
        }

        return {
            id: `group-${idx}-${last.id}`,
            mainDate: last.reference_date,
            kind: isAdjustmentOnly ? 'ADJUSTMENT' : 'TRANSACTION',
            titleString: titleString,
            entries: [...group].reverse(), 
            totalKilos,
            totalMaqalka,
            totalPaid,
            totalAdjustment,
            openingBalance: first.previous_debt,
            closingBalance: last.new_debt,
            note: group.find(t => t.note)?.note
        } as ReceiptGroup;
    }).sort((a, b) => new Date(b.entries[0].created_at).getTime() - new Date(a.entries[0].created_at).getTime());

    const oldestFirst = [...processedReceipts].sort((a, b) =>
        new Date(a.entries[0].created_at).getTime() - new Date(b.entries[0].created_at).getTime()
    );

    const merged: ReceiptGroup[] = [];
    for (const current of oldestFirst) {
        const isPaymentOnly = current.totalMaqalka === 0 && current.totalAdjustment === 0 && current.totalPaid > 0;

        if (isPaymentOnly && merged.length > 0) {
            let targetIdx = -1;
            for (let k = merged.length - 1; k >= 0; k--) {
                if (merged[k].totalMaqalka > 0 || merged[k].totalAdjustment > 0) {
                    targetIdx = k;
                    break;
                }
            }

            if (targetIdx !== -1) {
                const target = merged[targetIdx];
                const mergedEntries = [...target.entries, ...current.entries].sort(
                    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
                );
                const latestEntry = mergedEntries[mergedEntries.length - 1];
                merged[targetIdx] = {
                    ...target,
                    entries: mergedEntries,
                    totalPaid: target.totalPaid + current.totalPaid,
                    closingBalance: latestEntry.new_debt,
                };
                continue; 
            }
        }
        merged.push(current);
    }

    return merged.sort((a, b) =>
        new Date(b.entries[b.entries.length - 1].created_at).getTime() -
        new Date(a.entries[a.entries.length - 1].created_at).getTime()
    );
}

function drawReceiptOnDoc(doc: jsPDF, customer: any, receipt: ReceiptGroup) {
    const pageWidth = 80;
    const margin = 5;
    let y = 8;

    // ===== HEADER =====
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('DADCARE LEDGER', pageWidth / 2, y, { align: 'center' });
    y += 5;

    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text('Official Transaction Receipt', pageWidth / 2, y, { align: 'center' });
    y += 3;

    // Divider
    doc.setDrawColor(180);
    doc.setLineWidth(0.3);
    doc.line(margin, y, pageWidth - margin, y);
    y += 4;

    // ===== CUSTOMER INFO =====
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(customer.name.toUpperCase(), pageWidth / 2, y, { align: 'center' });
    y += 4;

    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(`ID: ${customer.customer_code}`, pageWidth / 2, y, { align: 'center' });
    y += 3;
    doc.text(`Generated: ${format(new Date(), 'MMMM dd, yyyy')}`, pageWidth / 2, y, { align: 'center' });
    y += 4;

    // Divider
    doc.setDrawColor(200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 4;

    // ===== TITLE =====
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text(receipt.titleString || 'Transaction Receipt', pageWidth / 2, y, { align: 'center' });
    y += 5;

    // ===== MAQALKA (Product Entries) =====
    const productEntries = receipt.entries.filter(e => e.type === 'PRODUCT');
    if (productEntries.length > 0) {
        doc.setFontSize(6);
        doc.setFont('helvetica', 'bold');
        doc.text('MAQALKA', margin, y);
        y += 3;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);

        productEntries.forEach(entry => {
            const dateStr = format(new Date(entry.reference_date), 'MMM dd');
            const isAbsent = !entry.kg || entry.kg === 0;
            const noteLabel = entry.note ? ` (${entry.note})` : '';
            const kgStr = isAbsent ? 'Baaqatay' : `${formatKg(entry.kg || 0)}KG @ $${entry.price_per_kg}${noteLabel}`;
            const amountStr = isAbsent ? '$0' : `$${formatMoney(entry.amount)}`;

            doc.text(`${dateStr} · ${kgStr}`, margin, y);
            doc.text(amountStr, pageWidth - margin, y, { align: 'right' });
            y += 3.5;
        });
    }

    // Maqalka Total
    doc.setDrawColor(180);
    doc.line(margin, y, pageWidth - margin, y);
    y += 3;

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.text('Maqalka Total', margin, y);
    doc.text(`$${formatMoney(receipt.totalMaqalka)}`, pageWidth - margin, y, { align: 'right' });
    y += 4;

    // ===== REESTO (Previous Balance) =====
    if (receipt.openingBalance !== 0) {
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.text('Reesto', margin, y);
        const sign = receipt.openingBalance > 0 ? '+' : '';
        doc.text(`${sign}$${formatMoney(receipt.openingBalance)}`, pageWidth - margin, y, { align: 'right' });
        y += 4;
    }

    // ===== ADJUSTMENT entries =====
    const adjustmentEntries = receipt.entries.filter(e => e.type === 'ADJUSTMENT');
    adjustmentEntries.forEach(entry => {
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.text('Reesto', margin, y);
        doc.text(`+$${formatMoney(entry.amount)}`, pageWidth - margin, y, { align: 'right' });
        y += 3.5;
    });

    // ===== SUBTOTAL =====
    const subtotal = receipt.totalMaqalka + receipt.totalAdjustment + receipt.openingBalance;
    if (receipt.totalMaqalka > 0 || receipt.totalAdjustment > 0) {
        doc.setDrawColor(200);
        doc.line(margin, y, pageWidth - margin, y);
        y += 3;

        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.text('Lacagta Guud', margin, y);
        doc.text(`$${formatMoney(subtotal)}`, pageWidth - margin, y, { align: 'right' });
        y += 5;
    }

    // ===== LACAGAHA (Payments) =====
    const paymentEntries = receipt.entries.filter(e => e.type === 'PAYMENT');
    if (paymentEntries.length > 0) {
        doc.setFontSize(6);
        doc.setFont('helvetica', 'bold');
        doc.text('LACAGAHA (PAYMENTS)', margin, y);
        y += 3;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);

        paymentEntries.forEach(entry => {
            const dateStr = format(new Date(entry.reference_date), 'MMM dd');
            doc.text(`${dateStr} Payment`, margin, y);
            doc.text(`-$${formatMoney(entry.amount)}`, pageWidth - margin, y, { align: 'right' });
            y += 3.5;
        });

        y += 1;
    }

    // ===== LACAGTA GUUD (Final Balance - Only if payment was made) =====
    if (receipt.totalPaid > 0) {
        doc.setDrawColor(150);
        doc.setLineWidth(0.5);
        doc.line(margin, y, pageWidth - margin, y);
        y += 0.5;
        doc.line(margin, y, pageWidth - margin, y);
        y += 4;

        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text('REESTO', margin, y);
        doc.text(`$${formatMoney(Math.abs(receipt.closingBalance))}`, pageWidth - margin, y, { align: 'right' });
        y += 3.5;

        doc.setFontSize(6);
        doc.setFont('helvetica', 'normal');
        if (receipt.closingBalance > 0) {
            doc.text('(Amount Owed)', pageWidth / 2, y, { align: 'center' });
        } else {
            doc.text('(Settled / Credit)', pageWidth / 2, y, { align: 'center' });
        }
        y += 6;
    }

    // ===== FOOTER =====
    doc.setDrawColor(200);
    doc.setLineWidth(0.2);
    doc.line(margin + 10, y, pageWidth - margin - 10, y);
    y += 3;

    doc.setFontSize(5.5);
    doc.setFont('helvetica', 'normal');
    doc.text('This is an official document from Dadcare Ledger System.', pageWidth / 2, y, { align: 'center' });
}

export function downloadCustomerHistoryPDF(customer: any, txns: any[]) {
    // We want a multi-page PDF where each page is an 80x200 receipt
    const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [80, 200]
    });

    const receipts = groupTransactionsInfoReceipts(txns);

    // Filter to show only receipts that have actual changes
    const validReceipts = receipts.filter(r => r.totalMaqalka > 0 || r.totalPaid > 0 || r.totalAdjustment > 0);

    if (validReceipts.length === 0) {
        doc.setFontSize(12);
        doc.text('No History Found', 40, 40, { align: 'center' });
        doc.save(`history-${customer.customer_code}-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
        return;
    }

    // Oldest to newest for reading like a history book? Or newest first? 
    // They usually want to read history sequentially from oldest to newest when downloading.
    const sortedReceipts = [...validReceipts].reverse();

    sortedReceipts.forEach((receipt, index) => {
        if (index > 0) {
            doc.addPage();
        }
        drawReceiptOnDoc(doc, customer, receipt);
    });

    doc.save(`history-${customer.customer_code}-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
}

export function downloadSystemBackupPDF(customers: any[], txnsByCustomer: Record<string, any[]>) {
    // Generate one massive PDF with receipt documents for all customers
    const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [80, 200]
    });

    let isFirstPage = true;

    // Draw cover page
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('DADCARE LEDGER', 40, 60, { align: 'center' });
    doc.setFontSize(10);
    doc.text('SYSTEM BACKUP', 40, 70, { align: 'center' });
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`Generated: ${format(new Date(), 'MMMM dd, yyyy HH:mm')}`, 40, 80, { align: 'center' });
    doc.text(`Customers: ${customers.length}`, 40, 85, { align: 'center' });

    customers.forEach((customer) => {
        const txns = txnsByCustomer[customer.id] || [];
        if (txns.length === 0) return;

        const receipts = groupTransactionsInfoReceipts(txns);
        const validReceipts = receipts.filter(r => r.totalMaqalka > 0 || r.totalPaid > 0 || r.totalAdjustment > 0);

        if (validReceipts.length === 0) return;

        const sortedReceipts = [...validReceipts].reverse(); // Oldest first

        sortedReceipts.forEach((receipt) => {
            if (!isFirstPage) {
                doc.addPage();
            } else {
                doc.addPage(); // Start receipts after cover
                isFirstPage = false;
            }
            drawReceiptOnDoc(doc, customer, receipt);
        });
    });

    doc.save(`system-backup-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
}

export function downloadDailyBookBackupPDF(savedEntries: any[]) {
    const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
    });

    let isFirstPage = true;

    // Draw cover page
    doc.setFillColor(253, 251, 247); // Light notebook background
    doc.rect(0, 0, 210, 297, 'F');

    // Draw lines on cover page for notebook theme
    doc.setDrawColor(180, 210, 240); // Blue lines
    doc.setLineWidth(0.3);
    for (let l = 20; l < 280; l += 10) {
        doc.line(10, l, 200, l);
    }
    // Red margin line
    doc.setDrawColor(230, 100, 100);
    doc.setLineWidth(0.5);
    doc.line(35, 0, 35, 297);

    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(40, 40, 40);
    doc.text('BUUGA MAALINLAHA', 45, 60);

    doc.setFontSize(14);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text('Daily Book Ledger System Backup', 45, 72);

    doc.setFontSize(10);
    doc.text(`Total Logged Days: ${savedEntries.length}`, 45, 90);
    doc.text(`Generated: ${format(new Date(), 'MMMM dd, yyyy HH:mm')}`, 45, 96);

    const sortedDays = [...savedEntries].sort((a, b) => b.date.localeCompare(a.date));

    sortedDays.forEach((day) => {
        if (!isFirstPage) {
            doc.addPage();
        } else {
            isFirstPage = false;
        }

        // Draw notebook background
        doc.setFillColor(253, 251, 247);
        doc.rect(0, 0, 210, 297, 'F');

        // Draw notebook vertical margin line
        doc.setDrawColor(230, 100, 100);
        doc.setLineWidth(0.6);
        doc.line(30, 0, 30, 297);

        // Header Title
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(40, 40, 40);
        
        let dateObj = new Date();
        try {
            dateObj = new Date(day.date);
        } catch (e) {}
        
        doc.text(`TAARIIKHDA: ${format(dateObj, 'MMMM dd, yyyy').toUpperCase()}`, 35, 20);

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(80, 80, 80);
        doc.text(`Total Quantity: ${Math.round(day.totalKg)} KG`, 35, 26);

        // Draw columns headers
        let y = 38;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(60, 60, 60);
        
        doc.text('ID', 15, y);
        doc.text('CUSTOMER NAME', 35, y);
        doc.text('STATUS', 125, y);
        doc.text('KG', 145, y);
        doc.text('NOTE', 165, y);

        y += 2;
        doc.setDrawColor(180, 210, 240);
        doc.setLineWidth(0.4);
        doc.line(10, y, 200, y);
        y += 5;

        // Sort items by customer code numeric
        const sortedItems = [...day.items].sort((a, b) => {
            const codeA = parseInt(a.customer?.customer_code?.replace(/\D/g, '') || '0') || 0;
            const codeB = parseInt(b.customer?.customer_code?.replace(/\D/g, '') || '0') || 0;
            return codeA - codeB;
        });

        sortedItems.forEach((item) => {
            // Check page overflow
            if (y > 280) {
                doc.addPage();
                // Redraw notebook lines and margin
                doc.setFillColor(253, 251, 247);
                doc.rect(0, 0, 210, 297, 'F');
                doc.setDrawColor(230, 100, 100);
                doc.setLineWidth(0.6);
                doc.line(30, 0, 30, 297);
                
                y = 20;
            }

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8.5);
            doc.setTextColor(50, 50, 50);

            // Customer Code
            doc.text(`#${item.customer?.customer_code || '—'}`, 15, y);
            
            // Name
            const nameStr = (item.customer?.name || item.customer_id || 'Unknown').toUpperCase();
            doc.text(nameStr, 35, y);

            // Status
            if (item.present === false) {
                doc.setTextColor(220, 50, 50);
                doc.text('ABSENT', 125, y);
                doc.setTextColor(50, 50, 50);
            } else {
                doc.setTextColor(50, 150, 50);
                doc.text('PRESENT', 125, y);
                doc.setTextColor(50, 50, 50);
            }

            // KG
            doc.setFont('helvetica', 'bold');
            doc.text(`${Math.round(item.kg || 0)} KG`, 145, y);
            doc.setFont('helvetica', 'normal');

            // Note
            if (item.note) {
                doc.setFontSize(7.5);
                doc.text(item.note, 165, y, { maxWidth: 35 });
                doc.setFontSize(8.5);
            }

            y += 4;
            // Draw horizontal thin notebook line
            doc.setDrawColor(220, 230, 245);
            doc.setLineWidth(0.25);
            doc.line(10, y, 200, y);
            y += 4.5;
        });
    });

    doc.save(`buuga-maalinlaha-backup-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
}

