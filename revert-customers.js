const { execSync } = require('child_process');
const fs = require('fs');
try {
    const originalContent = execSync('git show main~2:"app/api/customers/route.ts"').toString();
    fs.writeFileSync('app/api/customers/route.ts', originalContent);
    console.log("SUCCESS! Successfully reverted app/api/customers/route.ts to the original version.");
} catch (e) {
    console.log("Error:", e.message);
}
