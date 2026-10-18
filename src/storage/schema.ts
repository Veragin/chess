/**
 * Persisted data model for saved repertoire lines, plus the single read path every caller
 * must go through (`migrate`).
 *
 * README §6: "Every read goes through `migrate()`. A malformed or unknown-version payload
 * must never throw into the UI — surface an error and leave existing data untouched."
 * `migrate` therefore never throws and never has side effects: it only reports what it made
 * of the payload. Deciding whether to write anything back is the caller's business, and
 * `lines.ts` deliberately never writes during a read.
 *
 * This module is pure — no `localStorage`, no `chess.js` calls — so it stays trivially testable.
 * (It builds trees with `chess/tree.ts`, whose chess.js-backed replay it never uses.)
 *
 * Versions:
 *  - **1** — a line was linear: `moves: string[]`.
 *  - **2** — a line is a move tree, stored PGN-like (`treeFormat.ts`): `tree` is the main line
 *    as an array of moves (`"e4"` or `{ "san": "e4", "comment": "…", "threats": ["Qh5"] }`), and an array after a
 *    move is an alternative to it; `moves` is gone. In memory a `Line` holds a `MoveTree` (see
 *    `chess/tree.ts`); only `serialiseLinesFile` writes the stored form. A v1 payload is still
 *    read: each line becomes a single-branch tree, and `migrate` reports `changed` so the next
 *    write persists it as v2. Nothing else is done to it (no joining of lines) — a migration
 *    must stay lossless and unsurprising.
 */

import { treeFromMoves, type MoveTree } from '../chess/tree';
import { formatJson } from './formatJson';
import { decodeTree, encodeTree, type StoredTree } from './treeFormat';

export const LINES_SCHEMA_VERSION = 2;

/** Oldest `schemaVersion` this build still reads (and upgrades). */
export const MIN_LINES_SCHEMA_VERSION = 1;

/** Deepest move tree a stored line may hold, in plies. Far beyond any real line; stops recursion. */
export const MAX_TREE_DEPTH = 1000;
/** Most moves (nodes) a stored line may hold. Refuses absurd payloads instead of choking on them. */
export const MAX_TREE_NODES = 20000;

/** Deepest folder nesting a path may express; anything below is truncated, never rejected. */
export const MAX_FOLDER_DEPTH = 8;
/** Longest single folder segment. Long enough for a real opening name, short enough to render. */
export const MAX_FOLDER_SEGMENT = 64;

/** A repertoire line: one starting position, and a tree of moves from it. */
export interface Line {
  id: string; // crypto.randomUUID()
  name: string;
  startFen: string; // valid FEN; standard start position by default
  /**
   * The moves playable from `startFen` (side to move there first), each with its continuations.
   * First child = main line. Empty for a line with no moves. Replaces v1's linear `moves`.
   */
  tree: MoveTree;
  /** Side the user trains as. Determines who moves in drill vs who is auto-played. */
  userColor: 'w' | 'b';
  /**
   * `/`-separated folder path (`Black/Sicilian`), or absent/empty for the root. Purely a label:
   * folders are implicit in these strings, never stored as records — see `folders.ts`.
   *
   * Optional on purpose. It was added after `schemaVersion` 1 shipped, and an *additive optional*
   * field needs no version bump: an older export simply has no folders, and an older build drops
   * the field instead of refusing the file.
   */
  folder?: string;
  notes?: string;
  createdAt: number; // epoch ms
  updatedAt: number;
  /**
   * `'server'` for a bundled line (`public/data/*.json`), absent for the user's own. In memory
   * only: it is never stored nor exported, so an exported bundled line imports as a user line.
   */
  origin?: 'server';
}

/**
 * The one definition of a folder path: `/`-separated segments, each whitespace-collapsed, with
 * empty segments dropped. Returns `''` for the root and for anything unusable, so callers never
 * have to handle a malformed path — there is no such thing.
 *
 * Total (never throws, never rejects) because a folder is a label, not data worth losing a line
 * over: a hand-edited store with `folder: 42` files that line at the root rather than dropping it.
 */
export function normaliseFolderPath(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .split('/')
    .map((segment) => segment.trim().replace(/\s+/g, ' ').slice(0, MAX_FOLDER_SEGMENT))
    .filter((segment) => segment.length > 0)
    .slice(0, MAX_FOLDER_DEPTH)
    .join('/');
}

