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
 */

import { normaliseFolderPath } from '../../../storage/schema';

function withFolder(base: string, folder: string): string {
  const normalised = normaliseFolderPath(folder);
  if (normalised.length === 0) return base;
  return `${base}?folder=${encodeURIComponent(normalised)}`;
}

/** The saved-lines list, opened at `folder`. */
export function linesPath(folder: string): string {
  return withFolder('/training', folder);
}

/** Drill scoped to `folder` and its subfolders. */
export function drillPath(folder: string): string {
  return withFolder('/training/drill', folder);
}

/** The editor for a new line, pre-filed in `folder`. */
export function newLinePath(folder: string): string {
  return withFolder('/training/new', folder);
}

/** The editor for an existing line; `folder` is only where "Back" returns to. */
export function editLinePath(id: string, folder: string): string {
  return withFolder(`/training/${id}/edit`, folder);
}

/** Line play; `folder` is only where "Back" returns to. */
export function playLinePath(id: string, folder: string): string {
  return withFolder(`/training/${id}/play`, folder);
}
