const customerStats = [
    { id: 'qadro', pct: 100, current_debt: 1090, debugMaqals: [{ closingBalance: 877 }] },
    { id: 'canab', pct: 100, current_debt: 497, debugMaqals: [{ closingBalance: 0 }] },
    { id: 'jalmad', pct: 100, current_debt: 658, debugMaqals: [{ closingBalance: 658 }] },
    { id: 'cust_97', pct: 97, current_debt: 200, debugMaqals: [{ closingBalance: 0 }] },
    { id: 'cust_heyn', pct: 98, current_debt: -50, debugMaqals: [{ closingBalance: 0 }] },
];

const sortedByMaqal = [...customerStats].sort((a, b) => {
    if (b.pct !== a.pct) return b.pct - a.pct;
    
    const aHasHeyn = a.current_debt <= 0;
    const bHasHeyn = b.current_debt <= 0;
    if (aHasHeyn || bHasHeyn) {
        if (a.current_debt !== b.current_debt) return a.current_debt - b.current_debt;
    }
    
    const aM = a.debugMaqals[0];
    const bM = b.debugMaqals[0];
    if (aM.closingBalance !== bM.closingBalance) return aM.closingBalance - bM.closingBalance;
    
    return a.id.localeCompare(b.id);
});

sortedByMaqal.forEach((c, i) => {
    console.log(`Rank ${i+1}: ${c.id} (pct: ${c.pct}, debt: ${c.current_debt}, cb: ${c.debugMaqals[0].closingBalance})`);
});