export interface LinesFile {
  schemaVersion: number; // must equal LINES_SCHEMA_VERSION after migrate()
  exportedAt: number;
  lines: Line[];
}

/** Result of validating one candidate line object. */
export interface LineShapeResult {
  valid: boolean;
  error?: string;
}

export interface MigrateResult {
  file: LinesFile;
  /** True when `file` differs from the payload (lines dropped, fields repaired, version bumped). */
  changed: boolean;
  /** Human-readable problem description. Present ⇒ something in the payload was unusable. */
  error?: string;
}

/** File-level shape of a `LinesFile`, with the individual lines still unvalidated. */
export type PayloadResult =
  | { ok: true; schemaVersion: number; exportedAt: number | null; rawLines: unknown[] }
  | { ok: false; error: string };

export function emptyLinesFile(): LinesFile {
  return { schemaVersion: LINES_SCHEMA_VERSION, exportedAt: 0, lines: [] };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Checks a stored tree (`treeFormat.ts`): every item a non-empty SAN string, a
 * `{ san, comment?, threats? }` object, or a non-empty array (a variation) that follows a move. Returns
 * the first problem, or `null`. Iterative, and capped by `MAX_TREE_DEPTH` / `MAX_TREE_NODES`, so
 * a hostile payload is refused rather than overflowing the stack; variation nesting is capped by
 * `MAX_TREE_DEPTH` too, since an alternative does not advance the ply.
 */
function storedTreeShapeError(raw: unknown): string | null {
  if (!Array.isArray(raw)) {
    return '"tree" must be an array of moves';
  }
  /** `ply` is the ply of the line's first move; `nesting` counts enclosing variations. */
  const stack: { items: unknown[]; label: string; ply: number; nesting: number }[] = [
    { items: raw, label: 'tree', ply: 1, nesting: 0 },
  ];
  let count = 0;
  while (stack.length > 0) {
    const { items, label, ply, nesting } = stack.pop() as (typeof stack)[number];
    if (nesting > MAX_TREE_DEPTH) {
      return `"tree" nests variations deeper than ${MAX_TREE_DEPTH} levels`;
    }
    if (nesting > 0 && items.length === 0) {
      return `"${label}" is an empty variation`;
    }
    let moves = 0;
    for (let i = 0; i < items.length; i++) {
      const item: unknown = items[i];
      const at = `${label}[${i}]`;
      if (Array.isArray(item)) {
        if (moves === 0) {
          return `"${at}" is a variation with no move before it`;
        }
        stack.push({ items: item, label: at, ply: ply + moves - 1, nesting: nesting + 1 });
        continue;
      }
      count++;
      if (count > MAX_TREE_NODES) {
        return `"tree" has more than ${MAX_TREE_NODES} moves`;
      }
      if (ply + moves > MAX_TREE_DEPTH) {
        return `"tree" is deeper than ${MAX_TREE_DEPTH} moves`;
      }
      const san: unknown = isPlainObject(item) ? item.san : item;
      if (typeof san !== 'string' || san.trim().length === 0) {
        return isPlainObject(item)
          ? `"${at}.san" is not a SAN string`
          : `"${at}" is not a move (a SAN string or { "san", "comment" })`;
      }
      if (isPlainObject(item) && item.next !== undefined) {
        // A nested `{ san, next }` node (the in-memory shape): reading it would silently drop
        // its continuations.
        return `"${at}" has "next"; continuations follow a move in the same array`;
      }
      if (isPlainObject(item) && item.comment !== undefined && typeof item.comment !== 'string') {
        return `"${at}.comment" must be a string when present`;
      }
      if (
        isPlainObject(item) &&
        item.threats !== undefined &&
        (!Array.isArray(item.threats) || item.threats.some((t) => typeof t !== 'string'))
      ) {
        return `"${at}.threats" must be an array of move strings when present`;
      }
      moves++;
    }
  }
  return null;
}

/** v1's linear `moves`: an array of non-empty strings. Returns the first problem, or `null`. */
function movesShapeError(raw: unknown): string | null {
  if (!Array.isArray(raw)) {
    return '"moves" must be an array of SAN strings';
  }
  for (let i = 0; i < raw.length; i++) {
    const mv: unknown = raw[i];
    if (typeof mv !== 'string' || mv.trim().length === 0) {
      return `"moves[${i}]" is not a SAN string`;
    }
  }
  return null;
}

/** The version a payload's lines are written in, clamped to what this build knows. */
function lineVersion(schemaVersion: number): number {
  return schemaVersion < LINES_SCHEMA_VERSION ? schemaVersion : LINES_SCHEMA_VERSION;
}

/**
 * Validates one candidate `Line` object field by field. Shared by `migrate` (to drop junk
 * out of the store) and by `importFile` (to explain why a line was rejected).
 *
 * `schemaVersion` is the version of the payload the line came from: a v1 line carries `moves`,
 * a v2 line carries `tree`. Defaults to the current version.
 */
export function validateLineShape(
  raw: unknown,
  schemaVersion: number = LINES_SCHEMA_VERSION,
): LineShapeResult {
  if (!isPlainObject(raw)) {
    return { valid: false, error: 'not an object' };
  }
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    return { valid: false, error: 'missing or invalid "id"' };
  }
  if (typeof raw.name !== 'string') {
    return { valid: false, error: 'missing or invalid "name"' };
  }
  if (typeof raw.startFen !== 'string' || raw.startFen.trim().length === 0) {
    return { valid: false, error: 'missing or invalid "startFen"' };
  }
  const movesError =
    lineVersion(schemaVersion) === 1 ? movesShapeError(raw.moves) : storedTreeShapeError(raw.tree);
  if (movesError !== null) {
    return { valid: false, error: movesError };
  }
  if (raw.userColor !== 'w' && raw.userColor !== 'b') {
    return { valid: false, error: '"userColor" must be "w" or "b"' };
  }
  if (raw.notes !== undefined && typeof raw.notes !== 'string') {
    return { valid: false, error: '"notes" must be a string when present' };
  }
  if (raw.folder !== undefined && raw.folder !== null && typeof raw.folder !== 'string') {
    return { valid: false, error: '"folder" must be a string when present' };
  }
  if (!isFiniteNumber(raw.createdAt)) {
    return { valid: false, error: 'missing or invalid "createdAt"' };
  }
  if (!isFiniteNumber(raw.updatedAt)) {
    return { valid: false, error: 'missing or invalid "updatedAt"' };
  }
  return { valid: true };
}

