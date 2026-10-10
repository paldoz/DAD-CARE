'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Globally intercepts all fetch calls to:
 * 1. Automatically append the x-session-token header from localStorage
 * 2. Redirect to /login on any 401 Unauthorized response (expired session)
 */
export function FetchInterceptor() {
    const router = useRouter();

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const originalFetch = window.fetch;

        window.fetch = async function (...args) {
            const resource = args[0] as RequestInfo | URL;
            let config = args[1] as RequestInit | undefined;

            // Initialize config and headers if missing
            if (!config) config = {};
            if (!config.headers) config.headers = {};

            // Only append token for our own API requests
            const urlString =
                typeof resource === 'string'
                    ? resource
                    : resource instanceof URL
                    ? resource.toString()
                    : (resource as Request).url;

            const isOwnApi =
                urlString.startsWith('/api/') ||
                urlString.startsWith(window.location.origin + '/api/');

            if (isOwnApi) {
                const token = localStorage.getItem('dadwork_session_token');
                if (token) {
                    if (config.headers instanceof Headers) {
                        if (!config.headers.has('x-session-token')) {
                            config.headers.append('x-session-token', token);
                        }
                    } else {
                        const headers = config.headers as Record<string, string>;
                        if (!headers['x-session-token']) {
                            headers['x-session-token'] = token;
                        }
                    }
                }
            }

            const response = await originalFetch(resource, config);

            // Auto-redirect to login on 401 from any of our API endpoints
            if (response.status === 401 && isOwnApi) {
                // Don't redirect if we're on the public landing page or login page
                const currentPath = window.location.pathname;
                const isPublicPage = currentPath === '/' || currentPath === '/login';
                const isLoginCall = urlString.includes('/api/auth/login');

                if (!isPublicPage && !isLoginCall) {
                    localStorage.removeItem('currentUser');
                    localStorage.removeItem('dadwork_session_token');
                    router.replace('/login');
                }
            }

            return response;
        };

        return () => {
            window.fetch = originalFetch;
        };
    }, [router]);

    return null;
}
