import { calculateCustomerReliability } from '../app/utils/ledgerHelpers';
import { getAllCustomerStats } from '../app/utils/rankHelpers';

// Mock tie-breaker test
async function runTest() {
    // We will bypass the DB and just test the sort block directly
    const mockCustomerStats = [
        {
            id: 'Cust A',
            pct: 100, // Tied reliability
            current_debt: 50, // No Heyn
            customer_created_at: new Date('2026-01-01'),
            debugMaqals: [
                { closingBalance: 100 }, // Reesto 100
            ]
        },
        {
            id: 'Cust B',
            pct: 100, // Tied reliability
            current_debt: -10, // HAS HEYN
            customer_created_at: new Date('2026-01-01'),
            debugMaqals: [
                { closingBalance: 100 }, // Reesto 100 (Tied)
            ]
        },
        {
            id: 'Cust C',
            pct: 100,
            current_debt: 20, // No Heyn
            customer_created_at: new Date('2026-01-01'),
            debugMaqals: [
                { closingBalance: 50 }, // Lower Reesto (Wins instantly)
            ]
        }
    ];

    // Sorting block from rankHelpers.ts
    const sorted = [...mockCustomerStats].sort((a: any, b: any) => {
        if (b.pct !== a.pct) return b.pct - a.pct;
        
        const aMaqals = a.debugMaqals || [];
        const bMaqals = b.debugMaqals || [];
        
        for (let i = 0; i < 5; i++) {
            const aM = aMaqals[i];
            const bM = bMaqals[i];
            
            if (aM && !bM) return -1;
            if (!aM && bM) return 1;
            
            if (aM && bM) {
                if (aM.closingBalance !== bM.closingBalance) {
                    return aM.closingBalance - bM.closingBalance;
                }
                const aHasHeyn = a.current_debt <= 0;
                const bHasHeyn = b.current_debt <= 0;
                if (aHasHeyn !== bHasHeyn) {
                    return aHasHeyn ? -1 : 1;
                }
            }
        }
        
        const aTime = new Date(a.customer_created_at).getTime();
        const bTime = new Date(b.customer_created_at).getTime();
        if (aTime !== bTime) return aTime - bTime;
        
        return a.id.localeCompare(b.id);
    });

    console.log("Expected Rank Order:");
    console.log("1. Cust C (Lowest Reesto: 50)");
    console.log("2. Cust B (Tied Reesto 100, but has Heyn)");
    console.log("3. Cust A (Tied Reesto 100, no Heyn)");
    console.log("------------------------");
    console.log("Actual Order:");
    sorted.forEach((c, idx) => console.log(`${idx + 1}. ${c.id}`));
}

runTest();
