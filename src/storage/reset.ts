/**
 * "Clear data" — the one operation that empties every `localStorage` key this app owns
 * (repertoire, seed record, blind-game resume record), offered from the Training tab.
 *
 * Two things shape it:
 *
 * 1. **Bundled lines come back, custom lines do not.** Clearing the seed record along with the
 *    repertoire is what makes the reset a reset rather than a deletion of `public/data/`: the
 *    next load seeds every bundled line again. So the only permanent loss is the lines no
 *    bundled file can produce — what `resetSummary()` counts, and what the confirmation says.
 * 2. **Clear everything, or say so.** Each key is cleared independently and a failure on any one
 *    of them is reported, because a half-cleared store the user believes is empty is worse than
 *    an honest error.
 *
 * The glue lives here rather than in the list screen so the UI has one call for "what would this
 * destroy" and one for "do it"; the parts worth testing (`clearLines`, `clearSeedRecord`,
 * `customLines`) are in the modules that own each key.
 */

import { clearBlindGame, hasStoredBlindGame } from './blindGame';
import { clearLines, listLines, storageWarning } from './lines';
import { clearSeedRecord, customLines } from './seed';
import { bundledSeedFiles } from './seedData';

export interface ResetSummary {
  /** Lines currently stored, bundled ones included. */
  total: number;
  /** Of those, the ones no bundled file could restore — written, imported or edited by hand. */
  custom: number;
  /** A blind-game resume record is stored (it may or may not still be playable). */
  blindGame: boolean;
}

/** What a reset would destroy right now. Reads only — nothing is written until `clearAll()`. */
export function resetSummary(): ResetSummary {
  const lines = listLines();
  return {
    total: lines.length,
    custom: customLines(lines, bundledSeedFiles()).length,
    blindGame: hasStoredBlindGame(),
  };
}

export interface ResetResult {
  /** True only when every key really left the disk. */
  ok: boolean;
  /** Why not, when `ok` is false. */
  error?: string;
}

/**
 * Empties every key. The bundled lines are *not* re-seeded here: seeding is a startup step
 * (`src/main.tsx`), and doing it now would write the lines back into a store the user has just
 * been told is empty. They return on the next load, which is what the confirmation promises.
 */
export function clearAll(): ResetResult {
  const lines = clearLines();
  const seed = clearSeedRecord();
  const blind = clearBlindGame();
  if (lines && seed && blind) return { ok: true };
  return {
    ok: false,
    error:
      storageWarning() ??
      'Browser storage could not be cleared (private browsing or blocked cookies). ' +
        'Anything still on disk will be back on the next load.',
  };
}
