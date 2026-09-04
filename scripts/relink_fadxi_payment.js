require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const PAYMENT_ID = 'f7fad11d-001f-4d58-b3ed-303aa7e0a577';
const FADXI_CUSTOMER_ID = 'f34f6e92-f53d-4aad-993c-82d504beb1c0';
const OLD_RECEIPT_ID = '2ce1fcf9-f56e-4346-86ce-23363a5c6cf0'; // Maqal #13
const OLD_MAQAL_ID = 21;
const NEW_RECEIPT_ID = 'c708cc04-5e1c-413c-90cd-1672aa6e2598'; // Maqal #24
const NEW_MAQAL_ID = 32;

async function execute() {
    const client = await pool.connect();
    try {
        console.log('=== STEP 1: BEFORE VALUES & SAFETY BACKUP ===');
        const beforeRes = await client.query(
            `SELECT * FROM "Ledger" WHERE id = $1`,
            [PAYMENT_ID]
        );

        if (beforeRes.rows.length === 0) {
            throw new Error(`Record with id ${PAYMENT_ID} not found`);
        }

        const beforeRow = beforeRes.rows[0];
        console.log('BEFORE Row Snapshot:');
        console.log(JSON.stringify(beforeRow, null, 2));

        // Save local backup snapshot
        const snapshotPath = path.join(__dirname, 'fadxi_payment_before_snapshot.json');
        fs.writeFileSync(snapshotPath, JSON.stringify(beforeRow, null, 2), 'utf8');
        console.log(`Saved safety snapshot to ${snapshotPath}`);

        // Validate BEFORE conditions
        if (beforeRow.customer_id !== FADXI_CUSTOMER_ID) {
            throw new Error(`Customer ID mismatch: expected ${FADXI_CUSTOMER_ID}, found ${beforeRow.customer_id}`);
        }
        if (Number(beforeRow.amount) !== 72) {
            throw new Error(`Amount mismatch: expected 72, found ${beforeRow.amount}`);
        }
        if (Number(beforeRow.previous_debt) !== 83) {
            throw new Error(`previous_debt mismatch: expected 83, found ${beforeRow.previous_debt}`);
        }
        if (Number(beforeRow.new_debt) !== 11) {
            throw new Error(`new_debt mismatch: expected 11, found ${beforeRow.new_debt}`);
        }
        if (beforeRow.receipt_id !== OLD_RECEIPT_ID) {
            throw new Error(`receipt_id mismatch: expected ${OLD_RECEIPT_ID}, found ${beforeRow.receipt_id}`);
        }
        if (Number(beforeRow.maqal_id) !== OLD_MAQAL_ID) {
            throw new Error(`maqal_id mismatch: expected ${OLD_MAQAL_ID}, found ${beforeRow.maqal_id}`);
        }

        // Snapshot counts before transaction
        const totalRowsBeforeRes = await client.query(`SELECT COUNT(1)::int as count FROM "Ledger"`);
        const totalRowsBefore = totalRowsBeforeRes.rows[0].count;

        const fadxiMq24BeforeRes = await client.query(
            `SELECT COUNT(1)::int as count FROM "Ledger" WHERE customer_id = $1 AND receipt_id = $2`,
            [FADXI_CUSTOMER_ID, NEW_RECEIPT_ID]
        );
        const fadxiMq24Before = fadxiMq24BeforeRes.rows[0].count; // Expected: 4

        const fadxiMq13BeforeRes = await client.query(
            `SELECT COUNT(1)::int as count FROM "Ledger" WHERE customer_id = $1 AND receipt_id = $2`,
            [FADXI_CUSTOMER_ID, OLD_RECEIPT_ID]
        );
        const fadxiMq13Before = fadxiMq13BeforeRes.rows[0].count; // Expected: 5 (including the $72 payment)

        const otherCustomersRowsBeforeRes = await client.query(
            `SELECT COUNT(1)::int as count FROM "Ledger" WHERE customer_id != $1`,
            [FADXI_CUSTOMER_ID]
        );
        const otherCustomersRowsBefore = otherCustomersRowsBeforeRes.rows[0].count;

        console.log(`Pre-check counts: Total Ledger rows = ${totalRowsBefore}, Fadxi MQ24 rows = ${fadxiMq24Before}, Fadxi MQ13 rows = ${fadxiMq13Before}, Other customers rows = ${otherCustomersRowsBefore}`);

        console.log('\n=== STEP 2: START TRANSACTION & EXECUTE TARGETED UPDATE ===');
        await client.query('BEGIN');

        const updateRes = await client.query(
            `UPDATE "Ledger"
             SET receipt_id = $1,
                 maqal_id = $2
             WHERE id = $3
               AND customer_id = $4
               AND amount = 72
               AND receipt_id = $5
               AND maqal_id = $6
             RETURNING *`,
            [NEW_RECEIPT_ID, NEW_MAQAL_ID, PAYMENT_ID, FADXI_CUSTOMER_ID, OLD_RECEIPT_ID, OLD_MAQAL_ID]
        );

        if (updateRes.rowCount !== 1) {
            throw new Error(`Expected exactly 1 row updated, got ${updateRes.rowCount}. Rolling back!`);
        }

        const afterRow = updateRes.rows[0];
        console.log('Update executed in transaction. Validating 9 safety checks...');

        console.log('\n=== STEP 3: IMMEDIATE VERIFICATION (9 CHECKS) ===');

        // 1. The payment amount is still $72
        const check1 = Number(afterRow.amount) === 72;
        console.log(`1. Payment amount is $72: ${check1 ? 'PASS (amount: ' + afterRow.amount + ')' : 'FAIL'}`);
        if (!check1) throw new Error('Check 1 failed: amount is not 72');

        // 2. previous_debt is still $83
        const check2 = Number(afterRow.previous_debt) === 83;
        console.log(`2. previous_debt is $83: ${check2 ? 'PASS (previous_debt: ' + afterRow.previous_debt + ')' : 'FAIL'}`);
        if (!check2) throw new Error('Check 2 failed: previous_debt is not 83');

        // 3. new_debt is still $11
        const check3 = Number(afterRow.new_debt) === 11;
        console.log(`3. new_debt is $11: ${check3 ? 'PASS (new_debt: ' + afterRow.new_debt + ')' : 'FAIL'}`);
        if (!check3) throw new Error('Check 3 failed: new_debt is not 11');

        // 4. Customer lifetime balance is still $11
        const balRes = await client.query(
            `SELECT 
                COALESCE(SUM(CASE 
                    WHEN type = 'PRODUCT' THEN amount 
                    WHEN type = 'PAYMENT' THEN -amount 
                    WHEN type = 'ADJUSTMENT' THEN amount 
                    ELSE 0 
                END), 0)::float as lifetime_balance
             FROM "Ledger"
             WHERE customer_id = $1 AND deleted_at IS NULL`,
            [FADXI_CUSTOMER_ID]
        );
        const lifetimeBal = balRes.rows[0].lifetime_balance;
        const check4 = lifetimeBal === 11;
        console.log(`4. Customer lifetime balance is $11: ${check4 ? 'PASS (balance: $' + lifetimeBal + ')' : 'FAIL'}`);
        if (!check4) throw new Error(`Check 4 failed: lifetime balance is ${lifetimeBal}, expected 11`);

        // 5. Maqal #24 now includes the $72 payment
        const mq24Check = await client.query(
            `SELECT id, amount, note FROM "Ledger" WHERE receipt_id = $1 AND id = $2`,
            [NEW_RECEIPT_ID, PAYMENT_ID]
        );
        const check5 = mq24Check.rows.length === 1;
        console.log(`5. Maqal #24 includes the $72 payment: ${check5 ? 'PASS' : 'FAIL'}`);
        if (!check5) throw new Error('Check 5 failed: payment not found in Maqal #24 receipt');

        // 6. Maqal #24 closing balance becomes $11
        const mq24Payments = await client.query(
            `SELECT type, amount, note, reference_date FROM "Ledger" WHERE receipt_id = $1 AND customer_id = $2 AND deleted_at IS NULL ORDER BY created_at ASC`,
            [NEW_RECEIPT_ID, FADXI_CUSTOMER_ID]
        );
        let mq24ProductSum = 0;
        let mq24PaymentSum = 0;
        for (const row of mq24Payments.rows) {
            if (row.type === 'PRODUCT') mq24ProductSum += Number(row.amount);
            if (row.type === 'PAYMENT') mq24PaymentSum += Number(row.amount);
        }
        const openingBalanceMq24 = 70; // verified from ledger history prior to MQ24
        const closingBalanceMq24 = openingBalanceMq24 + mq24ProductSum - mq24PaymentSum;
        const check6 = closingBalanceMq24 === 11 && mq24PaymentSum === 164 && mq24ProductSum === 105;
        console.log(`6. Maqal #24 closing balance is $11: ${check6 ? 'PASS' : 'FAIL'} (Opening: $${openingBalanceMq24}, Products: $${mq24ProductSum}, Payments: $${mq24PaymentSum}, Closing: $${closingBalanceMq24})`);
        if (!check6) throw new Error(`Check 6 failed: closing balance is ${closingBalanceMq24}`);

        // 7. Maqal #13 no longer contains this $72 payment
        const mq13Check = await client.query(
            `SELECT id FROM "Ledger" WHERE receipt_id = $1 AND id = $2`,
            [OLD_RECEIPT_ID, PAYMENT_ID]
        );
        const check7 = mq13Check.rows.length === 0;
        console.log(`7. Maqal #13 no longer contains $72 payment: ${check7 ? 'PASS' : 'FAIL'}`);
        if (!check7) throw new Error('Check 7 failed: payment still found in Maqal #13 receipt');

        // 8. No other Ledger rows changed
        const totalRowsAfterRes = await client.query(`SELECT COUNT(1)::int as count FROM "Ledger"`);
        const totalRowsAfter = totalRowsAfterRes.rows[0].count;

        const fadxiMq24AfterRes = await client.query(
            `SELECT COUNT(1)::int as count FROM "Ledger" WHERE customer_id = $1 AND receipt_id = $2`,
            [FADXI_CUSTOMER_ID, NEW_RECEIPT_ID]
        );
        const fadxiMq24After = fadxiMq24AfterRes.rows[0].count;

        const fadxiMq13AfterRes = await client.query(
            `SELECT COUNT(1)::int as count FROM "Ledger" WHERE customer_id = $1 AND receipt_id = $2`,
            [FADXI_CUSTOMER_ID, OLD_RECEIPT_ID]
        );
        const fadxiMq13After = fadxiMq13AfterRes.rows[0].count;

        const otherCustomersRowsAfterRes = await client.query(
            `SELECT COUNT(1)::int as count FROM "Ledger" WHERE customer_id != $1`,
            [FADXI_CUSTOMER_ID]
        );
        const otherCustomersRowsAfter = otherCustomersRowsAfterRes.rows[0].count;

        const check8 = (totalRowsBefore === totalRowsAfter) &&
                       (fadxiMq24After === fadxiMq24Before + 1) &&
                       (fadxiMq13After === fadxiMq13Before - 1) &&
                       (otherCustomersRowsBefore === otherCustomersRowsAfter);

        console.log(`8. No other Ledger rows changed: ${check8 ? 'PASS' : 'FAIL'} (Total rows: ${totalRowsAfter}, MQ24 rows: ${fadxiMq24Before} -> ${fadxiMq24After}, MQ13 rows: ${fadxiMq13Before} -> ${fadxiMq13After}, Other customers rows: ${otherCustomersRowsAfter})`);
        if (!check8) throw new Error('Check 8 failed: unexpected changes to other rows');

        // 9. No customer balance changed unexpectedly
        const latestFadxi = await client.query(
            `SELECT new_debt FROM "Ledger" WHERE customer_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1`,
            [FADXI_CUSTOMER_ID]
        );
        const check9 = Number(latestFadxi.rows[0].new_debt) === 11;
        console.log(`9. Fadxi latest recorded balance is $11: ${check9 ? 'PASS' : 'FAIL'}`);
        if (!check9) throw new Error('Check 9 failed: latest ledger debt is not 11');

        console.log('\nAll 9 verification checks PASSED. Committing transaction...');
        await client.query('COMMIT');
        console.log('TRANSACTION COMMITTED SUCCESSFULLY.');

        console.log('\n=== SUMMARY OF BEFORE -> AFTER ===');
        console.log(JSON.stringify({
            record_id: PAYMENT_ID,
            customer: 'Fadxi (customer_code: 21)',
            amount: '$72.00 (UNCHANGED)',
            type: 'PAYMENT (UNCHANGED)',
            customer_id: `${FADXI_CUSTOMER_ID} (UNCHANGED)`,
            previous_debt: '$83.00 (UNCHANGED)',
            new_debt: '$11.00 (UNCHANGED)',
            reference_date: `${afterRow.reference_date.toISOString().split('T')[0]} (UNCHANGED)`,
            created_at: `${afterRow.created_at.toISOString()} (UNCHANGED)`,
            note: `"${afterRow.note}" (UNCHANGED)`,
            receipt_id: `${OLD_RECEIPT_ID} -> ${afterRow.receipt_id}`,
            maqal_id: `${OLD_MAQAL_ID} (Maqal #13) -> ${afterRow.maqal_id} (Maqal #24)`
        }, null, 2));

    } catch (err) {
        console.error('Verification failed or error occurred. Rolling back transaction!');
        await client.query('ROLLBACK');
        console.error(err);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

execute();
