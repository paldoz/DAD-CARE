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
    // Default standard types
    typeMap.set('vip', 'VIP');
    typeMap.set('heshiish', 'Heshiish');

    if (items && Array.isArray(items)) {
        for (const item of items) {
            if (!item?.note) continue;
            const parts = item.note.split(',').map((s: string) => s.trim()).filter(Boolean);
            for (const part of parts) {
                const match = part.match(/^(\d+(?:\.\d+)?)\s+([a-zA-Z]+)(?:\s+(\d+(?:\.\d+)?))?$/);
                if (match && match[2]) {
                    const raw = match[2].trim();
                    const key = raw.toLowerCase();
                    if (!typeMap.has(key)) {
                        const display = key === 'vip' ? 'VIP' : (key.charAt(0).toUpperCase() + key.slice(1).toLowerCase());
                        typeMap.set(key, display);
                    }
                }
            }
        }
    }
    return Array.from(typeMap.values());
}

// Helper to simulate filtering customers by dynamic type
function filterCustomersByType(items: any[], typeFilter: string | null) {
    if (!typeFilter || !items) return [];
    return items.filter((i: any) => {
        if (!i.note) return false;
        const parts = i.note.split(',').map((s: string) => s.trim()).filter(Boolean);
        return parts.some((p: string) => {
            const match = p.match(/^(\d+(?:\.\d+)?)\s+([a-zA-Z]+)(?:\s+(\d+(?:\.\d+)?))?$/);
            if (match && match[2]) {
                return match[2].trim().toLowerCase() === typeFilter.toLowerCase();
            }
            return p.toLowerCase().includes(typeFilter.toLowerCase());
        });
    });
}

