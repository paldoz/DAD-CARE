import 'dotenv/config';
import pool from '../lib/db';
import { GET, POST, DELETE } from '../app/api/customer-note-status/route';

async function runSecurityTests() {
    console.log('===============================================================');
    console.log('CUSTOMER NOTE STATUS: SECURITY & AUTHORIZATION REGRESSION TESTS');
    console.log('===============================================================\n');

    const customerToken = 'test-token-customer-' + Date.now();
    const adminToken = 'test-token-admin-' + Date.now();
    const superAdminToken = 'test-token-superadmin-' + Date.now();

    // 1. Setup mock sessions in AdminSession linked to real users in "User" table
    await pool.query(`
        INSERT INTO "AdminSession" (token, user_id, username, role, expires_at)
        VALUES 
            ($1, '81de51b7-242e-42ff-af4d-a6db863476ea', '27', 'CUSTOMER', NOW() + INTERVAL '1 hour'),
            ($2, '18cb1ba7-f7d6-47a6-bcbd-e34b6302a821', 'dahirshiiq', 'ADMIN', NOW() + INTERVAL '1 hour'),
            ($3, '85a4c951-6d05-4902-a6b1-09784d6c56b7', 'paldoz', 'SUPER_ADMIN', NOW() + INTERVAL '1 hour');
    `, [customerToken, adminToken, superAdminToken]);

    const sampleCust = (await pool.query('SELECT id, name FROM "Customer" LIMIT 1')).rows[0];
    const customerId = sampleCust.id;

    try {
        // --- TEST 1: Unauthenticated Requests ---
        console.log('TEST 1: Unauthenticated Requests (No token)');
        const unauthReq = new Request('http://localhost:3000/api/customer-note-status');
        const res1 = await GET(unauthReq, {});
        console.log(`   GET without token -> Status: ${res1.status} (Expected: 401)`);
        if (res1.status !== 401) throw new Error('Unauthenticated GET did not return 401');

        const res1Post = await POST(new Request('http://localhost:3000/api/customer-note-status', {
            method: 'POST',
            body: JSON.stringify({ customerId, note: 'hacker' }),
        }), {});
        console.log(`   POST without token -> Status: ${res1Post.status} (Expected: 401)`);
        if (res1Post.status !== 401) throw new Error('Unauthenticated POST did not return 401');

        // --- TEST 2: Authenticated but Unauthorized User (Role: CUSTOMER) ---
        console.log('\nTEST 2: Authenticated but Unauthorized User (Role: CUSTOMER)');
        const custGetReq = new Request('http://localhost:3000/api/customer-note-status', {
            headers: { 'x-session-token': customerToken }
        });
        const res2Get = await GET(custGetReq, {});
        console.log(`   GET with role=CUSTOMER -> Status: ${res2Get.status} (Expected: 403)`);
        if (res2Get.status !== 403) throw new Error('Customer GET did not return 403');

        const custPostReq = new Request('http://localhost:3000/api/customer-note-status', {
            method: 'POST',
            headers: { 'x-session-token': customerToken },
            body: JSON.stringify({ customerId, priorityEnabled: true, note: 'unauthorized note' }),
        });
        const res2Post = await POST(custPostReq, {});
        console.log(`   POST with role=CUSTOMER -> Status: ${res2Post.status} (Expected: 403)`);
        if (res2Post.status !== 403) throw new Error('Customer POST did not return 403');

        const custDelReq = new Request(`http://localhost:3000/api/customer-note-status?customerId=${customerId}`, {
            method: 'DELETE',
            headers: { 'x-session-token': customerToken }
        });
        const res2Del = await DELETE(custDelReq, {});
        console.log(`   DELETE with role=CUSTOMER -> Status: ${res2Del.status} (Expected: 403)`);
        if (res2Del.status !== 403) throw new Error('Customer DELETE did not return 403');

        // --- TEST 3: Authorized Administrator (Role: ADMIN) ---
        console.log('\nTEST 3: Authorized Administrator (Role: ADMIN)');
        const adminGetReq = new Request('http://localhost:3000/api/customer-note-status', {
            headers: { 'x-session-token': adminToken }
        });
        const res3Get = await GET(adminGetReq, {});
        console.log(`   GET with role=ADMIN -> Status: ${res3Get.status} (Expected: 200)`);
        if (res3Get.status !== 200) throw new Error('Admin GET did not return 200');

        const adminPostReq = new Request('http://localhost:3000/api/customer-note-status', {
            method: 'POST',
            headers: { 'x-session-token': adminToken },
            body: JSON.stringify({ customerId, priorityEnabled: true, busyEnabled: true, note: 'Admin test note' }),
        });
        const res3Post = await POST(adminPostReq, {});
        const postData = await res3Post.json();
        console.log(`   POST with role=ADMIN -> Status: ${res3Post.status}, Saved: ${postData.success} (Expected: 200)`);
        if (res3Post.status !== 200 || !postData.success) throw new Error('Admin POST failed');

        // Verify persistence in DB
        const dbCheck = await pool.query('SELECT * FROM "CustomerNoteStatus" WHERE customer_id = $1', [customerId]);
        console.log(`   Verified DB record: note="${dbCheck.rows[0].note}", priority=${dbCheck.rows[0].priority_enabled}`);

        // --- TEST 4: Clear All completely removed (Rejected with 400) ---
        console.log('\nTEST 4: Clear All completely removed (all=true returns 400)');
        const clearAllReq = new Request('http://localhost:3000/api/customer-note-status?all=true', {
            method: 'DELETE',
            headers: { 'x-session-token': superAdminToken }
        });
        const res4Clear = await DELETE(clearAllReq, {});
        console.log(`   Clear All attempt -> Status: ${res4Clear.status} (Expected: 400)`);
        if (res4Clear.status !== 400) throw new Error('Clear All should be rejected with 400!');

        // --- TEST 5: Authorized Clear Single Customer (Role: ADMIN) ---
        console.log('\nTEST 5: Authorized Clear Single Customer (Role: ADMIN)');
        const adminDelSingle = new Request(`http://localhost:3000/api/customer-note-status?customerId=${customerId}`, {
            method: 'DELETE',
            headers: { 'x-session-token': adminToken }
        });
        const res5 = await DELETE(adminDelSingle, {});
        console.log(`   Single customer clear with role=ADMIN -> Status: ${res5.status} (Expected: 200)`);
        if (res5.status !== 200) throw new Error('Single customer delete failed');

        console.log('\n===============================================================');
        console.log('🎉 ALL SECURITY & AUTHORIZATION TESTS PASSED WITH 100% SUCCESS');
        console.log('===============================================================');
    } finally {
        // Clean up mock tokens from AdminSession
        await pool.query('DELETE FROM "AdminSession" WHERE token IN ($1, $2, $3)', [
            customerToken, adminToken, superAdminToken
        ]);
        await pool.end();
    }
}

runSecurityTests().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
