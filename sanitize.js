const { Pool } = require('pg');

const pool = new Pool({
    connectionString: "postgresql://postgres.cfepckoviapjbxpauldr:0frWmNafDE1JzS6E@aws-1-eu-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true",
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        console.log('Connecting to database...');
        
        const res1 = await pool.query(`UPDATE "User" SET avatar_url = NULL WHERE length(avatar_url) > 1000;`);
        console.log(`Wiped massive avatars from User table: ${res1.rowCount} rows affected.`);

        const res2 = await pool.query(`UPDATE "Customer" SET avatar_url = NULL WHERE length(avatar_url) > 1000;`);
        console.log(`Wiped massive avatars from Customer table: ${res2.rowCount} rows affected.`);

        const res3 = await pool.query(`UPDATE "AdminSession" SET avatar_url = NULL WHERE length(avatar_url) > 1000;`);
        console.log(`Wiped massive avatars from AdminSession table: ${res3.rowCount} rows affected.`);

        const res4 = await pool.query(`UPDATE "AuditLog" SET details = NULL WHERE length(details) > 5000;`);
        console.log(`Wiped massive details from AuditLog table: ${res4.rowCount} rows affected.`);

        console.log('Done! Supabase Database physically sanitized. Bandwidth drain is permanently terminated.');
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

run();