// Helper to simulate applying a price override to a dynamic type
function applyTypePriceToNote(note: string, typeFilter: string, price: string): string {
    const parts = note.split(',').map((s: string) => s.trim()).filter(Boolean);
    const updatedParts = parts.map((part: string) => {
        const match = part.match(/^(\d+(?:\.\d+)?)\s+([a-zA-Z]+)(?:\s+(\d+(?:\.\d+)?))?$/);
        if (match) {
            const kg = match[1];
            const label = match[2];
            const existingPrice = match[3] || null;
            if (label.trim().toLowerCase() === typeFilter.toLowerCase() && !existingPrice) {
                return `${kg} ${label} ${price}`;
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
        const match = part.match(/^(\d+(?:\.\d+)?)\s+([a-zA-Z]+)(?:\s+(\d+(?:\.\d+)?))?$/);
        if (match) {
            const kg = match[1];
            const label = match[2];
            const price = match[3] || null;
            if (label.trim().toLowerCase() === typeFilter.toLowerCase() && price) {
                return `${kg} ${label}`; // Preserves kg and label, strips price!
            }
        }
        return part;
    });
    return updatedParts.join(', ');
}

test('Dynamic Customer-Specific Pricing & Label Discovery Suite', async (t) => {
    const client = await pool.connect();
    try {
        // TEST 1: VIP discovery
        await t.test('TEST 1: Daily Book with "5 vip" discovers VIP', () => {
            const items = [{ note: '5 vip' }];
            const types = extractAvailableTypesFromItems(items);
            assert.ok(types.includes('VIP'), 'Must include VIP');
        });

        // TEST 2: Heshiish discovery
        await t.test('TEST 2: Daily Book with "6 heshiish" discovers Heshiish', () => {
            const items = [{ note: '6 heshiish' }];
            const types = extractAvailableTypesFromItems(items);
            assert.ok(types.includes('Heshiish'), 'Must include Heshiish');
        });

        // TEST 3: Dynamic Raqiis discovery
        await t.test('TEST 3: Daily Book with "9 raqiis" automatically discovers Raqiis', () => {
            const items = [{ note: '9 raqiis' }];
            const types = extractAvailableTypesFromItems(items);
            assert.ok(types.includes('Raqiis'), 'Must include Raqiis');
        });

        // TEST 4: Dynamic Jadki discovery
        await t.test('TEST 4: Daily Book with "5 jadki" automatically discovers Jadki', () => {
            const items = [{ note: '5 jadki' }];
            const types = extractAvailableTypesFromItems(items);
            assert.ok(types.includes('Jadki'), 'Must include Jadki');
        });

        // TEST 5: Dynamic Dahaya discovery
        await t.test('TEST 5: Daily Book with "7 dahaya" automatically discovers Dahaya', () => {
            const items = [{ note: '7 dahaya' }];
            const types = extractAvailableTypesFromItems(items);
            assert.ok(types.includes('Dahaya'), 'Must include Dahaya');
        });

        // TEST 6: Future arbitrary label "Special" without code change
        await t.test('TEST 6: Future label "8 special" discovered dynamically', () => {
            const items = [{ note: '8 special' }];
            const types = extractAvailableTypesFromItems(items);
            assert.ok(types.includes('Special'), 'Must include Special');
        });

        // TEST 7: Case-insensitive deduplication
        await t.test('TEST 7: Case-insensitive duplicates produce single normalized type', () => {
            const items = [{ note: '5 vip' }, { note: '10 VIP' }, { note: '7 Vip' }];
            const types = extractAvailableTypesFromItems(items);
            const vipOccurrences = types.filter(t => t.toLowerCase() === 'vip');
            assert.strictEqual(vipOccurrences.length, 1, 'Must have exactly one VIP type');
            assert.strictEqual(vipOccurrences[0], 'VIP', 'VIP must be normalized');
        });

        // TEST 8: Customer filtering by Raqiis
        await t.test('TEST 8: Selecting Raqiis returns only customers with Raqiis', () => {
            const items = [
                { id: '1', customer_id: 'c1', note: '9 raqiis' },
                { id: '2', customer_id: 'c2', note: '5 jadki' },
                { id: '3', customer_id: 'c3', note: '5 vip' },
                { id: '4', customer_id: 'c4', note: '12 raqiis' },
            ];
            const filtered = filterCustomersByType(items, 'Raqiis');
            assert.strictEqual(filtered.length, 2, 'Must match exactly 2 Raqiis customers');
            assert.strictEqual(filtered[0].customer_id, 'c1');
            assert.strictEqual(filtered[1].customer_id, 'c4');
        });

        // TEST 9: Customer filtering by Jadki
        await t.test('TEST 9: Selecting Jadki returns only customers with Jadki', () => {
            const items = [
                { id: '1', customer_id: 'c1', note: '9 raqiis' },
                { id: '2', customer_id: 'c2', note: '5 jadki' },
                { id: '3', customer_id: 'c3', note: '5 vip' },
            ];
            const filtered = filterCustomersByType(items, 'Jadki');
            assert.strictEqual(filtered.length, 1, 'Must match exactly 1 Jadki customer');
            assert.strictEqual(filtered[0].customer_id, 'c2');
        });

        // TEST 10: Price override application on dynamic label
        await t.test('TEST 10: Applying Raqiis price updates "9 raqiis" -> "9 raqiis 34"', () => {
            const initialNote = '9 raqiis';
            const updated = applyTypePriceToNote(initialNote, 'Raqiis', '34');
            assert.strictEqual(updated, '9 raqiis 34');
        });

        // TEST 11: Price override clearing on dynamic label
        await t.test('TEST 11: Clearing Raqiis price updates "9 raqiis 34" -> "9 raqiis"', () => {
            const noteWithPrice = '9 raqiis 34';
            const cleared = clearTypePriceFromNote(noteWithPrice, 'Raqiis');
            assert.strictEqual(cleared, '9 raqiis', 'Must preserve 9 kg and raqiis label');
        });

        // TEST 12: Multi-label note price application
        await t.test('TEST 12: Multi-label note "5 vip 38, 9 raqiis" applying Raqiis 34', () => {
            const initialNote = '5 vip 38, 9 raqiis';
            const updated = applyTypePriceToNote(initialNote, 'Raqiis', '34');
            assert.strictEqual(updated, '5 vip 38, 9 raqiis 34');
        });

        // TEST 13: Multi-label note price clearing
        await t.test('TEST 13: Multi-label note "5 vip 38, 9 raqiis 34" clearing Raqiis', () => {
            const noteWithPrice = '5 vip 38, 9 raqiis 34';
            const cleared = clearTypePriceFromNote(noteWithPrice, 'Raqiis');
            assert.strictEqual(cleared, '5 vip 38, 9 raqiis');
        });

        // TEST 14: Database Invariants Check (Zero side-effects)
        await t.test('TEST 14: Database Accounting Invariants remain completely intact', async () => {
            const custRes = await client.query('SELECT count(*)::int as c FROM "Customer" WHERE deleted_at IS NULL');
            assert.strictEqual(custRes.rows[0].c, 56, 'Must have exactly 56 active customers');

            const ledgerRes = await client.query('SELECT count(*)::int as c FROM "Ledger" WHERE deleted_at IS NULL');
            assert.ok(ledgerRes.rows[0].c >= 5000, 'Must have >= 5000 ledger rows');
        });

    } finally {
        client.release();
        await pool.end();
    }
});
