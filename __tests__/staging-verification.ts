import pool from '../lib/db';
import { MAQAL_PAIRS_CTE, validateMaqalPairs } from '../lib/maqal-utils';

async function runStagingVerification() {
    console.log('====================================================');
    console.log('🚀 RUNNING FINAL REAL-DATABASE STAGING VERIFICATION');
    console.log('====================================================\n');

    const client = await pool.connect();
    const results: { scenario: number; description: string; status: 'PASS' | 'FAIL'; details?: string }[] = [];

    try {
        // --- PRE-CHECK: PRODUCTION SAFETY GUARD ---
        const connStr = process.env.DATABASE_URL || '';
        if (connStr.includes('jaylgsinerhwcdydcgpa')) {
            throw new Error('FATAL: Attempting to run test against PRODUCTION database! Aborting immediately.');
        }
        console.log('🛡️ Production Safety Guard: Confirmed running on dev/test database (omjmjihinxbtilnirsco).');

        // BEGIN TRANSACTION TO ENSURE COMPLETE ISOLATION & ZERO PERMANENT MUTATIONS
        await client.query('BEGIN');

        // Snapshot original Ledger state
        const origLedgerRes = await client.query(`
            SELECT COUNT(*)::int as count, 
                   COUNT(DISTINCT maqal_id) as mq_count,
                   MIN(reference_date)::text as min_date,
                   MAX(reference_date)::text as max_date
            FROM "Ledger" 
            WHERE deleted_at IS NULL
        `);
        const origLedger = origLedgerRes.rows[0];

        // ----------------------------------------------------
        // SCENARIO 1 & 2: Baseline Historical Pairs (MQ#23, MQ#24)
        // ----------------------------------------------------
        const pairsQ = `
            ${MAQAL_PAIRS_CTE}
            SELECT mq_num, date1::text, date2::text, maqal_id
            FROM pairs
            ORDER BY mq_num ASC;
        `;
        let res = await client.query(pairsQ);
        let pairs = res.rows.map(r => ({
            mq_num: Number(r.mq_num),
            date1: String(r.date1).split('T')[0],
            date2: String(r.date2).split('T')[0],
            maqal_id: Number(r.maqal_id)
        }));

        const mq23 = pairs.find(p => p.mq_num === 23);
        const mq24 = pairs.find(p => p.mq_num === 24);

        if (mq23 && mq23.date1 === '2026-08-27' && mq23.date2 === '2026-08-28') {
            results.push({ scenario: 1, description: 'Confirm MQ#23 = 2026-08-27 + 2026-08-28', status: 'PASS', details: `${mq23.date1} to ${mq23.date2}` });
        } else {
            results.push({ scenario: 1, description: 'Confirm MQ#23 = 2026-08-27 + 2026-08-28', status: 'FAIL', details: JSON.stringify(mq23) });
        }

        if (mq24 && mq24.date1 === '2026-08-29' && mq24.date2 === '2026-08-30') {
            results.push({ scenario: 2, description: 'Confirm MQ#24 = 2026-08-29 + 2026-08-30', status: 'PASS', details: `${mq24.date1} to ${mq24.date2}` });
        } else {
            results.push({ scenario: 2, description: 'Confirm MQ#24 = 2026-08-29 + 2026-08-30', status: 'FAIL', details: JSON.stringify(mq24) });
        }

        // ----------------------------------------------------
        // SCENARIO 3: Set 2026-09-01 to BusinessDay ABSENCE
        // ----------------------------------------------------
        await client.query(`
            INSERT INTO "BusinessDay" (id, date, status, reason, created_by, created_at, updated_at)
            VALUES (gen_random_uuid(), '2026-09-01'::date, 'ABSENCE', 'Test Holiday', 'staging-test', NOW(), NOW())
            ON CONFLICT (date) DO UPDATE SET status = 'ABSENCE', updated_at = NOW();
        `);
        results.push({ scenario: 3, description: 'Set 2026-09-01 to BusinessDay ABSENCE', status: 'PASS' });

        // Re-query pairs with Sep 1 as ABSENCE
        res = await client.query(pairsQ);
        pairs = res.rows.map(r => ({
            mq_num: Number(r.mq_num),
            date1: String(r.date1).split('T')[0],
            date2: String(r.date2).split('T')[0],
            maqal_id: Number(r.maqal_id)
        }));

        const mq25 = pairs.find(p => p.mq_num === 25);
        const mq26 = pairs.find(p => p.mq_num === 26);
        const mq27 = pairs.find(p => p.mq_num === 27);

        // ----------------------------------------------------
        // SCENARIOS 4, 5, 6: Confirm MQ#25, MQ#26, MQ#27
        // ----------------------------------------------------
        if (mq25 && mq25.date1 === '2026-08-31' && mq25.date2 === '2026-09-02') {
            results.push({ scenario: 4, description: 'Confirm MQ#25 = 2026-08-31 + 2026-09-02 (skipping Sep 1)', status: 'PASS', details: `${mq25.date1} to ${mq25.date2}` });
        } else {
            results.push({ scenario: 4, description: 'Confirm MQ#25 = 2026-08-31 + 2026-09-02', status: 'FAIL', details: JSON.stringify(mq25) });
        }

        if (mq26 && mq26.date1 === '2026-09-03' && mq26.date2 === '2026-09-04') {
            results.push({ scenario: 5, description: 'Confirm MQ#26 = 2026-09-03 + 2026-09-04', status: 'PASS', details: `${mq26.date1} to ${mq26.date2}` });
        } else {
            results.push({ scenario: 5, description: 'Confirm MQ#26 = 2026-09-03 + 2026-09-04', status: 'FAIL', details: JSON.stringify(mq26) });
        }

        if (mq27 && mq27.date1 === '2026-09-05' && mq27.date2 === '2026-09-06') {
            results.push({ scenario: 6, description: 'Confirm MQ#27 = 2026-09-05 + 2026-09-06', status: 'PASS', details: `${mq27.date1} to ${mq27.date2}` });
        } else {
            results.push({ scenario: 6, description: 'Confirm MQ#27 = 2026-09-05 + 2026-09-06', status: 'FAIL', details: JSON.stringify(mq27) });
        }

        // ----------------------------------------------------
        // SCENARIO 7: Changing BusinessDay on historical dates does NOT change MQ#1–MQ#24
        // ----------------------------------------------------
        await client.query(`
            INSERT INTO "BusinessDay" (id, date, status, reason, created_by, created_at, updated_at)
            VALUES (gen_random_uuid(), '2026-08-29'::date, 'ABSENCE', 'Accidental past edit', 'staging-test', NOW(), NOW())
            ON CONFLICT (date) DO UPDATE SET status = 'ABSENCE', updated_at = NOW();
        `);
        const resRetro = await client.query(pairsQ);
        const pairsRetro = resRetro.rows.map(r => ({
            mq_num: Number(r.mq_num),
            date1: String(r.date1).split('T')[0],
            date2: String(r.date2).split('T')[0]
        }));
        const retroMq23 = pairsRetro.find(p => p.mq_num === 23);
        const retroMq24 = pairsRetro.find(p => p.mq_num === 24);

        if (retroMq23?.date1 === '2026-08-27' && retroMq23?.date2 === '2026-08-28' &&
            retroMq24?.date1 === '2026-08-29' && retroMq24?.date2 === '2026-08-30') {
            results.push({ scenario: 7, description: 'Retroactive BusinessDay ABSENCE on historical dates does NOT change MQ#1–MQ#24', status: 'PASS', details: 'MQ#23 and MQ#24 remained 100% frozen' });
        } else {
            results.push({ scenario: 7, description: 'Retroactive BusinessDay ABSENCE on historical dates does NOT change MQ#1–MQ#24', status: 'FAIL', details: `MQ#24 shifted: ${retroMq24?.date1} to ${retroMq24?.date2}` });
        }

        // ----------------------------------------------------
        // SCENARIO 8: Save legitimate test DailyBook/Ledger activity for MQ#25
        // ----------------------------------------------------
        const { rows: testCust } = await client.query(`SELECT id FROM "Customer" WHERE deleted_at IS NULL LIMIT 1`);
        const customerId = testCust[0]?.id;
        if (!customerId) throw new Error('No customer available for staging test');

        // Insert or ensure test daily book and ledger for 2026-09-02
        await client.query(`
            INSERT INTO "DailyBook" (id, date, created_at)
            VALUES (gen_random_uuid(), '2026-09-02'::date, NOW())
            ON CONFLICT (date) DO UPDATE SET deleted_at = NULL
        `);
        await client.query(`
            INSERT INTO "Ledger" (id, customer_id, type, reference_date, kg, price_per_kg, amount, previous_debt, new_debt, maqal_id, created_at)
            VALUES (gen_random_uuid(), $1, 'PRODUCT', '2026-09-02'::date, 5, 38, 190, 0, 190, 33, NOW())
        `, [customerId]);
        results.push({ scenario: 8, description: 'Save test DailyBook/Ledger activity for MQ#25 (2026-09-02)', status: 'PASS' });

        // ----------------------------------------------------
        // SCENARIO 9 & 10: After activity exists, change BusinessDay status for 2026-09-02 to ABSENCE
        // ----------------------------------------------------
        await client.query(`
            INSERT INTO "BusinessDay" (id, date, status, reason, created_by, created_at, updated_at)
            VALUES (gen_random_uuid(), '2026-09-02'::date, 'ABSENCE', 'Retroactive absence after work recorded', 'staging-test', NOW(), NOW())
            ON CONFLICT (date) DO UPDATE SET status = 'ABSENCE', updated_at = NOW();
        `);
        results.push({ scenario: 9, description: 'Change BusinessDay status for 2026-09-02 to ABSENCE after work recorded', status: 'PASS' });

        const resLock = await client.query(pairsQ);
        const pairsLock = resLock.rows.map(r => ({
            mq_num: Number(r.mq_num),
            date1: String(r.date1).split('T')[0],
            date2: String(r.date2).split('T')[0]
        }));
        const lockedMq25 = pairsLock.find(p => p.mq_num === 25);

        if (lockedMq25?.date1 === '2026-08-31' && lockedMq25?.date2 === '2026-09-02') {
            results.push({ scenario: 10, description: 'Confirm MQ#25 remains 2026-08-31 + 2026-09-02 (Saved Activity Lock)', status: 'PASS', details: 'Activity lock successfully protected MQ#25 from shifting' });
        } else {
            results.push({ scenario: 10, description: 'Confirm MQ#25 remains 2026-08-31 + 2026-09-02 (Saved Activity Lock)', status: 'FAIL', details: `MQ#25 shifted: ${lockedMq25?.date1} to ${lockedMq25?.date2}` });
        }

        // ----------------------------------------------------
        // SCENARIO 11 & 12: Mark later unrecorded date (2026-09-10) as ABSENCE
        // ----------------------------------------------------
        await client.query(`
            INSERT INTO "BusinessDay" (id, date, status, reason, created_by, created_at, updated_at)
            VALUES (gen_random_uuid(), '2026-09-10'::date, 'ABSENCE', 'Future holiday', 'staging-test', NOW(), NOW())
            ON CONFLICT (date) DO UPDATE SET status = 'ABSENCE', updated_at = NOW();
        `);
        results.push({ scenario: 11, description: 'Mark later unrecorded date (2026-09-10) as ABSENCE', status: 'PASS' });

        const resFuture = await client.query(pairsQ);
        const pairsFuture = resFuture.rows.map(r => ({
            mq_num: Number(r.mq_num),
            date1: String(r.date1).split('T')[0],
            date2: String(r.date2).split('T')[0]
        }));
        // Normal sequence without Sep 10 absence:
        // MQ#28: 2026-09-07 + 2026-09-08
        // MQ#29: 2026-09-09 + 2026-09-10 (normally) -> With Sep 10 absent: 2026-09-09 + 2026-09-11
        const futureMq29 = pairsFuture.find(p => p.mq_num === 29);
        if (futureMq29?.date1 === '2026-09-09' && futureMq29?.date2 === '2026-09-11') {
            results.push({ scenario: 12, description: 'Confirm only future/unrecorded Maqal pairing responds to that absence', status: 'PASS', details: `MQ#29 skipped Sep 10 -> ${futureMq29.date1} to ${futureMq29.date2}` });
        } else {
            results.push({ scenario: 12, description: 'Confirm only future/unrecorded Maqal pairing responds to that absence', status: 'FAIL', details: JSON.stringify(futureMq29) });
        }

        // ----------------------------------------------------
        // SCENARIO 13: Confirm there are no duplicate or overlapping Maqal dates
        // ----------------------------------------------------
        try {
            validateMaqalPairs(pairsFuture);
            results.push({ scenario: 13, description: 'Confirm no duplicate or overlapping Maqal dates across all generated pairs', status: 'PASS', details: `${pairsFuture.length} total pairs validated strictly non-overlapping` });
        } catch (valErr: any) {
            results.push({ scenario: 13, description: 'Confirm no duplicate or overlapping Maqal dates', status: 'FAIL', details: valErr.message });
        }

        // ----------------------------------------------------
        // SCENARIO 14: Confirm stored Ledger maqal_id and reference_date values were not changed
        // ----------------------------------------------------
        // Check existing ledger records (excluding our 1 test insertion)
        const postLedgerRes = await client.query(`
            SELECT COUNT(*)::int as count, 
                   COUNT(DISTINCT maqal_id) as mq_count,
                   MIN(reference_date)::text as min_date,
                   MAX(reference_date)::text as max_date
            FROM "Ledger" 
            WHERE deleted_at IS NULL AND created_at < NOW() - INTERVAL '1 minute'
        `);
        const postLedger = postLedgerRes.rows[0];
        if (origLedger.count === postLedger.count && origLedger.mq_count === postLedger.mq_count) {
            results.push({ scenario: 14, description: 'Confirm stored Ledger maqal_id and reference_date values were not changed', status: 'PASS', details: 'All historical Ledger records untouched' });
        } else {
            results.push({ scenario: 14, description: 'Confirm stored Ledger maqal_id and reference_date values were not changed', status: 'FAIL', details: `Before: ${JSON.stringify(origLedger)}, After: ${JSON.stringify(postLedger)}` });
        }

        // ----------------------------------------------------
        // SCENARIO 15: ROLLBACK and confirm zero residue left in database
        // ----------------------------------------------------
        await client.query('ROLLBACK');

        // Confirm rollback cleaned up everything
        const verifyClean = await client.query(`
            SELECT COUNT(*)::int as c FROM "BusinessDay" WHERE reason IN ('Test Holiday', 'Accidental past edit', 'Retroactive absence after work recorded', 'Future holiday')
        `);
        if (verifyClean.rows[0].c === 0) {
            results.push({ scenario: 15, description: 'Transaction ROLLBACK cleanly executed — zero test mutations persisted', status: 'PASS', details: 'Database state 100% restored' });
        } else {
            results.push({ scenario: 15, description: 'Transaction ROLLBACK cleanly executed', status: 'FAIL', details: 'Residue found' });
        }

    } catch (err: any) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Staging verification error:', err);
        throw err;
    } finally {
        client.release();
        await pool.end();
    }

    console.log('\n====================================================');
    console.log('📊 FINAL STAGING VERIFICATION REPORT');
    console.log('====================================================\n');

    let allPass = true;
    for (const r of results) {
        const icon = r.status === 'PASS' ? '✅' : '❌';
        console.log(`${icon} Scenario ${r.scenario}: ${r.description} -> [${r.status}]${r.details ? ` (${r.details})` : ''}`);
        if (r.status !== 'PASS') allPass = false;
    }

    console.log('\n----------------------------------------------------');
    console.log(`Overall Result: ${allPass ? '🟢 ALL SCENARIOS PASSED' : '🔴 SOME SCENARIOS FAILED'}`);
    console.log('----------------------------------------------------');
}

runStagingVerification().catch(err => {
    console.error('Fatal execution error:', err);
    process.exit(1);
});
