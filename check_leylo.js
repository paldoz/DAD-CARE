const fs = require('fs');
try {
  const d = JSON.parse(fs.readFileSync('database_backup_safe.json', 'utf8'));
  const c = (d.customers || d.users || []).find(x => x.name && x.name.toLowerCase().includes('leylo shaahle'));
  fs.writeFileSync('leylo.txt', JSON.stringify(c, null, 2));
} catch(e) {
  fs.writeFileSync('leylo.txt', e.toString());
}
