'use client';

import { useEffect, useCallback } from 'react';

/**
 * ImmersiveController
 * Requests fullscreen ONCE on initial mount, only if not already fullscreen.
 *
 * Why only once:
 * - PWA installed with "display": "fullscreen" already launches in fullscreen via WebAPK.
 * - SPA (Next.js) route changes do NOT exit fullscreen — no need to re-request.
 * - Every requestFullscreen() call triggers Android Chrome's security notification
 *   ("To exit full screen, drag from the top and touch the back button").
 * - Calling it on touchstart, click, focus, or pathname changes causes repeated
 *   notifications during normal navigation. Removed entirely.
 */
export function ImmersiveController() {
    const enterFullscreen = useCallback(async () => {
        if (typeof window === 'undefined' || typeof document === 'undefined') return;

        // Only target mobile / touch devices
        const isMobileOrTouch =
            window.matchMedia('(pointer: coarse)').matches ||
            /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

        if (!isMobileOrTouch) return;

        const doc = document as any;
        const docEl = document.documentElement as any;

        // Do nothing if already in fullscreen — avoids triggering Android's notification
        const isAlreadyFullscreen = !!(
            doc.fullscreenElement ||
            doc.webkitFullscreenElement ||
            doc.mozFullScreenElement ||
            doc.msFullscreenElement
        );

        if (isAlreadyFullscreen) return;

        const requestMethod =
            docEl.requestFullscreen ||
            docEl.webkitRequestFullscreen ||
            docEl.mozRequestFullScreen ||
            docEl.msRequestFullscreen;

        if (requestMethod) {
            try {
                await requestMethod.call(docEl, { navigationUI: 'hide' });
            } catch {
                // Requires a user gesture — silently ignored on cold load;
                // the PWA manifest fullscreen display mode handles OS-level fullscreen.
            }
        }

        // Lock portrait orientation if supported
        try {
            if (window.screen?.orientation && 'lock' in window.screen.orientation) {
                await (window.screen.orientation as any).lock('portrait-primary');
            }
        } catch {
            // Orientation lock not permitted or unsupported on this device
        }
    }, []);

    // Single attempt on mount only — no repeated calls on navigation, focus, or interaction
    useEffect(() => {
        enterFullscreen();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return null;
}
