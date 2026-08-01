import { format } from 'date-fns';

export interface ReceiptEntry {
    type: 'PRODUCT' | 'PAYMENT' | 'ADJUSTMENT';
    reference_date: string;
    kg?: number;
    price_per_kg?: number;
    amount?: number;
    note?: string;
}

export interface ReceiptData {
    customerName: string;
    customerCode: string;
    titleString: string;
    entries: ReceiptEntry[];
    totalMaqalka: number;
    totalPaid: number;
    totalAdjustment: number;
    openingBalance: number;
    closingBalance: number;
}

// import jsPDF from 'jspdf'; removed for dynamic import

export async function generateReceiptPDF(data: ReceiptData): Promise<any> {
    const jsPDFModule = await import('jspdf');
    const jsPDF = (jsPDFModule.default || jsPDFModule) as any;
    const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [80, 200] // Receipt-style narrow format
    });

    const pageWidth = 80;
    const margin = 5;
    const contentWidth = pageWidth - margin * 2;
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
    doc.text(data.customerName.toUpperCase(), pageWidth / 2, y, { align: 'center' });
    y += 4;

    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(`ID: ${data.customerCode}`, pageWidth / 2, y, { align: 'center' });
    y += 3;
    doc.text(`Date: ${format(new Date(), 'MMMM dd, yyyy · HH:mm')}`, pageWidth / 2, y, { align: 'center' });
    y += 4;

    // Divider
    doc.setDrawColor(200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 4;

    // ===== TITLE =====
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text(data.titleString || 'Transaction Receipt', pageWidth / 2, y, { align: 'center' });
    y += 5;

    // ===== MAQALKA (Product Entries) =====
    const productEntries = data.entries.filter(e => e.type === 'PRODUCT');
    if (productEntries.length > 0) {
        doc.setFontSize(6);
        doc.setFont('helvetica', 'bold');
        doc.text('MAQALKA', margin, y);
        y += 3;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);

        productEntries.forEach(entry => {
            const dateStr = format(new Date(entry.reference_date), 'MMM dd');
            const isAbsent = Math.round(entry.kg || 0) === 0;
            const noteLabel = entry.note ? ` (${entry.note})` : '';
            const kgStr = isAbsent ? 'Baaqatay' : `${Math.round(entry.kg || 0)}KG x $${entry.price_per_kg}${noteLabel}`;
            const amountStr = isAbsent ? '$0' : `$${Math.round(entry.amount || 0).toLocaleString()}`;

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
    doc.text(`$${Math.round(data.totalMaqalka).toLocaleString()}`, pageWidth - margin, y, { align: 'right' });
    y += 4;

    // ===== REESTO (Previous Balance) =====
    if (data.openingBalance !== 0) {
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.text('Reesto', margin, y);
        const sign = data.openingBalance > 0 ? '+' : '';
        doc.text(`${sign}$${Math.round(data.openingBalance).toLocaleString()}`, pageWidth - margin, y, { align: 'right' });
        y += 4;
    }

    // ===== ADJUSTMENT entries =====
    const adjustmentEntries = data.entries.filter(e => e.type === 'ADJUSTMENT');
    adjustmentEntries.forEach(entry => {
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.text('Reesto', margin, y);
        doc.text(`+$${Math.round(entry.amount || 0).toLocaleString()}`, pageWidth - margin, y, { align: 'right' });
        y += 3.5;
    });

    // ===== SUBTOTAL =====
    const subtotal = data.totalMaqalka + data.totalAdjustment + data.openingBalance;
    if (data.totalMaqalka > 0 || data.totalAdjustment > 0) {
        doc.setDrawColor(200);
        doc.line(margin, y, pageWidth - margin, y);
        y += 3;

        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.text('Lacagta Guud', margin, y);
        doc.text(`$${Math.round(subtotal).toLocaleString()}`, pageWidth - margin, y, { align: 'right' });
        y += 5;
    }

    // ===== LACAGAHA (Payments) =====
    const paymentEntries = data.entries.filter(e => e.type === 'PAYMENT');
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
            doc.text(`-$${Math.round(entry.amount || 0).toLocaleString()}`, pageWidth - margin, y, { align: 'right' });
            y += 3.5;
        });

        y += 1;
    }

    // ===== LACAGTA GUUD (Final Balance - Only if payment was made) =====
    if (data.totalPaid > 0) {
        doc.setDrawColor(150);
        doc.setLineWidth(0.5);
        doc.line(margin, y, pageWidth - margin, y);
        y += 0.5;
        doc.line(margin, y, pageWidth - margin, y);
        y += 4;

        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text('REESTO', margin, y);
        doc.text(`$${Math.abs(Math.round(data.closingBalance)).toLocaleString()}`, pageWidth - margin, y, { align: 'right' });
        y += 3.5;

        doc.setFontSize(6);
        doc.setFont('helvetica', 'normal');
        if (data.closingBalance > 0) {
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
    doc.text('This is an official receipt from Dadcare Ledger System.', pageWidth / 2, y, { align: 'center' });
    y += 2.5;
    doc.text('Thank you for your business!', pageWidth / 2, y, { align: 'center' });

    return doc;
}

export async function downloadReceiptPDF(data: ReceiptData) {
    const doc = await generateReceiptPDF(data);
    doc.save(`receipt-${data.customerCode}-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
}

export function shareReceiptToWhatsApp(data: ReceiptData, phone?: string) {
    // Build a text summary for WhatsApp
    const lines: string[] = [];
    lines.push('📋 *DADCARE LEDGER RECEIPT*');
    lines.push(`👤 *${data.customerName.toUpperCase()}* (ID: ${data.customerCode})`);
    lines.push(`📅 ${format(new Date(), 'MMMM dd, yyyy')}`);
    lines.push('─────────────────');

    if (data.titleString) {
        lines.push(`📌 *${data.titleString}*`);
        lines.push('');
    }

    // Products
    const products = data.entries.filter(e => e.type === 'PRODUCT');
    if (products.length > 0) {
        lines.push('📦 *MAQALKA:*');
        products.forEach(e => {
            const dateStr = format(new Date(e.reference_date), 'MMM dd');
            const isAbsent = Math.round(e.kg || 0) === 0;
            if (isAbsent) {
                lines.push(`  ${dateStr} · \u274c Baaqatay = *$0*`);
            } else {
                const noteLabel = e.note ? ` (${e.note})` : '';
                lines.push(`  ${dateStr} · ${Math.round(e.kg || 0)}KG \u00d7 $${e.price_per_kg}${noteLabel} = *$${Math.round(e.amount || 0).toLocaleString()}*`);
            }
        });
        lines.push(`  📊 *Maqalka Total: $${Math.round(data.totalMaqalka).toLocaleString()}*`);
        lines.push('');
    }

    // Previous balance & Adjustments
    if (data.openingBalance !== 0) {
        const sign = data.openingBalance > 0 ? '+' : '';
        lines.push(`🔄 Reesto: ${sign}$${Math.round(data.openingBalance).toLocaleString()}`);
    }
    
    const adjustments = data.entries.filter(e => e.type === 'ADJUSTMENT');
    adjustments.forEach(entry => {
        lines.push(`🔄 Reesto: +$${Math.round(entry.amount || 0).toLocaleString()}`);
    });

    // Subtotal
    const subtotal = data.totalMaqalka + data.totalAdjustment + data.openingBalance;
    if (data.totalMaqalka > 0 || data.totalAdjustment > 0) {
        lines.push(`📋 *Lacagta Guud: $${Math.round(subtotal).toLocaleString()}*`);
    }

    // Payments
    const payments = data.entries.filter(e => e.type === 'PAYMENT');
    if (payments.length > 0) {
        lines.push('');
        lines.push('💰 *LACAGAHA:*');
        payments.forEach(e => {
            const dateStr = format(new Date(e.reference_date), 'MMM dd');
            lines.push(`  ${dateStr} Payment: *-$${Math.round(e.amount || 0).toLocaleString()}*`);
        });
    }

    // Final balance (Only if payment was made)
    if (data.totalPaid > 0) {
        lines.push('');
        lines.push('═══════════════');
        const emoji = data.closingBalance > 0 ? '🔴' : '🟢';
        lines.push(`${emoji} *REESTO: $${Math.abs(Math.round(data.closingBalance)).toLocaleString()}*`);
        if (data.closingBalance > 0) {
            lines.push('_(Amount Owed)_');
        } else {
            lines.push('_(Settled / Credit)_');
        }
    }
    lines.push('');
    lines.push('_Generated by Dadcare Ledger System_');

    const message = encodeURIComponent(lines.join('\n'));

    // If phone number provided, open direct chat
    if (phone) {
        // Clean phone number (remove spaces, dashes, etc)
        const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
        window.open(`https://wa.me/${cleanPhone}?text=${message}`, '_blank');
    } else {
        // Open WhatsApp with the message (user picks contact)
        window.open(`https://wa.me/?text=${message}`, '_blank');
    }
}
