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

import type { DrillPoolEntry } from '../../../chess/drill';
import { branchSpec, resolveLine, type ResolvedLine } from '../../../chess/line';
import { countBranches, replayTree, type MoveTree } from '../../../chess/tree';
import { linesUnderFolder } from '../../../storage/folders';
import { getLine } from '../../../storage/lines';
import type { LineSet } from '../lines/folderNav';
import { linesOfSet } from '../lines/lineSet';

/**
 * Ids of every saved line whose start position is legal and whose moves all replay.
 *
 * `folder` scopes the pool to one folder **and everything beneath it** — drilling `Black` drills
 * `Black/Sicilian` too, which is the point of nesting a repertoire. The root (`''`, the default)
 * is every line of `set`, so an unscoped Database drill behaves exactly as before folders existed.
 */
export function drillablePool(folder = '', set: LineSet = 'database'): string[] {
  return drillableBranchPool(folder, set).map((entry) => entry.id);
}

/**
 * `drillablePool` with each line's branch count — the pool `pickNextBranch` draws from. A branch
 * count is as opaque as an id: it says how big a line is, not what it plays.
 *
 * `set` picks the lines before the folder narrows them: Personal is only the picked lines (stale
 * picks already dropped by `linesOfSet`), Database every saved line.
 */
export function drillableBranchPool(folder = '', set: LineSet = 'database'): DrillPoolEntry[] {
  return linesUnderFolder(linesOfSet(set), folder)
    .filter((line) => replayTree(line.startFen, line.tree).ok)
    .map((line) => ({ id: line.id, branches: countBranches(line.tree) }));
}

/**
 * Pool entry for the one line a `?line=` drill serves. Not filtered: a missing or broken line
 * still gets an entry (one branch), so the runner can say what is wrong with it.
 */
export function drillPoolEntry(id: string): DrillPoolEntry {
  const stored = id.length === 0 ? null : getLine(id);
  return { id, branches: stored === null ? 1 : countBranches(stored.tree) };
}

export type LoadedDrillLine =
  | {
      status: 'ready';
      line: ResolvedLine;
      /** The stored line's whole tree, so the run can switch branch on another repertoire move. */
      tree: MoveTree;
    }
  /** The line was deleted between building the pool and serving it. */
  | { status: 'missing' }
  /** The line no longer replays (hand-edited storage). */
  | { status: 'broken' };

/**
 * Loads one branch of a line for a drill run (`branch` indexes `branchesOf(line.tree)`; 0 is the
 * main line). Returns the replayed model only — the caller never sees the stored record, so the
 * name and notes cannot reach the screen by accident.
 */
export function loadDrillLine(id: string, branch = 0): LoadedDrillLine {
  const stored = id.length === 0 ? null : getLine(id);
  if (stored === null) return { status: 'missing' };
  const spec = branchSpec(stored, branch);
  if (spec === null) return { status: 'missing' };
  const model = resolveLine(spec);
  return model.ok ? { status: 'ready', line: model, tree: stored.tree } : { status: 'broken' };
}
