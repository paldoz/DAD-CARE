const fs = require('fs');

try {
  const d = JSON.parse(fs.readFileSync('database_backup_safe.json', 'utf8'));
  const custs = d.customers || d.Customer || (d.tables && d.tables.Customer) || [];
  
  let foundPhones = [];
  for(let c of custs) {
    if (c.phone && c.phone !== '') {
      foundPhones.push(c.name + ' - ' + c.phone);
    }
  }
  
  fs.writeFileSync('phones_check.txt', 'Total with phones: ' + foundPhones.length + '\n' + foundPhones.join('\n'));
} catch(e) {
  fs.writeFileSync('phones_check.txt', e.toString());
}
