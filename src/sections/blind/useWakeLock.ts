/**
 * Screen Wake Lock, held for the duration of a blind game (README §2.1, §8.9).
 *
 * The one thing that is easy to get wrong: **the browser releases the lock whenever the page
 * loses visibility, and it is not restored automatically.** The sentinel stays around as a dead
 * object, so the only correct behaviour is to request a *new* one on every `visibilitychange`
 * back to `visible`. That is what the effect below does.
 *
 * Everything degrades quietly: the API is absent in Firefox and in non-secure contexts, and
 * `request()` rejects when the document is hidden or the platform refuses. Neither is an error
 * the players need to see, so `supported: false` is reported as a fact, not a failure.
 *
 * Typings are declared locally (like `speech/recognizer.ts`) rather than relying on whatever
 * `lib.dom.d.ts` this TypeScript ships, and no `any` escapes into an exported signature.
 */

import { useEffect, useState } from 'react';

interface WakeLockSentinelLike {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
  removeEventListener(type: 'release', listener: () => void): void;
}

interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

interface NavigatorWithWakeLock {
  wakeLock?: WakeLockLike;
}

export interface WakeLockState {
  /** The API exists in this browser. False in Firefox and in insecure contexts. */
  supported: boolean;
  /** A lock is currently held. */
  active: boolean;
}

function wakeLockApi(): WakeLockLike | null {
  if (typeof navigator === 'undefined') return null;
  const api = (navigator as Navigator & NavigatorWithWakeLock).wakeLock;
  if (api === undefined || typeof api.request !== 'function') return null;
  return api;
}

/** Detects support without mounting the hook (used for the one-line capability note). */
export function isWakeLockSupported(): boolean {
  return wakeLockApi() !== null;
}

/**
 * Holds a screen wake lock while `enabled` is true, re-acquiring it every time the page becomes
 * visible again. Releases it when `enabled` goes false or the component unmounts.
 */
export function useWakeLock(enabled: boolean): WakeLockState {
  const [supported] = useState<boolean>(() => isWakeLockSupported());
  const [active, setActive] = useState(false);

  useEffect(() => {
    const api = wakeLockApi();
    if (!enabled || api === null) return;

    let cancelled = false;
    let sentinel: WakeLockSentinelLike | null = null;

    const onRelease = (): void => {
      // The browser dropped it (visibility change, battery saver). Forget the sentinel so the
      // next `visible` event can request a fresh one.
      sentinel = null;
      if (!cancelled) setActive(false);
    };

    const drop = (): void => {
      const held = sentinel;
      sentinel = null;
      if (held === null) return;
      held.removeEventListener('release', onRelease);
      void held.release().catch(() => {
        /* Already released by the browser; nothing to do. */
      });
    };

    const acquire = (): void => {
      // A hidden document cannot hold a lock, and requesting one there always rejects.
      if (cancelled || sentinel !== null) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      api
        .request('screen')
        .then((next) => {
          if (cancelled) {
            void next.release().catch(() => {});
            return;
          }
          sentinel = next;
          next.addEventListener('release', onRelease);
          setActive(true);
        })
        .catch(() => {
          // Denied by the platform (battery saver, unsupported display). Not worth alarming
          // the players about — the game still works, the screen may just dim.
          if (!cancelled) setActive(false);
        });
    };

    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        // The lock we held was released on the way out; ask for a fresh one (README §8.9).
        acquire();
      } else {
        drop();
        setActive(false);
      }
    };

    acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      drop();
      setActive(false);
    };
  }, [enabled]);

  return { supported, active };
}
