/**
 * The analysis position, held OUTSIDE the React tree.
 *
 * README Phase 4 requires the analysis (position + history) to survive navigating to another
 * section and back. `HashRouter` unmounts the section on navigation, so the state cannot live in
 * the section — and a context provider would have to be mounted in `App.tsx` above the routes.
 * A module-scoped store is simpler and outlives every unmount: the module is only evaluated once
 * per page load.
 *
 * It is also the hand-off point for Phase 5's "Open in analyze": call `loadPosition(startFen,
 * sans)` before navigating to `#/analyze` and the section picks it up on mount (or re-renders
 * immediately if it is already mounted).
 */

import { useSyncExternalStore } from 'react';
import { createHistory, historyFromSan, type HistoryState } from '../chess/history';
import { START_FEN } from '../chess/position';

let current: HistoryState = createHistory(START_FEN);

const listeners = new Set<() => void>();

function emit(): void {
  // Copy first: a listener may unsubscribe (or subscribe) while being notified.
  for (const fn of [...listeners]) fn();
}

export function getAnalysis(): HistoryState {
  return current;
}

export function setAnalysis(h: HistoryState): void {
  if (h === current) return;
  current = h;
  emit();
}

/**
 * Replaces the analysis with a position and optional move list (used by "Open in analyze").
 * If any SAN move is illegal from `startFen` the moves are dropped and just the position is
 * loaded, rather than throwing into the caller's navigation.
 */
export function loadPosition(startFen: string, sans?: string[]): void {
  const withMoves =
    sans !== undefined && sans.length > 0 ? historyFromSan(startFen, sans) : null;
  current = withMoves ?? createHistory(startFen);
  emit();
}

export function subscribeAnalysis(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * React binding. `setHistory` and `loadPosition` are module functions, so their identity is
 * stable and they are safe in effect dependency lists.
 */
export function useAnalysis(): {
  history: HistoryState;
  setHistory: (h: HistoryState) => void;
  loadPosition: (startFen: string, sans?: string[]) => void;
} {
  const history = useSyncExternalStore(subscribeAnalysis, getAnalysis, getAnalysis);
  return { history, setHistory: setAnalysis, loadPosition };
}
