export const levenshtein = (a: string, b: string) => {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
                );
            }
        }
    }
    return matrix[b.length][a.length];
};

export const fuzzyMatch = (name: string, query: string) => {
    if (!name || !query) return false;
    const cleanName = name.toLowerCase().replace(/\s+/g, '');
    const cleanQuery = query.toLowerCase().replace(/\s+/g, '');
    if (cleanName.includes(cleanQuery)) return true;
    
    const words = name.toLowerCase().split(/\s+/);
    for (const word of words) {
        if (word.length >= 3 && cleanQuery.length >= 3) {
            const allowedTypos = cleanQuery.length >= 5 ? 2 : 1;
            const wordPrefix = word.substring(0, cleanQuery.length);
            if (levenshtein(wordPrefix, cleanQuery) <= allowedTypos) return true;
        }
    }
    return false;
};

export const smartCustomerSearch = (customer: any, searchQuery: string) => {
    if (!searchQuery || searchQuery.trim() === '') return true;
    
    const term = searchQuery.toLowerCase().trim();
    const cleanPhoneQuery = searchQuery.replace(/[^0-9]/g, '');
    
    const isFuzzyNameMatch = fuzzyMatch(customer.name, term);
    const phoneMatch = customer.phone && cleanPhoneQuery && customer.phone.replace(/[^0-9]/g, '').includes(cleanPhoneQuery);
    const codeMatch = customer.customer_code && customer.customer_code.toString().toLowerCase().includes(term);
    
    return isFuzzyNameMatch || phoneMatch || codeMatch;
};
