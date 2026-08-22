/**
 * The single 900px breakpoint (README §6 "Layout"), observable from JS.
 *
 * The layout is mostly CSS, but two decisions cannot be: `EvalBar` takes `layout="vertical" |
 * "horizontal"` as a *prop*, and the narrow layout nests the engine lines and the move list
 * inside one panel. Rendering both variants and hiding one with CSS would duplicate the eval bar
 * (and its aria label) in the accessibility tree, so the breakpoint is read from `matchMedia`
 * instead and only one of the two trees is mounted.
 *
 * `useSyncExternalStore` rather than `useState` + effect: `matchMedia` *is* an external store,
 * and subscribing this way cannot render a stale first frame.
 */

import { useSyncExternalStore } from 'react';
import { theme } from '../../theme';

const QUERY = theme.media.wide;

function mediaQueryList(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(QUERY);
}

function subscribe(onChange: () => void): () => void {
  const list = mediaQueryList();
  if (list === null) return () => {};
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

/** Wide is the fallback: it is the desktop default and degrades gracefully without matchMedia. */
function getSnapshot(): boolean {
  return mediaQueryList()?.matches ?? true;
}

export function useIsWideLayout(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
