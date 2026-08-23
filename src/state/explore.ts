/**
 * The explore position, held OUTSIDE the React tree — the same pattern, and for the same reason,
 * as `state/analysis.ts`: `HashRouter` unmounts the section on navigation, so an exploration
 * would be lost every time the user looked something up in Training and came back.
 *
 * It is a *separate* store from the analysis one on purpose. "Open in analyze" and "Explore" are
 * two screens the user moves between, and sharing one history would make each of them silently
 * overwrite the other's position.
 *
 * It is also the hand-off point for Training's Explore buttons: call `loadExploration(startFen,
 * sans)` before navigating to `#/explore` and the section picks it up on mount.
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

export function getExploration(): HistoryState {
  return current;
}

export function setExploration(h: HistoryState): void {
  if (h === current) return;
  current = h;
  emit();
}

/**
 * Replaces the exploration with a position and optional move list. As in `analysis.ts`, an
 * unplayable SAN sequence loads just the position rather than throwing into the caller's
 * navigation.
 */
export function loadExploration(startFen: string, sans?: string[]): void {
  const withMoves = sans !== undefined && sans.length > 0 ? historyFromSan(startFen, sans) : null;
  current = withMoves ?? createHistory(startFen);
  emit();
}

export function subscribeExploration(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** React binding. Every setter is a module function, so its identity is stable. */
export function useExploration(): {
  history: HistoryState;
  setHistory: (h: HistoryState) => void;
  loadExploration: (startFen: string, sans?: string[]) => void;
} {
  const history = useSyncExternalStore(subscribeExploration, getExploration, getExploration);
  return { history, setHistory: setExploration, loadExploration };
}
