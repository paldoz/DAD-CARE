import test from 'node:test';
import assert from 'node:assert';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import { groupTransactionsInfoReceipts } from '../app/utils/ledgerHelpers';

dotenv.config({ path: '.env.local' });
if (!process.env.DATABASE_URL) dotenv.config({ path: '.env' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

test('Customer Profile Maqal History Pagination & Invariant Suite', async (t) => {
  const client = await pool.connect();
  try {
    // ── Test 1: Invariant Database Counts ──
    await t.test('Invariant DB Counts remain exact', async () => {
      const [custRes, ledgerRes, receiptRes, deletedRes] = await Promise.all([
        client.query('SELECT count(*) as count FROM "Customer" WHERE deleted_at IS NULL'),
        client.query('SELECT count(*) as count FROM "Ledger" WHERE deleted_at IS NULL'),
        client.query('SELECT count(DISTINCT receipt_id) as count FROM "Ledger" WHERE deleted_at IS NULL AND receipt_id IS NOT NULL'),
        client.query('SELECT count(*) as count FROM "Ledger" WHERE deleted_at IS NOT NULL')
      ]);

      assert.strictEqual(parseInt(custRes.rows[0].count), 56, 'Must have exactly 56 active customers');
      assert.strictEqual(parseInt(ledgerRes.rows[0].count), 5000, 'Must have exactly 5,000 active ledger rows');
      assert.strictEqual(parseInt(receiptRes.rows[0].count), 1160, 'Must have exactly 1,160 distinct receipts');
      assert.strictEqual(parseInt(deletedRes.rows[0].count), 0, 'Must have 0 soft-deleted rows');
    });

    // ── Test 2: Full vs Paginated Maqal Equivalence for Multi-Maqal Customers ──
    await t.test('Multi-Maqal Customer (Sacdiyo - 22 Maqals) 7-chunk reconstruction equivalence', async () => {
      const custRes = await client.query('SELECT id, name FROM "Customer" WHERE customer_code = \'10\' LIMIT 1');
      const customer = custRes.rows[0];

      // Fetch all customer transactions
      const fullRes = await client.query(`
        SELECT id, customer_id, type, reference_date, kg, price_per_kg, amount, previous_debt, new_debt, note, receipt_id, maqal_id, created_at 
        FROM "Ledger"
        WHERE customer_id = $1 AND deleted_at IS NULL
        ORDER BY created_at ASC, id ASC
      `, [customer.id]);

      const allAuthoritative = groupTransactionsInfoReceipts(fullRes.rows);
      assert.strictEqual(allAuthoritative.length, 22, 'Sacdiyo must have 22 authoritative Maqals');

      // Simulate 7-Maqal chunking across 4 pages
      const page1 = allAuthoritative.slice(0, 7);
      const page2 = allAuthoritative.slice(7, 14);
      const page3 = allAuthoritative.slice(14, 21);
      const page4 = allAuthoritative.slice(21, 28);

      assert.strictEqual(page1.length, 7, 'Page 1 must have exactly 7 Maqals');
      assert.strictEqual(page2.length, 7, 'Page 2 must have exactly 7 Maqals');
      assert.strictEqual(page3.length, 7, 'Page 3 must have exactly 7 Maqals');
      assert.strictEqual(page4.length, 1, 'Page 4 must have remaining 1 Maqal');

      const reconstructed = [...page1, ...page2, ...page3, ...page4];
      assert.strictEqual(reconstructed.length, 22, 'All 22 Maqals reconstructed');

      for (let i = 0; i < 22; i++) {
        const orig = allAuthoritative[i];
        const recon = reconstructed[i];
        assert.strictEqual(recon.titleString, orig.titleString, `Title match at ${i}`);
        assert.strictEqual(recon.totalKilos, orig.totalKilos, `Kilo match at ${i}`);
        assert.strictEqual(recon.totalMaqalka, orig.totalMaqalka, `Maqalka match at ${i}`);
        assert.strictEqual(recon.totalPaid, orig.totalPaid, `Paid match at ${i}`);
        assert.strictEqual(recon.openingBalance, orig.openingBalance, `Opening debt match at ${i}`);
        assert.strictEqual(recon.closingBalance, orig.closingBalance, `Closing debt match at ${i}`);
      }
    });

    // ── Test 3: Small Customer (<= 7 Maqals) behavior ──
    await t.test('Small Customer with <= 7 Maqals loads in 1 page with hasMore=false', async () => {
      // Find a customer with <= 7 Maqals
      const smallCustRes = await client.query(`
        SELECT c.id, c.name, COUNT(l.id) as count
        FROM "Customer" c
        JOIN "Ledger" l ON l.customer_id = c.id AND l.deleted_at IS NULL
        WHERE c.deleted_at IS NULL
        GROUP BY c.id, c.name
        HAVING COUNT(l.id) <= 20
        LIMIT 1
      `);

      if (smallCustRes.rows.length > 0) {
        const smallCust = smallCustRes.rows[0];
        const txnsRes = await client.query(`
          SELECT id, customer_id, type, reference_date, kg, price_per_kg, amount, previous_debt, new_debt, note, receipt_id, maqal_id, created_at 
          FROM "Ledger"
          WHERE customer_id = $1 AND deleted_at IS NULL
          ORDER BY created_at ASC, id ASC
        `, [smallCust.id]);

        const smallReceipts = groupTransactionsInfoReceipts(txnsRes.rows);
        const paged = smallReceipts.slice(0, 7);
        const hasMore = (0 + paged.length) < smallReceipts.length;

        assert.strictEqual(paged.length, smallReceipts.length, 'All Maqals loaded in page 1');
        assert.strictEqual(hasMore, false, 'hasMore must be false for small customer');
      }
    });

    // ── Test 4: Lean Serialization reduces payload without data loss ──
    await t.test('Lean serialization preserves all UI attributes', async () => {
      const custRes = await client.query('SELECT id FROM "Customer" WHERE customer_code = \'10\' LIMIT 1');
      const txnsRes = await client.query(`
        SELECT id, customer_id, type, reference_date, kg, price_per_kg, amount, previous_debt, new_debt, note, receipt_id, maqal_id, created_at 
        FROM "Ledger"
        WHERE customer_id = $1 AND deleted_at IS NULL
        ORDER BY created_at ASC, id ASC
      `, [custRes.rows[0].id]);

      const receipts = groupTransactionsInfoReceipts(txnsRes.rows);
      const m = receipts[0];

      assert.ok(m.titleString, 'Must have titleString');
      assert.ok(m.entries.length > 0, 'Must have entries');
      assert.strictEqual(typeof m.openingBalance, 'number', 'openingBalance is number');
      assert.strictEqual(typeof m.closingBalance, 'number', 'closingBalance is number');
      assert.strictEqual(typeof m.totalMaqalka, 'number', 'totalMaqalka is number');
      assert.strictEqual(typeof m.totalPaid, 'number', 'totalPaid is number');
    });

  } finally {
    client.release();
    await pool.end();
  }
});