/**
 * Copies a *validated* candidate into a fresh `Line`, keeping only schema fields — turning a v1
 * candidate's `moves` into a single-branch `tree`, and a stored tree into a `MoveTree`.
 * Call `validateLineShape` first; returns null if the shape does not hold.
 */
export function toLine(raw: unknown, schemaVersion: number = LINES_SCHEMA_VERSION): Line | null {
  if (!validateLineShape(raw, schemaVersion).valid || !isPlainObject(raw)) return null;
  const tree =
    lineVersion(schemaVersion) === 1
      ? treeFromMoves((raw.moves as string[]).map((m) => m.trim()))
      : decodeTree(raw.tree as StoredTree);
  const line: Line = {
    id: raw.id as string,
    name: raw.name as string,
    startFen: (raw.startFen as string).trim(),
    tree,
    userColor: raw.userColor as 'w' | 'b',
    createdAt: raw.createdAt as number,
    updatedAt: raw.updatedAt as number,
  };
  const folder = normaliseFolderPath(raw.folder);
  if (folder.length > 0) {
    line.folder = folder;
  }
  if (typeof raw.notes === 'string') {
    line.notes = raw.notes;
  }
  return line;
}

/** A `Line` as written to storage or a file: its `tree` in the stored form. */
export type StoredLine = Omit<Line, 'tree'> & { tree: StoredTree };

/** A `LinesFile` as written to storage or a file. */
export interface StoredLinesFile {
  schemaVersion: number;
  exportedAt: number;
  lines: StoredLine[];
}

/** Fields in a fixed order (optional ones only when present), so written files diff cleanly. */
export function toStoredLine(line: Line): StoredLine {
  const out: StoredLine = {
    id: line.id,
    name: line.name,
    startFen: line.startFen,
    tree: encodeTree(line.tree),
    userColor: line.userColor,
    createdAt: line.createdAt,
    updatedAt: line.updatedAt,
  };
  if (line.folder !== undefined) out.folder = line.folder;
  if (line.notes !== undefined) out.notes = line.notes;
  return out;
}

export function toStoredLinesFile(file: LinesFile): StoredLinesFile {
  return {
    schemaVersion: file.schemaVersion,
    exportedAt: file.exportedAt,
    lines: file.lines.map(toStoredLine),
  };
}

/**
 * The one write path: `file` in the stored form, as JSON `migrate` reads back to an equal
 * file. `pretty` lays it out for people (exports, `public/data`); otherwise it is compact.
 * Throws only where `JSON.stringify` would.
 */
