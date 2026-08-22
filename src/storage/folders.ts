/**
 * Folders for the saved repertoire.
 *
 * Folders are **implicit**: there is no folder record anywhere in storage, only a `folder`
 * path string on each `Line` (`schema.ts`). A folder exists exactly as long as some line
 * names it. That keeps the persisted model additive — an old export loads unchanged, and a
 * build without this feature simply ignores the field — and it removes every question an
 * explicit folder entity would raise (orphan folders, deleting a folder with lines in it,
 * two folders with the same name, a folder id to keep in sync).
 *
 * A path is `/`-separated (`Black/Sicilian/Najdorf`), so nesting comes for free from
 * `normaliseFolderPath` in `schema.ts`; the empty string is the root. Everything here is pure
 * and DOM-free (README §9) — the list screen, the editor and the drill pool all share these
 * rules rather than each re-deriving them from raw strings.
 */

import { normaliseFolderPath, type Line } from './schema';

export const FOLDER_SEPARATOR = '/';

/** Label for the root folder, which has no name of its own. */
export const ROOT_FOLDER_LABEL = 'All lines';

/** The folder a line lives in, normalised. Empty string ⇒ the root. */
export function lineFolder(line: Line): string {
  return normaliseFolderPath(line.folder);
}

/** `'Black/Sicilian'` → `['Black', 'Sicilian']`; the root → `[]`. */
export function folderSegments(path: string): string[] {
  const normalised = normaliseFolderPath(path);
  return normalised.length === 0 ? [] : normalised.split(FOLDER_SEPARATOR);
}

/** The folder's own name — its last segment. Empty string for the root. */
export function folderName(path: string): string {
  const segments = folderSegments(path);
  return segments[segments.length - 1] ?? '';
}

/** The folder containing `path`. The root is its own parent. */
export function parentFolder(path: string): string {
  const segments = folderSegments(path);
  return segments.slice(0, -1).join(FOLDER_SEPARATOR);
}

/** Appends one segment to a folder path. Either side may be empty. */
export function joinFolder(parent: string, name: string): string {
  return normaliseFolderPath(`${parent}${FOLDER_SEPARATOR}${name}`);
}

/** Display name for a path: the root gets a word, everything else its full path. */
export function folderLabel(path: string): string {
  const normalised = normaliseFolderPath(path);
  return normalised.length === 0 ? ROOT_FOLDER_LABEL : normalised;
}

/**
 * Is `candidate` `folder` itself or somewhere inside it? Segment-aware, so `Sicilian` does not
 * swallow `Sicilian Defence`. Everything is inside the root.
 */
export function isWithinFolder(candidate: string, folder: string): boolean {
  const a = normaliseFolderPath(candidate);
  const b = normaliseFolderPath(folder);
  if (b.length === 0) return true;
  return a === b || a.startsWith(`${b}${FOLDER_SEPARATOR}`);
}

/** One step of a breadcrumb trail: the segment name plus the path that opens it. */
export interface Crumb {
  name: string;
  path: string;
}

/**
 * Breadcrumbs for `path`, root first: `[{All lines, ''}, {Black, 'Black'}, …]`. The last entry
 * is the folder itself, so the caller can render it as the current (unlinked) crumb.
 */
export function folderCrumbs(path: string): Crumb[] {
  const crumbs: Crumb[] = [{ name: ROOT_FOLDER_LABEL, path: '' }];
  let walked = '';
  for (const segment of folderSegments(path)) {
    walked = walked.length === 0 ? segment : `${walked}${FOLDER_SEPARATOR}${segment}`;
    crumbs.push({ name: segment, path: walked });
  }
  return crumbs;
}

/** Lines filed directly in `folder` — not those in its subfolders. */
export function linesInFolder(lines: readonly Line[], folder: string): Line[] {
  const target = normaliseFolderPath(folder);
  return lines.filter((line) => lineFolder(line) === target);
}

/** Lines in `folder` *and* every folder beneath it. The root returns everything. */
export function linesUnderFolder(lines: readonly Line[], folder: string): Line[] {
  const target = normaliseFolderPath(folder);
  if (target.length === 0) return lines.slice();
  return lines.filter((line) => isWithinFolder(lineFolder(line), target));
}

/** A subfolder as the list screen shows it. */
export interface FolderNode {
  /** Full path, e.g. `Black/Sicilian`. */
  path: string;
  /** Last segment only, e.g. `Sicilian`. */
  name: string;
  /** Lines in this folder and everything below it — what "Drill this folder" would serve. */
  lineCount: number;
  /** Lines filed directly here. */
  directLineCount: number;
  /** Immediate subfolders. */
  subfolderCount: number;
}

/**
 * Every folder that any line mentions, including intermediates. `Black/Sicilian/Najdorf` on a
 * single line yields all three of `Black`, `Black/Sicilian` and `Black/Sicilian/Najdorf`, so a
 * folder is never unreachable just because nothing is filed at that level.
 */
export function allFolderPaths(lines: readonly Line[]): string[] {
  const paths = new Set<string>();
  for (const line of lines) {
    let walked = '';
    for (const segment of folderSegments(lineFolder(line))) {
      walked = walked.length === 0 ? segment : `${walked}${FOLDER_SEPARATOR}${segment}`;
      paths.add(walked);
    }
  }
  return [...paths].sort((a, b) => a.localeCompare(b));
}

/** Immediate subfolders of `folder`, name-sorted, each with its counts. */
export function childFolders(lines: readonly Line[], folder: string): FolderNode[] {
  const parent = normaliseFolderPath(folder);
  const depth = folderSegments(parent).length;
  const known = allFolderPaths(lines);

  const children = known.filter(
    (path) => isWithinFolder(path, parent) && path !== parent && folderSegments(path).length === depth + 1,
  );

  return children
    .map((path) => ({
      path,
      name: folderName(path),
      lineCount: linesUnderFolder(lines, path).length,
      directLineCount: linesInFolder(lines, path).length,
      subfolderCount: known.filter(
        (other) =>
          isWithinFolder(other, path) &&
          other !== path &&
          folderSegments(other).length === folderSegments(path).length + 1,
      ).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Where a line sitting in `current` ends up when folder `from` is renamed to `to`.
 * Lines outside `from` are untouched (returned as-is), and the subtree moves with its root.
 * `to` may be the empty string, which lifts the subtree to the root.
 */
export function renameFolderPath(current: string, from: string, to: string): string {
  const path = normaliseFolderPath(current);
  const source = normaliseFolderPath(from);
  const target = normaliseFolderPath(to);
  if (source.length === 0 || !isWithinFolder(path, source)) return path;
  const rest = path.slice(source.length).replace(/^\//, '');
  if (rest.length === 0) return target;
  return target.length === 0 ? rest : `${target}${FOLDER_SEPARATOR}${rest}`;
}

/**
 * Why a rename cannot be applied, or `null` when it can. Renaming a folder into its own
 * descendant (`Black` → `Black/Sicilian`) is the one move that has no sensible meaning.
 */
export function folderRenameError(from: string, to: string): string | null {
  const source = normaliseFolderPath(from);
  const target = normaliseFolderPath(to);
  if (source.length === 0) return 'The root is not a folder and cannot be renamed.';
  if (target.length === 0) return 'Give the folder a name.';
  if (target === source) return null;
  if (isWithinFolder(target, source)) return 'A folder cannot be moved inside itself.';
  return null;
}
