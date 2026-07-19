// Restores ALL original customer_codes AND phone numbers to the PRODUCTION database
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres.omjmjihinxbtilnirsco:ki6pw8TKnb4bqrjC@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
    ssl: { rejectUnauthorized: false }
});

async function restoreCustomerData() {
    const client = await pool.connect();
    try {
        console.log('Connecting to PRODUCTION Database...');
        console.log('Reading safe backup file...');
        const backupPath = path.join(__dirname, 'database_backup_safe.json');
        const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

        let backupCustomers = [];
        if (backup.customers) {
            backupCustomers = backup.customers;
        } else if (backup.tables && backup.tables.Customer) {
            backupCustomers = backup.tables.Customer;
        } else if (backup.users && backup.users[0]?.customer_code !== undefined) {
            backupCustomers = backup.users;
        }
        
        console.log('Found ' + backupCustomers.length + ' customers in safe backup');

        await client.query('BEGIN');

        // Get all current customers in PRODUCTION DB
        const { rows: currentCustomers } = await client.query('SELECT id::text, customer_code FROM "Customer"');
        const backupIds = new Set(backupCustomers.map(c => String(c.id)));
        
        const newCustomers = currentCustomers.filter(c => !backupIds.has(String(c.id)));
        console.log('Found ' + newCustomers.length + ' NEW customers in production (not in backup).');

        // Temporarily scramble EVERYONE'S code to avoid ANY unique constraint collisions 
        // while we restore the old ones.
        await client.query('UPDATE "Customer" SET customer_code = \'tmp_\' || id::text');
        console.log('Scrambled all codes temporarily to prevent unique constraint crashes...');

        let restoredCodes = 0;
        let restoredPhones = 0;
        let skipped = 0;

        // Restore all backup customers
        for (const c of backupCustomers) {
            if (!c.customer_code && !c.phone) {
                skipped++;
                continue;
            }
            
            const code = String(c.customer_code || ('fix_' + c.id.substring(0,6))); 
            const phone = c.phone ? String(c.phone) : null;

            const result = await client.query(
                'UPDATE "Customer" SET customer_code = $1, phone = $2 WHERE id::text = $3',
                [code, phone, String(c.id)]
            );
            
            if (result.rowCount > 0) {
                restoredCodes++;
                if (phone) restoredPhones++;
            } else {
                skipped++;
            }
        }

        // Restore new customers (or give them safe new codes if their old one was taken by a backup customer)
        let newFixed = 0;
        for (const newCust of newCustomers) {
             const originalCode = String(newCust.customer_code);
             
             // Check if the original code they were using is now taken by a restored customer
             const { rows: taken } = await client.query('SELECT id FROM "Customer" WHERE customer_code = $1 AND id::text != $2', [originalCode, String(newCust.id)]);
             
             if (taken.length > 0 || originalCode.startsWith('tmp_') || originalCode.startsWith('-')) {
                 // It's taken! Give them a brand new unique number
                 const { rows: maxRow } = await client.query(`
                     SELECT COALESCE(MAX(customer_code::int), 0) + 1 as next_code 
                     FROM "Customer" 
                     WHERE customer_code ~ '^[0-9]+$' AND LENGTH(customer_code) < 8
                 `);
                 const safeCode = String(maxRow[0].next_code);
                 await client.query('UPDATE "Customer" SET customer_code = $1 WHERE id::text = $2', [safeCode, String(newCust.id)]);
                 newFixed++;
             } else {
                 // Not taken, safe to give them back their original code
                 await client.query('UPDATE "Customer" SET customer_code = $1 WHERE id::text = $2', [originalCode, String(newCust.id)]);
             }
        }

        await client.query('COMMIT');
        console.log('\nSUCCESS - PRODUCTION DATABASE UPDATED!');
        console.log('Restored Codes: ' + restoredCodes);
        console.log('Restored Phone Numbers: ' + restoredPhones);
        console.log('Skipped/Not Found: ' + skipped);
        console.log('New customers safely resolved: ' + newCustomers.length + ' (Conflicts avoided: ' + newFixed + ')');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('ERROR - rolled back:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

restoreCustomerData();
