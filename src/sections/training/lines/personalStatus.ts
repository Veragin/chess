/**
 * Small pure helpers for the Favourite star toggles on the training list (`LinesList.tsx`).
 *
 * Kept out of the component so the wording and the folder "how much of this is personal" rule can
 * be unit-tested without rendering anything.
 */

import type { Line } from '../../../storage/schema';

/** How many of a folder's lines are in Personal. */
export type PersonalStatus = 'none' | 'some' | 'all';

/**
 * Whether none, some or all of `lines` are in `personal` (a set of line ids). An empty folder is
 * `'none'` — there is nothing in it that could count as "all added".
 */
export function folderPersonalStatus(
  lines: readonly Line[],
  personal: ReadonlySet<string>,
): PersonalStatus {
  let picked = 0;
  for (const line of lines) if (personal.has(line.id)) picked += 1;
  if (picked === 0) return 'none';
  return picked === lines.length ? 'all' : 'some';
}

/**
 * The accessible name of a ★/☆ toggle (line row or folder card): what pressing it does. A starred
 * one removes from Favourite — never from the database.
 */
export function favouriteToggleLabel(isFavourite: boolean): string {
  return isFavourite ? 'Remove from favourites' : 'Add to favourites';
}
