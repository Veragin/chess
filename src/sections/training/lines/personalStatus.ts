/**
 * Small pure helpers for the Personal toggles on the training list (`LinesList.tsx`).
 *
 * Kept out of the component so the wording and the folder "how much of this is personal" rule can
 * be unit-tested without rendering anything.
 */

import type { Line } from '../../../storage/schema';
import type { LineSet } from './folderNav';

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
 * The per-row toggle's label. In Database it shows the line's state and adds/removes it; in
 * Personal every row is personal, so it only ever removes (from Personal, not the database).
 */
export function personalToggleLabel(isPersonal: boolean, set: LineSet): string {
  if (set === 'personal') return 'Remove';
  return isPersonal ? '★ In personal' : '☆ Add to personal';
}
