'use client';

import { useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';

/**
 * ImmersiveController
 * Enforces true immersive fullscreen mode on mobile Android devices.
 * - Hides the top status bar (time, battery, wifi).
 * - Hides the bottom navigation bar and gesture indicator.
 * - Restores fullscreen on route transitions, app focus, and user interaction.
 * - Leaves desktop browsers untouched.
 */
export function ImmersiveController() {
    const pathname = usePathname();

    const enterFullscreen = useCallback(async () => {
        if (typeof window === 'undefined' || typeof document === 'undefined') return;

        // Target mobile/touch devices only
        const isMobileOrTouch = window.matchMedia('(pointer: coarse)').matches ||
            /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

        if (!isMobileOrTouch) return;

        const doc = document as any;
        const docEl = document.documentElement as any;

        const isAlreadyFullscreen = !!(
            doc.fullscreenElement ||
            doc.webkitFullscreenElement ||
            doc.mozFullScreenElement ||
            doc.msFullscreenElement
        );

        if (!isAlreadyFullscreen) {
            const requestMethod =
                docEl.requestFullscreen ||
                docEl.webkitRequestFullscreen ||
                docEl.mozRequestFullScreen ||
                docEl.msRequestFullscreen;

            if (requestMethod) {
                try {
                    // navigationUI: 'hide' specifically commands Android/Chromium to hide the navigation gesture bar
                    await requestMethod.call(docEl, { navigationUI: 'hide' });
                } catch {
                    // Requires user gesture on initial cold load; touch/click listeners below handle it
                }
            }
        }

        // Lock to portrait-primary if supported
        try {
            if (window.screen?.orientation && 'lock' in window.screen.orientation) {
                await (window.screen.orientation as any).lock('portrait-primary');
            }
        } catch {
            // Orientation lock not permitted or unsupported on device
        }
    }, []);

    useEffect(() => {
        const handleInteraction = () => {
            enterFullscreen();
        };

        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                enterFullscreen();
            }
        };

        // Listen for user taps/clicks to trigger fullscreen on first gesture
        window.addEventListener('touchstart', handleInteraction, { passive: true });
        window.addEventListener('click', handleInteraction, { passive: true });
        window.addEventListener('focus', handleVisibility);
        document.addEventListener('visibilitychange', handleVisibility);

        // Immediate attempt on mount
        enterFullscreen();

        return () => {
            window.removeEventListener('touchstart', handleInteraction);
            window.removeEventListener('click', handleInteraction);
            window.removeEventListener('focus', handleVisibility);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [enterFullscreen]);

    // Re-assert immersive mode on every route change
    useEffect(() => {
        enterFullscreen();
    }, [pathname, enterFullscreen]);

    return null;
}

