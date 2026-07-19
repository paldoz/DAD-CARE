const fs = require('fs');

try {
  const data = JSON.parse(fs.readFileSync('full_database_backup.json', 'utf8'));
  const customers = data.tables.Customer || [];
  let out = "Total customers in backup: " + customers.length + "\n";
  if (customers.length > 0) {
    out += "Sample customer from backup: " + JSON.stringify(customers[0], null, 2);
  }
  fs.writeFileSync('backup_check_out.txt', out);
} catch(e) {
  fs.writeFileSync('backup_check_out.txt', e.toString());
}
