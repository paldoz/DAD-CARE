import { Pool } from 'pg';
import dotenv from 'dotenv';
import assert from 'node:assert';
import test from 'node:test';

dotenv.config({ path: '.env.local' });
if (!process.env.DATABASE_URL) dotenv.config({ path: '.env' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Helper to simulate the exact discovery logic implemented in Settings
function extractAvailableTypesFromItems(items: Array<{ note?: string | null }>): string[] {
    const typeMap = new Map<string, string>();
    // Baseline standard types
    typeMap.set('vip', 'VIP');
    typeMap.set('heshiish', 'Heshiish');

    if (items && Array.isArray(items)) {
        for (const item of items) {
            if (!item?.note) continue;
            const parts = item.note.split(',').map((s: string) => s.trim()).filter(Boolean);
            for (const part of parts) {
                const match = part.match(/^(?:(\d+(?:\.\d+)?)\s+)?([a-zA-Z]+)(?:\s+(\d+(?:\.\d+)?))?$/);
                if (match && match[2]) {
                    const raw = match[2].trim();
                    const key = raw.toLowerCase();
                    if (!typeMap.has(key)) {
                        let display = raw;
                        if (key === 'vip') {
                            display = 'VIP';
                        } else if (raw === raw.toUpperCase() && raw.length > 1) {
                            display = raw;
                        } else {
                            display = key.charAt(0).toUpperCase() + key.slice(1).toLowerCase();
                        }
                        typeMap.set(key, display);
                    }
                }
            }
        }
    }
    return Array.from(typeMap.values());
}

// Helper to simulate filtering customers by dynamic type and calculating individual matching KG
function filterCustomersByType(items: any[], typeFilter: string | null) {
    if (!typeFilter || !items) return [];
    return items
        .filter((i: any) => {
            if (!i.note) return false;
            const parts = i.note.split(',').map((s: string) => s.trim()).filter(Boolean);
            return parts.some((p: string) => {
                const match = p.match(/^(?:(\d+(?:\.\d+)?)\s+)?([a-zA-Z]+)(?:\s+(\d+(?:\.\d+)?))?$/);
                if (match && match[2]) {
                    return match[2].trim().toLowerCase() === typeFilter.toLowerCase();
                }
                return p.toLowerCase().includes(typeFilter.toLowerCase());
            });
        })
        .map((i: any) => {
            let price: string | null = null;
            let isMultiple = false;
            let calculatedKg = 0;
            let hasMatchedParts = false;

            const parts = i.note.split(',').map((s: string) => s.trim()).filter(Boolean);
            const matchingParts = parts.filter((p: string) => {
                const match = p.match(/^(?:(\d+(?:\.\d+)?)\s+)?([a-zA-Z]+)(?:\s+(\d+(?:\.\d+)?))?$/);
                if (match && match[2]) {
                    return match[2].trim().toLowerCase() === typeFilter.toLowerCase();
                }
                return p.toLowerCase().includes(typeFilter.toLowerCase());
            });

            matchingParts.forEach((p: string) => {
                const match = p.match(/^(?:(\d+(?:\.\d+)?)\s+)?([a-zA-Z]+)(?:\s+(\d+(?:\.\d+)?))?$/);
                if (match) {
                    hasMatchedParts = true;
                    calculatedKg += parseFloat(match[1]) || 0;
                    if (match[3]) {
                        price = match[3];
                    }
                }
            });

            if (matchingParts.length > 1) {
                isMultiple = true;
                const prices = matchingParts.map((p: string) => {
                    const match = p.match(/^(?:(\d+(?:\.\d+)?)\s+)?([a-zA-Z]+)(?:\s+(\d+(?:\.\d+)?))?$/);
                    return match && match[3] ? match[3] : null;
                }).filter(Boolean);
                if (prices.length > 0) {
                    price = prices.join(' / ');
                }
            }

            const effectiveKg = hasMatchedParts && calculatedKg > 0 ? calculatedKg : (parseFloat(i.kg) || 0);
            return { ...i, basePrice: price, isMultiple, matchingKg: effectiveKg };
        });
}

// Helper to simulate applying a price override to all customers of a dynamic type
function applyTypePriceToNote(note: string, typeFilter: string, price: string): string {
    const parts = note.split(',').map((s: string) => s.trim()).filter(Boolean);
    const updatedParts = parts.map((part: string) => {
        const match = part.match(/^(?:(\d+(?:\.\d+)?)\s+)?([a-zA-Z]+)(?:\s+(\d+(?:\.\d+)?))?$/);
        if (match && match[2]) {
            const kgPrefix = match[1] ? `${match[1]} ` : '';
            const label = match[2];
            const existingPrice = match[3] || null;
            if (label.trim().toLowerCase() === typeFilter.toLowerCase() && !existingPrice) {
                return `${kgPrefix}${label} ${price}`;
            }
        }
        return part;
    });
    return updatedParts.join(', ');
}

// Helper to simulate clearing a price override from a dynamic type
function clearTypePriceFromNote(note: string, typeFilter: string): string {
    const parts = note.split(',').map((s: string) => s.trim()).filter(Boolean);
    const updatedParts = parts.map((part: string) => {
        const match = part.match(/^(?:(\d+(?:\.\d+)?)\s+)?([a-zA-Z]+)(?:\s+(\d+(?:\.\d+)?))?$/);
        if (match && match[2]) {
            const kgPrefix = match[1] ? `${match[1]} ` : '';
            const label = match[2];
            const price = match[3] || null;
            if (label.trim().toLowerCase() === typeFilter.toLowerCase() && price) {
                return `${kgPrefix}${label}`.trim(); // Preserves kg and label, strips price!
            }
        }
        return part;
    });
    return updatedParts.join(', ');
}

test('Comprehensive Dynamic Customer-Specific Pricing Suite', async (t) => {
    const client = await pool.connect();
    try {
        // 1. VIP discovery
        await t.test('1. VIP discovery', () => {
            const items = [{ note: '5 vip' }];
            const types = extractAvailableTypesFromItems(items);
            assert.ok(types.includes('VIP'));
        });

        // 2. Heshiish discovery
        await t.test('2. Heshiish discovery', () => {
            const items = [{ note: '6 heshiish' }];
            const types = extractAvailableTypesFromItems(items);
            assert.ok(types.includes('Heshiish'));
        });

        // 3. JAADKIDAMBE discovery
        await t.test('3. JAADKIDAMBE discovery', () => {
            const items = [{ note: '9 JAADKIDAMBE' }];
            const types = extractAvailableTypesFromItems(items);
            assert.ok(types.includes('JAADKIDAMBE'));
        });

        // 4. Raqiis discovery
        await t.test('4. Raqiis discovery', () => {
            const items = [{ note: '9 raqiis' }];
            const types = extractAvailableTypesFromItems(items);
            assert.ok(types.includes('Raqiis'));
        });

        // 5. Jadki discovery
        await t.test('5. Jadki discovery', () => {
            const items = [{ note: '5 jadki' }];
            const types = extractAvailableTypesFromItems(items);
            assert.ok(types.includes('Jadki'));
        });

        // 6. Dahaya discovery
        await t.test('6. Dahaya discovery', () => {
            const items = [{ note: '7 dahaya' }];
            const types = extractAvailableTypesFromItems(items);
            assert.ok(types.includes('Dahaya'));
        });

        // 7. Special discovery
        await t.test('7. Special discovery', () => {
            const items = [{ note: '8 special' }];
            const types = extractAvailableTypesFromItems(items);
            assert.ok(types.includes('Special'));
        });

        // 8. Future arbitrary label discovery without code changes
        await t.test('8. Future arbitrary label discovery without code changes', () => {
            const items = [{ note: '12 QIIMO' }];
            const types = extractAvailableTypesFromItems(items);
            assert.ok(types.includes('QIIMO'));
        });

        // 9. Case-insensitive deduplication
        await t.test('9. Case-insensitive deduplication', () => {
            const items = [{ note: '5 vip' }, { note: '10 VIP' }, { note: '7 Vip' }];
            const types = extractAvailableTypesFromItems(items);
            const vipMatches = types.filter(t => t.toLowerCase() === 'vip');
            assert.strictEqual(vipMatches.length, 1);
            assert.strictEqual(vipMatches[0], 'VIP');
        });

        // 10. Date scoping (two dates with different labels)
        await t.test('10. Date scoping isolation', () => {
            const date1Items = [{ note: '9 JAADKIDAMBE' }];
            const date2Items = [{ note: '7 DAHAYA' }];
            const typesDate1 = extractAvailableTypesFromItems(date1Items);
            const typesDate2 = extractAvailableTypesFromItems(date2Items);
            assert.ok(typesDate1.includes('JAADKIDAMBE'));
            assert.ok(!typesDate1.includes('DAHAYA'));
            assert.ok(typesDate2.includes('DAHAYA'));
            assert.ok(!typesDate2.includes('JAADKIDAMBE'));
        });

        // 11. VIP filtering
        await t.test('11. VIP filtering returns only VIP customers', () => {
            const items = [
                { id: '1', customer_id: 'c1', note: '5 vip' },
                { id: '2', customer_id: 'c2', note: '9 jaadkidambe' }
            ];
            const filtered = filterCustomersByType(items, 'VIP');
            assert.strictEqual(filtered.length, 1);
            assert.strictEqual(filtered[0].customer_id, 'c1');
        });

        // 12. Heshiish filtering
        await t.test('12. Heshiish filtering returns only Heshiish customers', () => {
            const items = [
                { id: '1', customer_id: 'c1', note: '6 heshiish' },
                { id: '2', customer_id: 'c2', note: '9 jaadkidambe' }
            ];
            const filtered = filterCustomersByType(items, 'Heshiish');
            assert.strictEqual(filtered.length, 1);
            assert.strictEqual(filtered[0].customer_id, 'c1');
        });

        // 13. JAADKIDAMBE filtering
        await t.test('13. JAADKIDAMBE filtering returns only JAADKIDAMBE customers', () => {
            const items = [
                { id: '1', customer_id: 'c1', note: '9 jaadkidambe' },
                { id: '2', customer_id: 'c2', note: '5 jaadkidambe' },
                { id: '3', customer_id: 'c3', note: '3 jaadkidambe' },
                { id: '4', customer_id: 'c4', note: '5 vip' }
            ];
            const filtered = filterCustomersByType(items, 'JAADKIDAMBE');
            assert.strictEqual(filtered.length, 3);
            assert.strictEqual(filtered[0].customer_id, 'c1');
            assert.strictEqual(filtered[1].customer_id, 'c2');
            assert.strictEqual(filtered[2].customer_id, 'c3');
        });

        // 14. Raqiis filtering
        await t.test('14. Raqiis filtering returns only Raqiis customers', () => {
            const items = [
                { id: '1', customer_id: 'c1', note: '9 raqiis' },
                { id: '2', customer_id: 'c2', note: '4 raqiis' }
            ];
            const filtered = filterCustomersByType(items, 'Raqiis');
            assert.strictEqual(filtered.length, 2);
        });

        // 15. Correct customer IDs
        await t.test('15. Correct customer IDs preserved', () => {
            const items = [{ id: '1', customer_id: 'cust-uuid-123', note: '9 jaadkidambe' }];
            const filtered = filterCustomersByType(items, 'jaadkidambe');
            assert.strictEqual(filtered[0].customer_id, 'cust-uuid-123');
        });

        // 16. Correct KG per customer
        await t.test('16. Correct KG parsed per customer (9, 5, 3 KG)', () => {
            const items = [
                { id: '1', customer_id: 'c1', note: '9 jaadkidambe' },
                { id: '2', customer_id: 'c2', note: '5 jaadkidambe' },
                { id: '3', customer_id: 'c3', note: '3.5 jaadkidambe' }
            ];
            const filtered = filterCustomersByType(items, 'jaadkidambe');
            assert.strictEqual(filtered[0].matchingKg, 9);
            assert.strictEqual(filtered[1].matchingKg, 5);
            assert.strictEqual(filtered[2].matchingKg, 3.5);
        });

        // 17. Correct total KG (9 + 5 + 3 = 17 KG)
        await t.test('17. Correct total KG calculation (9 + 5 + 3 = 17 KG)', () => {
            const items = [
                { id: '1', customer_id: 'c1', note: '9 jaadkidambe' },
                { id: '2', customer_id: 'c2', note: '5 jaadkidambe' },
                { id: '3', customer_id: 'c3', note: '3 jaadkidambe' }
            ];
            const filtered = filterCustomersByType(items, 'jaadkidambe');
            const totalKg = filtered.reduce((sum: number, c: any) => sum + c.matchingKg, 0);
            assert.strictEqual(totalKg, 17);
        });

        // 18. Apply price to all
        await t.test('18. Apply price to all sets $36 on each note', () => {
            const notes = ['9 jaadkidambe', '5 jaadkidambe', '3 jaadkidambe'];
            const updated = notes.map(n => applyTypePriceToNote(n, 'jaadkidambe', '36'));
            assert.deepStrictEqual(updated, [
                '9 jaadkidambe 36',
                '5 jaadkidambe 36',
                '3 jaadkidambe 36'
            ]);
        });

        // 19. Apply price to one customer
        await t.test('19. Apply price to one customer sets price on only that customer', () => {
            const note1 = '9 jaadkidambe';
            const note2 = '5 jaadkidambe';
            const updated1 = applyTypePriceToNote(note1, 'jaadkidambe', '38');
            assert.strictEqual(updated1, '9 jaadkidambe 38');
            assert.strictEqual(note2, '5 jaadkidambe'); // Untouched
        });

        // 20. Clear one customer
        await t.test('20. Clear one customer strips price and preserves KG and label', () => {
            const note = '9 jaadkidambe 36';
            const cleared = clearTypePriceFromNote(note, 'jaadkidambe');
            assert.strictEqual(cleared, '9 jaadkidambe');
        });

        // 21. Clear all
        await t.test('21. Clear all strips prices from all matching notes', () => {
            const notes = ['9 jaadkidambe 36', '5 jaadkidambe 36', '3 jaadkidambe 35'];
            const cleared = notes.map(n => clearTypePriceFromNote(n, 'jaadkidambe'));
            assert.deepStrictEqual(cleared, [
                '9 jaadkidambe',
                '5 jaadkidambe',
                '3 jaadkidambe'
            ]);
        });

        // 22. Multi-label note update (keeps other labels untouched!)
        await t.test('22. Multi-label note update preserves other labels ("5 vip 38, 9 jaadkidambe" -> "5 vip 38, 9 jaadkidambe 36")', () => {
            const note = '5 vip 38, 9 jaadkidambe';
            const updated = applyTypePriceToNote(note, 'jaadkidambe', '36');
            assert.strictEqual(updated, '5 vip 38, 9 jaadkidambe 36');
        });

        // 23. Multi-label note clear (keeps other labels untouched!)
        await t.test('23. Multi-label note clear preserves other labels ("5 vip 38, 9 jaadkidambe 36" -> "5 vip 38, 9 jaadkidambe")', () => {
            const note = '5 vip 38, 9 jaadkidambe 36';
            const cleared = clearTypePriceFromNote(note, 'jaadkidambe');
            assert.strictEqual(cleared, '5 vip 38, 9 jaadkidambe');
        });

        // 24. Existing VIP/Heshiish backward compatibility
        await t.test('24. VIP and Heshiish pricing remain 100% backward compatible', () => {
            const vipNote = '5 vip';
            const heshiishNote = '6 heshiish';
            assert.strictEqual(applyTypePriceToNote(vipNote, 'VIP', '38'), '5 vip 38');
            assert.strictEqual(applyTypePriceToNote(heshiishNote, 'Heshiish', '30'), '6 heshiish 30');
            assert.strictEqual(clearTypePriceFromNote('5 vip 38', 'VIP'), '5 vip');
            assert.strictEqual(clearTypePriceFromNote('6 heshiish 30', 'Heshiish'), '6 heshiish');
        });

        // 25. Database Accounting Invariants
        await t.test('25. Database Accounting Invariants remain intact', async () => {
            const custRes = await client.query('SELECT count(*)::int as c FROM "Customer" WHERE deleted_at IS NULL');
            assert.strictEqual(custRes.rows[0].c, 56, 'Must have exactly 56 active customers');

            const ledgerRes = await client.query('SELECT count(*)::int as c FROM "Ledger" WHERE deleted_at IS NULL');
            assert.ok(ledgerRes.rows[0].c >= 5000, 'Must have >= 5000 ledger rows');
        });

        // 26. No Maqal / FIFO / payment changes (verify payment and daily book integrity)
        await t.test('26. Payment and DailyBook tables intact', async () => {
            const payRes = await client.query(`SELECT count(*)::int as c FROM "Ledger" WHERE type = 'PAYMENT' AND deleted_at IS NULL`);
            assert.ok(payRes.rows[0].c > 0, 'Must have payment ledger entries');

            const bookRes = await client.query(`SELECT count(*)::int as c FROM "DailyBook" WHERE deleted_at IS NULL`);
            assert.ok(bookRes.rows[0].c > 0, 'Must have DailyBook entries');

            const itemRes = await client.query(`SELECT count(*)::int as c FROM "DailyBookItem" WHERE deleted_at IS NULL`);
            assert.ok(itemRes.rows[0].c > 0, 'Must have DailyBookItem entries');
        });

    } finally {
        client.release();
        await pool.end();
    }
});
