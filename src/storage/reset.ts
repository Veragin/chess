/**
 * "Clear data" — the one operation that empties every `localStorage` key this app owns
 * (the user's lines, the hidden server ids, the blind-game resume record), offered from the
 * Training tab.
 *
 * Two things shape it:
 *
 * 1. **Bundled lines stay, custom lines do not.** Server lines are never stored (see `lines.ts`),
 *    so clearing only destroys the user's own lines — what `resetSummary()` counts — and brings
 *    back every bundled line the user had deleted or replaced with an edited copy.
 * 2. **Clear everything, or say so.** Each key is cleared independently and a failure on any one
 *    of them is reported, because a half-cleared store the user believes is empty is worse than
 *    an honest error.
 */

import { clearBlindGame, hasStoredBlindGame } from './blindGame';
import { clearLines, isServerLine, listLines, storageWarning } from './lines';

export interface ResetSummary {
  /** Lines currently listed, bundled ones included. */
  total: number;
  /** Of those, the user's own — written, imported or edited by hand. */
  custom: number;
  /** A blind-game resume record is stored (it may or may not still be playable). */
  blindGame: boolean;
}

/** What a reset would destroy right now. Reads only — nothing is written until `clearAll()`. */
export function resetSummary(): ResetSummary {
  const lines = listLines();
  return {
    total: lines.length,
    custom: lines.filter((line) => !isServerLine(line)).length,
    blindGame: hasStoredBlindGame(),
  };
}

export interface ResetResult {
  /** True only when every key really left the disk. */
  ok: boolean;
  /** Why not, when `ok` is false. */
  error?: string;
}

/** Empties every key. The bundled lines remain, all of them visible again. */
export function clearAll(): ResetResult {
  const lines = clearLines();
  const blind = clearBlindGame();
  if (lines && blind) return { ok: true };
  return {
    ok: false,
    error:
      storageWarning() ??
      'Browser storage could not be cleared (private browsing or blocked cookies). ' +
        'Anything still on disk will be back on the next load.',
  };
}