export function serialiseLinesFile(file: LinesFile, pretty = false): string {
  const stored = toStoredLinesFile(file);
  return pretty ? formatJson(stored) : JSON.stringify(stored);
}

/** A short human label for a candidate line, used in import rejection messages. */
export function lineLabel(raw: unknown, index: number): string {
  if (isPlainObject(raw) && typeof raw.name === 'string' && raw.name.trim().length > 0) {
    return raw.name;
  }
  return `(unnamed line #${index + 1})`;
}

/**
 * File-level validation: accepts either a JSON string or an already-parsed object, and
 * checks the envelope (`schemaVersion`, `lines`) without looking inside the lines.
 * Never throws.
 */
export function parseLinesFilePayload(raw: unknown): PayloadResult {
  let value: unknown = raw;

  if (typeof value === 'string') {
    const text = value.trim();
    if (text.length === 0) {
      return { ok: false, error: 'Stored data is empty' };
    }
    try {
      value = JSON.parse(text);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Not valid JSON: ${detail}` };
    }
  }

  if (value === null || value === undefined) {
    return { ok: false, error: 'No data' };
  }
  if (!isPlainObject(value)) {
    return { ok: false, error: 'Expected a JSON object with a "lines" array' };
  }

  const version: unknown = value.schemaVersion;
  if (!isFiniteNumber(version) || !Number.isInteger(version)) {
    return { ok: false, error: 'Missing or invalid "schemaVersion"' };
  }
  if (version > LINES_SCHEMA_VERSION) {
    return {
      ok: false,
      error:
        `File was written by a newer version of the app (schemaVersion ${version}; ` +
        `this build understands up to ${LINES_SCHEMA_VERSION})`,
    };
  }
  if (version < MIN_LINES_SCHEMA_VERSION) {
    return { ok: false, error: `Unknown schemaVersion ${version}` };
  }

  if (value.lines === undefined || value.lines === null) {
    return { ok: false, error: 'Missing "lines"' };
  }
  if (!Array.isArray(value.lines)) {
    return { ok: false, error: '"lines" must be an array' };
  }

  const exportedAt = isFiniteNumber(value.exportedAt) ? value.exportedAt : null;
  return { ok: true, schemaVersion: version, exportedAt, rawLines: value.lines as unknown[] };
}

/**
 * The single read path. Accepts whatever came out of storage (or a file): `null`,
 * `undefined`, an empty string, a JSON string, an already-parsed object, or garbage.
 *
 * - Absent/empty store ⇒ an empty file, `changed: false`, no error (not a problem).
 * - Unusable payload ⇒ an empty file plus `error`; the caller must NOT persist this.
 * - Future `schemaVersion` ⇒ refused outright, never guessed at.
 * - Older `schemaVersion` ⇒ upgraded in the returned file, `changed: true` (the store itself is
 *   only rewritten by the caller's next ordinary write).
 * - Individual malformed lines ⇒ dropped, `changed: true`, and `error` naming the count.
 *
 * Never throws, never writes.
 */
export function migrate(raw: unknown): MigrateResult {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim().length === 0)) {
    return { file: emptyLinesFile(), changed: false };
  }

  const payload = parseLinesFilePayload(raw);
  if (!payload.ok) {
    return { file: emptyLinesFile(), changed: false, error: payload.error };
  }

  let changed = payload.schemaVersion !== LINES_SCHEMA_VERSION;
  const lines: Line[] = [];
  const dropped: string[] = [];

  for (let i = 0; i < payload.rawLines.length; i++) {
    const candidate = payload.rawLines[i];
    const shape = validateLineShape(candidate, payload.schemaVersion);
    const line = shape.valid ? toLine(candidate, payload.schemaVersion) : null;
    if (line === null) {
      dropped.push(`${lineLabel(candidate, i)}: ${shape.error ?? 'invalid'}`);
      changed = true;
      continue;
    }
    lines.push(line);
  }

  let exportedAt = payload.exportedAt;
  if (exportedAt === null) {
    exportedAt = 0;
    changed = true;
  }

  const file: LinesFile = { schemaVersion: LINES_SCHEMA_VERSION, exportedAt, lines };
  if (dropped.length > 0) {
    return {
      file,
      changed,
      error: `Skipped ${dropped.length} unreadable line(s): ${dropped.join('; ')}`,
    };
  }
  return { file, changed };
}
