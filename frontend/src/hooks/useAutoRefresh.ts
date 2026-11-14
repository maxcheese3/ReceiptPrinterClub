import { useEffect, useRef } from 'react';

/**
 * Calls `fn` every `ms` while the page is visible, and right away when it
 * becomes visible again (switching back to the tab, or reopening the home-screen
 * app on iOS, which suspends timers in the background).
 *
 * `fn` can change every render; the latest one is always used without
 * restarting the timer.
 */
export function useAutoRefresh(fn: () => unknown, ms: number, enabled = true) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;

    const tick = () => {
      if (document.visibilityState === 'visible') fnRef.current();
    };
    const interval = setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [ms, enabled]);
}
