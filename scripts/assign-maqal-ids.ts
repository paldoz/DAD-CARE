const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

const prisma = new PrismaClient();

async function run() {
    console.log('Starting migration audit generation...');

    // 1. Determine exact DailyBook pairs exactly like mq-analytics
    const pairsResult = await prisma.$queryRawUnsafe(`
        WITH past_dates AS (
            SELECT DISTINCT date::date AS db_date
            FROM "DailyBook"
            WHERE deleted_at IS NULL
        ),
        numbered_dates AS (
            SELECT db_date,
                   ROW_NUMBER() OVER (ORDER BY db_date DESC) as rn
            FROM past_dates
        )
        SELECT date1, date2,
               ROW_NUMBER() OVER (ORDER BY date2 ASC) as mq_num
        FROM (
            SELECT n2.db_date::date as date1, n1.db_date::date as date2
            FROM numbered_dates n1
            JOIN numbered_dates n2 ON n1.rn = n2.rn - 1
            WHERE n1.rn % 2 = 1
        ) all_pairs
        ORDER BY mq_num ASC;
    `);

    console.log(`Found ${pairsResult.length} true Maqal periods based on DailyBook dates.`);

    const audit = {
        meta: {
            timestamp: new Date().toISOString(),
            total_product_rows: 0,
            total_assigned: 0,
            unassigned_reasons: {}
        },
        assignments: [],
        unassigned: []
    };

    // Build lookup for fast date matching
    const dateToMqNum = new Map();
    for (const pair of pairsResult) {
        const d1 = new Date(pair.date1).toISOString().split('T')[0];
        const d2 = new Date(pair.date2).toISOString().split('T')[0];
        const num = Number(pair.mq_num);
        dateToMqNum.set(d1, { num, date: d1, other: d2, pair });
        dateToMqNum.set(d2, { num, date: d2, other: d1, pair });
    }

    // 2. Fetch all PRODUCT ledger entries
    const products = await prisma.ledger.findMany({
        where: {
            type: 'PRODUCT',
            deleted_at: null
        },
        select: {
            id: true,
            customer_id: true,
            reference_date: true,
            created_at: true,
            amount: true,
            maqal_id: true
        }
    });

    audit.meta.total_product_rows = products.length;

    for (const p of products) {
        const refDate = p.reference_date || p.created_at;
        const dateStr = refDate.toISOString().split('T')[0];

        const match = dateToMqNum.get(dateStr);

        if (match) {
            audit.assignments.push({
                ledger_id: p.id,
                customer_id: p.customer_id,
                reference_date: dateStr,
                amount: p.amount,
                old_maqal_id: p.maqal_id,
                new_maqal_id: match.num,
                evidence: `Matched DailyBook date ${dateStr} belonging to MQ#${match.num} (Pair: ${match.pair.date1.toISOString().split('T')[0]} - ${match.pair.date2.toISOString().split('T')[0]})`
            });
            audit.meta.total_assigned++;
        } else {
            audit.unassigned.push({
                ledger_id: p.id,
                customer_id: p.customer_id,
                reference_date: dateStr,
                amount: p.amount,
                old_maqal_id: p.maqal_id,
                reason: `No matching DailyBook pair found for date ${dateStr}`
            });
            audit.meta.unassigned_reasons[dateStr] = (audit.meta.unassigned_reasons[dateStr] || 0) + 1;
        }
    }

    fs.writeFileSync('maqal_migration_audit.json', JSON.stringify(audit, null, 2));
    
    console.log(`\nAudit Summary:`);
    console.log(`Total PRODUCT rows: ${audit.meta.total_product_rows}`);
    console.log(`Successfully assigned: ${audit.meta.total_assigned}`);
    console.log(`Unassigned (no matching DailyBook pair): ${audit.unassigned.length}`);
    if (audit.unassigned.length > 0) {
        console.log(`Dates missing from pairs:`, audit.meta.unassigned_reasons);
    }
    console.log(`\nAudit saved to maqal_migration_audit.json`);
}

run()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
