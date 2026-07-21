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
        
        // VERCEL / SERVERLESS OPTIMIZATION:
        // Set max connections low (5) per lambda instance. Vercel scales by spinning up 
        // more lambdas, so keeping this low prevents exhausting the Supabase pooler.
        max: 5, 
        
        // CRITICAL ZOMBIE CONNECTION FIX: 
        // Vercel serverless functions instantly "freeze" as soon as they send an HTTP response.
        // If we keep connections open here, they turn into "Zombies" on Supabase's end until TCP timeout.
        // We set idleTimeoutMillis to 100ms so the connection gracefully closes right after the query,
        // letting the Supabase Transaction Pooler (Port 6543) handle keeping the actual DB connection warm.
        idleTimeoutMillis: 100,
        connectionTimeoutMillis: 10000,
        
        // Allow the Node.js event loop to exit immediately
        allowExitOnIdle: true,
    });
}

// Assign to the exported variable from the global singleton
pool = globalThis.pool;

export default pool;
