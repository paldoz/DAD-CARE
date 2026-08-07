import { Pool } from 'pg';
import { randomUUID } from 'crypto';

// 🚨 CRITICAL SAFETY GUARD 🚨
// Tests MUST NOT use the production database URL.
// We strictly require a completely isolated, separate TEST_DATABASE_URL environment variable.
const connectionString = process.env.TEST_DATABASE_URL;

if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
    console.error("❌ FATAL: Tests cannot run in a production environment.");
    console.error("Tests are BLOCKED to protect your live application.");
    process.exit(1);
}

if (!connectionString) {
    console.error("❌ FATAL: TEST_DATABASE_URL is missing.");
    console.error("For safety, tests are BLOCKED from using the production DATABASE_URL.");
    console.error("Please create a free Supabase project or local Postgres instance and add TEST_DATABASE_URL to your .env.local");
    process.exit(1);
}

// Extra safety: Check if they accidentally pasted the production URL into the test variable
if (connectionString === process.env.DIRECT_URL || connectionString === process.env.DATABASE_URL) {
    console.error("❌ FATAL: TEST_DATABASE_URL matches your production URL!");
    console.error("Tests are BLOCKED to protect your production data.");
    process.exit(1);
}

export const testPool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

/**
 * Creates an isolated schema for tests and clones the production tables into it.
 * This ensures tests run on a real PostgreSQL engine (for window functions) 
 * but never touch production data.
 */
export async function setupIsolatedTestDb(schemaPrefix: string = 'test') {
    const schemaName = `${schemaPrefix}_${randomUUID().replace(/-/g, '')}`;
    
    // 1. Create a brand new isolated schema
    await testPool.query(`CREATE SCHEMA "${schemaName}"`);
    
    // 2. Clone the structure of the required tables into this schema
    await testPool.query(`
        CREATE TABLE "${schemaName}"."User" (LIKE public."User" INCLUDING ALL);
        CREATE TABLE "${schemaName}"."Customer" (LIKE public."Customer" INCLUDING ALL);
        CREATE TABLE "${schemaName}"."DailyBook" (LIKE public."DailyBook" INCLUDING ALL);
        CREATE TABLE "${schemaName}"."DailyBookItem" (LIKE public."DailyBookItem" INCLUDING ALL);
        CREATE TABLE "${schemaName}"."Ledger" (LIKE public."Ledger" INCLUDING ALL);
        CREATE TABLE "${schemaName}"."Receipt" (LIKE public."Receipt" INCLUDING ALL);
    `);
    
    // 3. Return the schema name so tests can set their search_path
    return schemaName;
}

/**
 * Cleans up the isolated schema after tests are done.
 */
export async function teardownIsolatedTestDb(schemaName: string) {
    await testPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
}

/**
 * Wraps a test client to automatically use the isolated schema.
 */
export async function getTestClient(schemaName: string) {
    const client = await testPool.connect();
    await client.query(`SET search_path TO "${schemaName}"`);
    return client;
}
