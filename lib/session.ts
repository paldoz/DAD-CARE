/**
 * Simple session token utility
 * Generates a secure random token on login and validates it on API calls
 */

const TOKEN_KEY = 'dadwork_session_token';
const USER_KEY = 'currentUser';

/** Generate a random hex token */
export function generateToken(): string {
    const arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Save token to localStorage */
export function saveToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
}

/** Get current token from localStorage */
export function getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
}

export function clearSession(): void {
    // Save theme preference so they don't get flash-banged
    const theme = localStorage.getItem('theme');
    
    // Nuclear option: destroy ALL local storage unconditionally
    localStorage.clear();
    
    // Restore theme
    if (theme) {
        localStorage.setItem('theme', theme);
    }
}

/** Log out from server and clear local session */
export async function logout(): Promise<void> {
    try {
        await authFetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {
        console.error('Logout API failed:', e);
    }
    clearSession();
}

/** Make an authenticated fetch request (adds token header automatically) */
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
    const token = getToken();
    return fetch(url, {
        ...options,
        headers: {
            ...options.headers,
            'x-session-token': token || '',
        },
    });
}
