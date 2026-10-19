/**
 * The lines a training screen works on, for the section in `?set=` (`folderNav.ts`).
 *
 * The list, the drill pool and explore all read their lines through here, so the scoping rule —
 * Personal is the picked subset of the database, Database is every saved line — lives in one place.
 * Folder structure needs nothing extra: it is derived from each line's own `folder` path.
 */

import type { Line } from '../../../storage/schema';
import { listLines } from '../../../storage/lines';
import { listPersonalLines } from '../../../storage/personal';
import type { LineSet } from './folderNav';

/** Every line in `set`, most recently updated first (the order `listLines` gives). */
export function linesOfSet(set: LineSet): Line[] {
  return set === 'favourite' ? listPersonalLines() : listLines();
}
