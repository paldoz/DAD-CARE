const fs = require('fs');
const path = require('path');

const apiDir = path.join(__dirname, 'app', 'api');

const foldersToDelete = [
    'clean-avatars',
    'db-info',
    'db-ping',
    'debug-db',
    'egress-stats',
    'fix-all-columns',
    'fix-codes',
    'fix-db',
    'fix-raaxo',
    'fix-receipt-id',
    'ping',
    'ping-check',
    'ping-clean',
    'ping-db',
    'ping-sizes',
    'rescue',
    'reset-admin',
    'restore-all-codes',
    'restore-db',
    'test-db'
];

foldersToDelete.forEach(folder => {
    const targetPath = path.join(apiDir, folder);
    if (fs.existsSync(targetPath)) {
        try {
            fs.rmSync(targetPath, { recursive: true, force: true });
            console.log(`DELETED: ${folder}`);
        } catch (err) {
            console.error(`Failed to delete ${folder}:`, err.message);
        }
    } else {
        console.log(`SKIPPED (Already deleted): ${folder}`);
    }
});

console.log('\nAll vulnerable scripts have been removed!');
