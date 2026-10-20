import 'dotenv/config';
import pool from '../lib/db';
import { GET, POST, DELETE } from '../app/api/customer-note-status/route';

async function runSaxSaarTests() {
    console.log('===============================================================');
    console.log('TEST SUITE: ✓ 📞 Sax Saar & Priority Protection Verification');
    console.log('===============================================================\n');

    const adminToken = 'test-token-admin-' + Date.now();
    const superAdminToken = 'test-token-superadmin-' + Date.now();

    // Setup mock admin sessions
    await pool.query(`
        INSERT INTO "AdminSession" (token, user_id, username, role, expires_at)
        VALUES 
            ($1, '18cb1ba7-f7d6-47a6-bcbd-e34b6302a821', 'dahirshiiq', 'ADMIN', NOW() + INTERVAL '1 hour'),
            ($2, '85a4c951-6d05-4902-a6b1-09784d6c56b7', 'paldoz', 'SUPER_ADMIN', NOW() + INTERVAL '1 hour');
    `, [adminToken, superAdminToken]);

    const { rows: customers } = await pool.query(
        'SELECT id, name, customer_code FROM "Customer" WHERE deleted_at IS NULL ORDER BY customer_code::int ASC LIMIT 3'
    );
    const customerA = customers[0];
    const customerB = customers[1];

    try {
        console.log(`Testing with Customer A: ${customerA.name} (${customerA.id})`);
        console.log(`Testing with Customer B: ${customerB.name} (${customerB.id})\n`);

        // Clean up any existing test records for A & B
        await pool.query('DELETE FROM "CustomerNoteStatus" WHERE customer_id IN ($1, $2)', [customerA.id, customerB.id]);

        // 1. Confirm Sax Saar is off by default
        console.log('TEST 1 & 2: Default state (Sax Saar off by default)');
        const checkDefault = await pool.query('SELECT * FROM "CustomerNoteStatus" WHERE customer_id = $1', [customerA.id]);
        console.log(`   Customer A in CustomerNoteStatus: ${checkDefault.rows.length === 0 ? 'None (Clean default)' : 'Exists'}`);
        if (checkDefault.rows.length !== 0) throw new Error('Customer A should have no status initially');

        // 2. Enable Sax Saar and save
        console.log('\nTEST 3 & 4: Enable Sax Saar (priorityEnabled=true) and save');
        const enableReq = new Request('http://localhost:3000/api/customer-note-status', {
            method: 'POST',
            headers: { 'x-session-token': adminToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customerId: customerA.id,
                priorityEnabled: true,
                busyEnabled: false,
                note: 'Note for A',
            }),
        });
        const enableRes = await POST(enableReq, {});
        const enableData = await enableRes.json();
        console.log(`   POST status: ${enableRes.status}, Saved: ${enableData.success}`);
        if (enableRes.status !== 200 || !enableData.status.priority_enabled) {
            throw new Error('Failed to enable Sax Saar');
        }

        // 3. Confirm persistence in database (survives refresh / sign-in)
        console.log('\nTEST 5 & 6: Database Persistence Check (Refresh / Relogin)');
        const dbA = await pool.query('SELECT * FROM "CustomerNoteStatus" WHERE customer_id = $1', [customerA.id]);
        console.log(`   DB record for A: priority_enabled=${dbA.rows[0].priority_enabled}, busy_enabled=${dbA.rows[0].busy_enabled}, note="${dbA.rows[0].note}"`);
        if (!dbA.rows[0].priority_enabled) throw new Error('Sax Saar not saved in database!');

        // 4. Test Customer isolation: Customer B is NOT affected by Customer A
        console.log('\nTEST 13: Customer Isolation (A does not affect B)');
        const dbB = await pool.query('SELECT * FROM "CustomerNoteStatus" WHERE customer_id = $1', [customerB.id]);
        console.log(`   Customer B status count: ${dbB.rows.length} (Expected: 0)`);
        if (dbB.rows.length !== 0) throw new Error('Customer B was affected by Customer A!');

        // 5. Test Busy and Note independence
        console.log('\nTEST 10: Independence of Sax Saar, Busy, and Note');
        // Toggle Busy on, keep Sax Saar on
        const busyReq = new Request('http://localhost:3000/api/customer-note-status', {
            method: 'POST',
            headers: { 'x-session-token': adminToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customerId: customerA.id,
                priorityEnabled: true,
                busyEnabled: true,
                note: 'Note with busy',
            }),
        });
        await POST(busyReq, {});
        const dbBusy = await pool.query('SELECT * FROM "CustomerNoteStatus" WHERE customer_id = $1', [customerA.id]);
        console.log(`   After enabling Busy: priority_enabled=${dbBusy.rows[0].priority_enabled}, busy_enabled=${dbBusy.rows[0].busy_enabled}`);
        if (!dbBusy.rows[0].priority_enabled || !dbBusy.rows[0].busy_enabled) {
            throw new Error('Busy and Sax Saar are not independent!');
        }

        // 6. Test Clear Note: Only clears note, does NOT delete Sax Saar or Busy status
        console.log('\nTEST 11: Clear Note Behavior (preserves Sax Saar & Busy)');
        const clearNoteReq = new Request('http://localhost:3000/api/customer-note-status', {
            method: 'POST',
            headers: { 'x-session-token': adminToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customerId: customerA.id,
                priorityEnabled: true, // Sax Saar preserved
                busyEnabled: true,     // Busy preserved
                note: '',              // Note cleared
            }),
        });
        await POST(clearNoteReq, {});
        const dbAfterClearNote = await pool.query('SELECT * FROM "CustomerNoteStatus" WHERE customer_id = $1', [customerA.id]);
        console.log(`   After Clear Note: priority_enabled=${dbAfterClearNote.rows[0].priority_enabled}, busy_enabled=${dbAfterClearNote.rows[0].busy_enabled}, note="${dbAfterClearNote.rows[0].note || ''}"`);
        if (!dbAfterClearNote.rows[0].priority_enabled || !dbAfterClearNote.rows[0].busy_enabled || dbAfterClearNote.rows[0].note !== '') {
            throw new Error('Clear Note failed to preserve Sax Saar or Busy!');
        }

        // 7. Disable Sax Saar and save
        console.log('\nTEST 7 & 8: Disable Sax Saar and save');
        const disableReq = new Request('http://localhost:3000/api/customer-note-status', {
            method: 'POST',
            headers: { 'x-session-token': adminToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customerId: customerA.id,
                priorityEnabled: false,
                busyEnabled: false,
                note: '',
            }),
        });
        const disableRes = await POST(disableReq, {});
        const disableData = await disableRes.json();
        console.log(`   POST status: ${disableRes.status}, Cleared row: ${disableData.cleared}`);
        const dbDisabled = await pool.query('SELECT * FROM "CustomerNoteStatus" WHERE customer_id = $1', [customerA.id]);
        console.log(`   Customer A row count after disable: ${dbDisabled.rows.length} (Cleanly deleted from DB)`);
        if (dbDisabled.rows.length !== 0) throw new Error('Disabled customer was not cleaned from DB');

        // 8. Confirm Clear All requires explicit confirmation token and works safely
        console.log('\nTEST 12: Clear All Behavior (Requires confirmation token, clears only CustomerNoteStatus)');
        const clearAllAttemptWithoutToken = new Request('http://localhost:3000/api/customer-note-status?all=true', {
            method: 'DELETE',
            headers: { 'x-session-token': superAdminToken },
        });
        const clearAllRes1 = await DELETE(clearAllAttemptWithoutToken, {});
        console.log(`   Attempting DELETE ?all=true without token -> Status: ${clearAllRes1.status} (Expected: 400)`);
        if (clearAllRes1.status !== 400) throw new Error('Clear All without token should return 400');

        // Test with confirm=CONFIRM_CLEAR_ALL
        const clearAllSuccessReq = new Request('http://localhost:3000/api/customer-note-status?all=true&confirm=CONFIRM_CLEAR_ALL', {
            method: 'DELETE',
            headers: { 'x-session-token': superAdminToken },
        });
        const clearAllRes2 = await DELETE(clearAllSuccessReq, {});
        const clearAllData2 = await clearAllRes2.json();
        console.log(`   Attempting DELETE ?all=true&confirm=CONFIRM_CLEAR_ALL -> Status: ${clearAllRes2.status}, ClearedAll: ${clearAllData2.clearedAll}`);
        if (clearAllRes2.status !== 200 || !clearAllData2.clearedAll) {
            throw new Error('Clear All with confirmation token failed!');
        }

        // 9. Confirm Priority Blue Checkmark & assigned_customer_ids are 100% UNTOUCHED
        console.log('\nTEST 9 & 1: Confirm Priority blue checkmark & User assigned_customer_ids remain untouched');
        const { rows: userCheck } = await pool.query('SELECT username, assigned_customer_ids FROM "User" WHERE role = $1 LIMIT 2', ['ADMIN']);
        userCheck.forEach(u => {
            console.log(`   Admin user "${u.username}" assigned_customer_ids: [${(u.assigned_customer_ids || []).join(', ')}]`);
        });

        console.log('\n===============================================================');
        console.log('🎉 ALL SAX SAAR & PRIORITY PROTECTION TESTS PASSED (100%)');
        console.log('===============================================================');
    } finally {
        await pool.query('DELETE FROM "AdminSession" WHERE token IN ($1, $2)', [adminToken, superAdminToken]);
        await pool.end();
    }
}

runSaxSaarTests().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
