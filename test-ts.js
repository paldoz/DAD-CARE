const { exec } = require('child_process');
exec('npx tsc --noEmit', (err, stdout, stderr) => {
    console.log("STDOUT:", stdout);
    console.log("STDERR:", stderr);
    if (err) console.log("ERR:", err.message);
});
