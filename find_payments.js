const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const txs = await prisma.transaction.findMany({
    where: {
      type: 'PAYMENT',
      amount: { in: [280, 210] }
    },
    include: { customer: true },
    orderBy: { created_at: 'desc' }
  });
  console.log(JSON.stringify(txs, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
