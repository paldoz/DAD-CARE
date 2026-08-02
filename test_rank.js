const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function run() {
  const { getAllCustomerStats } = require('./app/utils/rankHelpers');
  const stats = await getAllCustomerStats(pool);
  
  // Sort by rank_maqal
  stats.sort((a, b) => a.rank_maqal - b.rank_maqal);
  
  console.log("TOP 5 CUSTOMERS:");
  for (let i = 0; i < 5; i++) {
      const c = stats[i];
      console.log(`\nRank ${c.rank_maqal}: Customer ${c.id}`);
      console.log(`Reliability: ${c.pct}%`);
      console.log(`Current Debt (Header): ${c.current_debt}`);
      
      const debugMaqals = c.debugMaqals || [];
      for (let j = 0; j < Math.min(5, debugMaqals.length); j++) {
          const m = debugMaqals[j];
          console.log(`  MQ[${j}]: Reesto = ${m.reesto}, Heyn = ${m.heyn}`);
      }
  }
  
  process.exit(0);
}

run();
