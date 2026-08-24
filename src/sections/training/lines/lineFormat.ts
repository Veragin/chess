/**
 * Presentation helpers for the saved-lines list (README §7 Phase 5).
 *
 * Pure on purpose (README §9): the list row is then nothing but markup, and the search /
 * labelling / filename rules are unit-testable without a DOM.
 */

import type { Color } from '../../../chess/game';
import { START_FEN } from '../../../chess/position';
import type { Line } from '../../../storage/schema';

/** Lowercased, whitespace-collapsed search text. Empty string ⇒ "no filter". */
export function normaliseQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Search-by-name: case-insensitive substring match on the name, order preserved. Notes are
 * deliberately not searched — the list shows names, so matching something invisible would look
 * like a bug.
 */
export function filterLines(lines: Line[], query: string): Line[] {
  const needle = normaliseQuery(query);
  if (needle.length === 0) return lines.slice();
  return lines.filter((line) => normaliseQuery(line.name).includes(needle));
}

export function colorLabel(color: Color): string {
  return color === 'w' ? 'White' : 'Black';
}

/** The four fields of a FEN that describe the position itself (clocks are irrelevant here). */
function positionFields(fen: string): string {
  return fen.trim().split(/\s+/).slice(0, 4).join(' ');
}

export function isStandardStart(fen: string): boolean {
  return positionFields(fen) === positionFields(START_FEN);
}

/** Short label for the start position column: a name for the usual case, else the FEN itself. */
export function startPositionLabel(fen: string): string {
  return isStandardStart(fen) ? 'Standard start position' : fen.trim();
}

export function moveCountLabel(count: number): string {
  if (count <= 0) return 'no moves';
  return count === 1 ? '1 move' : `${count} moves`;
}

export function lineCountLabel(count: number): string {
  if (count <= 0) return 'no lines';
  return count === 1 ? '1 line' : `${count} lines`;
}

export function subfolderCountLabel(count: number): string {
  if (count <= 0) return 'no subfolders';
  return count === 1 ? '1 subfolder' : `${count} subfolders`;
}

/**
 * The panel heading for one folder's contents. Mentions the subtree only when it actually adds
 * something — "3 lines · 7 including subfolders" is noise when there are no subfolders.
 */
export function folderCountLabel(direct: number, total: number): string {
  const here = lineCountLabel(direct);
  return total > direct ? `${here} · ${total} including subfolders` : here;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `2026-08-22 14:05` — sortable, unambiguous, and locale-independent for test stability. */
export function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'never';
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  );
}

/**
 * A folder path as a filename fragment: `Black/Sicilian` → `black-sicilian`. Anything that is
 * not a letter or digit becomes a dash, so no path can produce a name the OS refuses. Returns
 * the empty string for the root, and for a path with nothing usable left in it (e.g. `///`).
 */
function folderSlug(folder: string): string {
  return folder
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * `chess-lines-2026-08-22.json`, or `chess-lines-black-sicilian-2026-08-22.json` when the
 * export was taken inside a folder — the file says what is in it without being opened.
 */
export function exportFileName(ms: number, folder = ''): string {
  const d = new Date(Number.isFinite(ms) ? ms : 0);
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const slug = folderSlug(folder);
  return slug.length === 0 ? `chess-lines-${date}.json` : `chess-lines-${slug}-${date}.json`;
}

/** One-line summary of a line for the row's accessible label. */
export function describeLine(line: Line): string {
  return (
    `${line.name.trim().length === 0 ? 'Untitled line' : line.name}, ` +
    `${moveCountLabel(line.moves.length)}, trained as ${colorLabel(line.userColor)}`
  );
}
