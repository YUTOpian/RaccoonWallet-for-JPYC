import { useCallback, useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';

/**
 * Blocks browser/OS "back" navigation (the POP history action - the browser back button,
 * the swipe-back gesture, the Android hardware back button) away from the caller's screen
 * while `active` is true. Forward navigation (navigate('/some/path'), a <Link>, i.e. a
 * PUSH/REPLACE) is never affected, so "Done"/"Next"-style buttons keep working as normal.
 *
 * Used on screens that show a one-time secret (the recovery phrase right after wallet
 * creation) or that shouldn't be dismissible by backing out mid-flow (PIN entry) - so a
 * person can't slip past them with the back gesture instead of the screen's own button.
 *
 * Some callers still need to navigate backwards *intentionally* from inside the blocked
 * screen (e.g. an in-app "Cancel" button that itself calls navigate(-1)). Call the
 * returned `bypassNext()` right before that call so exactly that one POP navigation is
 * let through instead of blocked too.
 */
export function useBlockBackNavigation(active: boolean) {
  const bypassRef = useRef(false);

  const blocker = useBlocker(
    useCallback(
      ({ historyAction }) => {
        if (!active || historyAction !== 'POP') {
          return false;
        }
        if (bypassRef.current) {
          bypassRef.current = false;
          return false;
        }
        return true;
      },
      [active],
    ),
  );

  // A blocked POP has already been "started" by the browser (back button/gesture) - reset()
  // cancels it and keeps the router on the current entry, per react-router's useBlocker.
  useEffect(() => {
    if (blocker.state === 'blocked') {
      blocker.reset();
    }
  }, [blocker]);

  const bypassNext = useCallback(() => {
    bypassRef.current = true;
  }, []);

  return { bypassNext };
}
