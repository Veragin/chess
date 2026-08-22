/**
 * The set of lines drill may serve, reduced to **ids only**.
 *
 * This is a deliberate answer-leak measure (README §8.11). The drill screen has to know *how
 * many* lines there are and *which* it has already served, but it must never hold the pool as
 * whole `Line` records: a `Line[]` in React state puts every name and every move of the whole
 * repertoire into the React devtools tree, one click away from anyone poking at the page. Ids
 * are opaque UUIDs, so the pool state says nothing.
 *
 * The pool is filtered to lines that actually replay, so the cycle can never serve a line the
 * runner would have to bounce (storage validates on import, but a hand-edited `localStorage`
 * payload can still contain a broken line).
 *
 * Nothing here writes: drill is practice, not editing.
 */

import { resolveLine, type ResolvedLine } from '../../../chess/line';
import { getLine, listLines } from '../../../storage/lines';

/** Ids of every saved line whose start position is legal and whose moves all replay. */
export function drillablePool(): string[] {
  return listLines()
    .filter((line) => resolveLine(line).ok)
    .map((line) => line.id);
}

export type LoadedDrillLine =
  | { status: 'ready'; line: ResolvedLine }
  /** The line was deleted between building the pool and serving it. */
  | { status: 'missing' }
  /** The line no longer replays (hand-edited storage). */
  | { status: 'broken' };

/**
 * Loads one line for a drill run. Returns the replayed model only — the caller never sees the
 * stored record, so the name and notes cannot reach the screen by accident.
 */
export function loadDrillLine(id: string): LoadedDrillLine {
  const stored = id.length === 0 ? null : getLine(id);
  if (stored === null) return { status: 'missing' };
  const model = resolveLine(stored);
  return model.ok ? { status: 'ready', line: model } : { status: 'broken' };
}
