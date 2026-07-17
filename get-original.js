const { execSync } = require('child_process');
try {
    console.log(execSync('git show main~2:"app/api/customers/route.ts"').toString());
} catch (e) {
    console.log(e.message);
}
