/**
 * The Personal set: the lines the user picked to learn, drilled and explored on their own.
 *
 * It is a set of line **ids**, nothing else — never copies — so editing a line always edits the
 * database line, and the Personal section simply shows whichever of those ids still resolve.
 * The storage itself (key `chess-trainer.personalLines.v1`, in-memory mirror, never writing on a
 * read) is in `personalIds.ts`; this module binds it to the line store.
 *
 * Ids can change or vanish under it. `lines.ts` keeps the set in step for its own operations (an
 * edited server line is forked under a new id, a deleted line leaves the set); anything else — a
 * line deleted in another tab, a bundled line dropped from a build — is filtered out on read and
 * pruned by the next write.
 */

import { listLines } from './lines';
import {
  addPersonalIds,
  clearPersonalIds,
  prunePersonalIds,
  readPersonalIds,
  removePersonalIds,
  replacePersonalIds,
} from './personalIds';
import type { Line } from './schema';

function liveIds(): Set<string> {
  return new Set(listLines().map((line) => line.id));
}

/** The personal ids that still resolve to a line. Never writes. */
export function personalIds(): Set<string> {
  const live = liveIds();
  return new Set([...readPersonalIds()].filter((id) => live.has(id)));
}

/** Whether line `id` was picked. Meant for lines that exist — a stale id is not checked here. */
export function isPersonal(id: string): boolean {
  return readPersonalIds().has(id);
}

/** Adds `ids` in one write (a whole folder at once). False when it only reached memory. */
export function addPersonal(ids: readonly string[]): boolean {
  return addPersonalIds(ids, liveIds());
}

/** Removes `ids` from Personal only — the lines stay in the database. */
export function removePersonal(ids: readonly string[]): boolean {
  return removePersonalIds(ids, liveIds());
}

/** Moves the pick from `from` to `to` (a forked line), if `from` was picked. */
export function replacePersonalId(from: string, to: string): void {
  replacePersonalIds(new Map([[from, to]]), liveIds());
}

/** Empties Personal. False when the key could not be removed from disk. */
export function clearPersonal(): boolean {
  return clearPersonalIds();
}

/** The picked lines, in `listLines()` order. */
export function listPersonalLines(): Line[] {
  const ids = readPersonalIds();
  return listLines().filter((line) => ids.has(line.id));
}

/**
 * Keeps only the ids that resolve. `removed` is how many were dropped; `ok` is false when that
 * write only reached memory.
 */
export function prunePersonal(): { removed: number; ok: boolean } {
  return prunePersonalIds(liveIds());
}
