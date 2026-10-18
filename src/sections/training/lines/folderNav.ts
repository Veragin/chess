/**
 * The training section's folder-aware URLs, in one place.
 *
 * The open folder is a `?folder=` query parameter rather than component state or a path segment:
 *
 *  - a path segment cannot hold a nested path (`Black/Sicilian` would look like two segments) and
 *    would collide with `#/training/:id/edit`;
 *  - state would make "drill this folder" and "back from the editor" unable to remember where the
 *    user was, and would lose the folder on reload.
 *
 * The root is always spelled as *no* parameter, so there is exactly one URL per folder.
 *
 * The section — Personal or Database — is a `?set=` parameter for the same reasons: drill,
 * explore and the editor's "Back" all return to the section they were opened from, and a reload
 * keeps it. Database is spelled as *no* parameter (so every URL from before Personal existed
 * still means what it did); only `set=personal` is ever written. Every helper takes `set` as an
 * optional trailing argument defaulting to Database.
 */

import { normaliseFolderPath } from '../../../storage/schema';

/** Which lines a training screen works on: the user's picked Personal set, or every saved line. */
export type LineSet = 'personal' | 'database';

/** The section named by `?set=`; absent or unrecognised means Database. */
export function parseLineSet(params: URLSearchParams): LineSet {
  return params.get('set') === 'personal' ? 'personal' : 'database';
}

/** Optional query parameters besides `folder` and `set`, all emitted only when given. */
interface ExtraParams {
  /** Written *before* `folder`, as single-line drill URLs always have. */
  line?: string;
  /** Written after `folder`. */
  from?: LineHandoff;
}

/**
 * `base` with its query: `line`, `folder` (omitted at the root), `from`, then `set` (omitted for
 * Database). Collected in `URLSearchParams`, but serialised with `encodeURIComponent` (spaces as
 * `%20`, not `+`) so every pre-existing URL stays byte-identical.
 */
function scopedPath(
  base: string,
  folder: string,
  set: LineSet,
  { line, from }: ExtraParams = {},
): string {
  const params = new URLSearchParams();
  if (line !== undefined) params.append('line', line);
  const normalised = normaliseFolderPath(folder);
  if (normalised.length > 0) params.append('folder', normalised);
  if (from !== undefined) params.append('from', from);
  if (set === 'personal') params.append('set', set);
  const query = [...params]
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return query.length === 0 ? base : `${base}?${query}`;
}

/** The saved-lines list, opened at `folder`. */
export function linesPath(folder: string, set: LineSet = 'database'): string {
  return scopedPath('/training', folder, set);
}

/** Drill scoped to `folder` and its subfolders. */
export function drillPath(folder: string, set: LineSet = 'database'): string {
  return scopedPath('/training/drill', folder, set);
}

/** The editor for a new line, pre-filed in `folder`. */
export function newLinePath(folder: string, set: LineSet = 'database'): string {
  return scopedPath('/training/new', folder, set);
}

/** Screens that can hand a played-out move list to the editor (`state/newLine.ts`). */
export type LineHandoff = 'explore' | 'analyze';

/**
 * The editor for a new line whose moves another screen has staged (`state/newLine.ts`).
 *
 * The moves themselves are not in the URL — a move list is unbounded, and a truncated one would
 * silently save a shorter line. `from=` is the *intent*, which is what stops a plain "New line"
 * from picking up a draft left behind by an earlier hand-off.
 */
export function newLineFromPath(
  folder: string,
  from: LineHandoff,
  set: LineSet = 'database',
): string {
  return scopedPath('/training/new', folder, set, { from });
}

/** The editor for a new line whose moves explore has staged. */
export function newLineFromExplorePath(folder: string, set: LineSet = 'database'): string {
  return newLineFromPath(folder, 'explore', set);
}

/** The editor for a new line whose moves the analyse board has staged. */
export function newLineFromAnalyzePath(folder: string, set: LineSet = 'database'): string {
  return newLineFromPath(folder, 'analyze', set);
}

/**
 * The explore screen, comparing against `folder` and everything below it.
 *
 * A training route rather than a top-level section: exploring asks what the *repertoire* covers,
 * so it belongs to the same tab as the lines it reads, and it is reached from the Explore button
 * beside Drill. Scoped by the same `?folder=` convention as its siblings.
 */
export function explorePath(folder: string, set: LineSet = 'database'): string {
  return scopedPath('/training/explore', folder, set);
}

/** The editor for an existing line; `folder` and `set` are only where "Back" returns to. */
export function editLinePath(id: string, folder: string, set: LineSet = 'database'): string {
  return scopedPath(`/training/${id}/edit`, folder, set);
}

/**
 * Drill one specific line — the same screen as `drillPath`, with a pool of exactly one.
 *
 * `?line=` rather than a path of its own: a single-line drill *is* a drill with a narrower pool,
 * so it shares the screen, the runner and the "one line at most once" rule. `folder` is still
 * carried so "Exit drill" returns to the folder the line was picked from (and `set` to the section).
 */
export function drillLinePath(id: string, folder: string, set: LineSet = 'database'): string {
  return scopedPath('/training/drill', folder, set, { line: id });
}
