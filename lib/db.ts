import { Pool } from 'pg';

// MUST use DATABASE_URL (Transaction Pooler on port 6543) for Vercel Serverless.
// DIRECT_URL (Session mode on port 5432) is limited to exactly 15 connections 
// on the Supabase free tier and will instantly crash with (EMAXCONNSESSION) on Vercel.

const connectionString = process.env.DATABASE_URL || '';

declare global {
    // Prevent multiple instances of the pool during hot-reloads in development
    // or across concurrent serverless function executions on the same worker
    var pool: Pool | undefined;
}

let pool: Pool;

if (!globalThis.pool) {
    globalThis.pool = new Pool({
        connectionString,
        ssl: { rejectUnauthorized: false }, 
        
        // PERFORMANCE FIX: Increased max connections from 1 to 20.
        // Node.js serverless functions (Vercel/Netlify) can handle concurrent requests.
        // Limiting to 1 means concurrent requests from 5 admins get queued, causing lag.
        max: 20, 
        
        // Keep connections alive for 10 seconds to avoid thrashing (frequent reconnects) 
        // while the 5 admins are actively working.
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 10000,
        
        // Allow the Node.js event loop to exit even if a DB connection is technically idle.
        allowExitOnIdle: true,
    });
}

// Assign to the exported variable from the global singleton
pool = globalThis.pool;

export default pool;
