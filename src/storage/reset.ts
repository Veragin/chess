/**
 * "Refresh data" — drops what the user changed about the bundled lines and reinstalls a fresh
 * bundled set, optionally deleting the user's own lines too. Offered from the Database section of
 * the Training tab.
 *
 * Three things shape it:
 *
 * 1. **Server lines are never stored** (see `lines.ts`). The only stored server-line state is the
 *    hidden-ids record, so "fresh server lines" means: remove that record, re-run the bundled
 *    loader, and ask the service worker for a newer build (`checkForUpdate`) — a deploy then
 *    reloads the page with its new `public/data`. No fetch of our own, so it stays offline-safe.
 * 2. **Personal is pruned, not emptied**, unless the user ticks "Also clear my Personal list":
 *    ids whose line is gone after the refresh are dropped, the rest stay picked.
 * 3. **Clear everything asked for, or say so.** Each key is cleared independently and a failure on
 *    any one of them is reported, because a half-cleared store the user believes is fresh is worse
 *    than an honest error.
 *
 * The blind-game resume record is deliberately left alone: refreshing repertoire data must not
 * end a game in progress.
 */

import { checkForUpdate } from '../pwa/registerPwa';
import {
  clearHiddenServerLines,
  clearLines,
  hiddenServerLineCount,
  isServerLine,
  listLines,
  storageWarning,
} from './lines';
import { clearPersonal, personalIds, prunePersonal } from './personal';
import type { SeedReport } from './seed';
import { loadBundledLines } from './seedData';

export interface ResetSummary {
  /** Lines currently listed, bundled ones included. */
  total: number;
  /** Of those, the user's own — written, imported or edited by hand. */
  custom: number;
  /** Bundled lines the user deleted or replaced with an edited copy; a refresh brings them back. */
  hidden: number;
  /** Lines in the Personal set. */
  personal: number;
}

/** What a refresh would touch right now. Reads only — nothing is written by asking. */
export function resetSummary(): ResetSummary {
  const lines = listLines();
  return {
    total: lines.length,
    custom: lines.filter((line) => !isServerLine(line)).length,
    hidden: hiddenServerLineCount(),
    personal: personalIds().size,
  };
}

export type RefreshMode = 'delete-user-lines' | 'keep-user-lines';

export interface RefreshOptions {
  mode: RefreshMode;
  /** "Also clear my Personal list": empty it rather than only pruning it. */
  clearPersonal: boolean;
  /** Reinstalls the bundled lines. Defaults to `loadBundledLines`; tests pass a stub. */
  reload?: () => SeedReport;
}

export interface RefreshResult {
  /** True only when every key that had to change really changed on disk. */
  ok: boolean;
  /** Why not, when `ok` is false. */
  error?: string;
  /** Personal ids dropped because their line no longer exists (0 when the list was cleared). */
  personalRemoved: number;
  /** The Personal list was emptied (the checkbox was ticked). */
  personalCleared: boolean;
}

const NOT_CLEARED =
  'Browser storage could not be cleared (private browsing or blocked cookies). ' +
  'Anything still on disk will be back on the next load.';

export function refreshData(options: RefreshOptions): RefreshResult {
  const reload = options.reload ?? loadBundledLines;

  const linesOk = options.mode === 'delete-user-lines' ? clearLines() : clearHiddenServerLines();
  reload();

  let personalOk: boolean;
  let personalRemoved = 0;
  if (options.clearPersonal) {
    personalOk = clearPersonal();
  } else {
    const pruned = prunePersonal();
    personalOk = pruned.ok;
    personalRemoved = pruned.removed;
  }

  checkForUpdate();

  const result: RefreshResult = {
    ok: linesOk && personalOk,
    personalRemoved,
    personalCleared: options.clearPersonal,
  };
  if (!result.ok) result.error = storageWarning() ?? NOT_CLEARED;
  return result;
}
