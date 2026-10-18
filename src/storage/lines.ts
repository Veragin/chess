/**
 * CRUD + export/import for saved repertoire lines, on top of a single versioned
 * `localStorage` key.
 *
 * Two rules drive the shape of this module:
 *
 * 1. **`localStorage` throws** — private mode, disabled storage, and quota-exceeded writes
 *    (README §8.10). Every access is wrapped; on failure the data lives in an in-memory
 *    store for the rest of the session and `storageWarning()` explains it. A write that
 *    only reached memory is never reported as a success.
 * 2. **Reading never writes.** Every read goes through `migrate()`, and a payload we could
 *    not understand is left exactly as it is on disk — repairing it in place as a side
 *    effect of a read would destroy data the user might still recover by exporting.
 *
 * `localStorage` is looked up lazily inside each accessor (never captured at import time)
 * so the module works in a DOM-less environment and can be tested with a stub.
 *
 * **Server lines vs. user lines.** Only the user's own lines are stored under `STORAGE_KEY`. The
 * bundled lines (`public/data/*.json`) are handed in at startup by `seed.ts` through
 * `setServerLines` and live in memory only, so a new build simply replaces them — there is
 * nothing to merge with what the user wrote. Every reader (`listLines`, `getLine`, exports) sees
 * both, marked by `Line.origin`. A server line is never written to: editing one stores an edited
 * copy under a fresh id and hides the original, and deleting one only hides it. The hidden ids
 * live under their own key (`HIDDEN_KEY`).
 *
 * **Personal.** The user's Personal set (`personal.ts`) refers to lines by id, so the operations
 * here that change or drop an id — a fork, a delete — keep it in step through `personalIds.ts`.
 */

import { validateFenRules } from '../chess/game';
import { branchIndexOf, cloneTree, countBranches, dedupeSiblings, replayTree } from '../chess/tree';
import {
  folderRenameError,
  isWithinFolder,
  lineFolder,
  linesUnderFolder,
  renameFolderPath,
} from './folders';
import { removePersonalIds, replacePersonalIds } from './personalIds';
import {
  LINES_SCHEMA_VERSION,
  lineLabel,
  migrate,
  normaliseFolderPath,
  parseLinesFilePayload,
  serialiseLinesFile,
  toLine,
  validateLineShape,
  type Line,
  type LinesFile,
} from './schema';

/** Single storage key for the whole repertoire. The payload is a `LinesFile`. */
const STORAGE_KEY = 'chess-trainer.lines.v1';

/** Ids of server lines the user deleted or replaced with an edited copy. A JSON string array. */
const HIDDEN_KEY = 'chess-trainer.hiddenServerLines.v1';

const UNAVAILABLE =
  'Browser storage is unavailable (private browsing or blocked cookies). ' +
  'Lines are kept in memory only and will be lost when this tab closes.';
const WRITE_FAILED =
  'Browser storage rejected the write (it may be full). Lines are kept in memory only ' +
  'and will be lost when this tab closes.';

// ---------------------------------------------------------------------------------------
// Storage access, with in-memory degradation
// ---------------------------------------------------------------------------------------

/**
 * Session-scoped fallback. `null` means "we have never had to fall back"; once it holds a
 * value it takes precedence over `localStorage`, because the on-disk copy is by then known
 * to be stale (a write failed) or unreachable.
 */
let memoryValue: string | null = null;
let usingMemory = false;
let warning: string | null = null;

/** Returns the real `localStorage`, or null if merely touching it throws. */
function localStore(): Storage | null {
  try {
    const store = (globalThis as { localStorage?: Storage | null }).localStorage;
    if (!store || typeof store.getItem !== 'function' || typeof store.setItem !== 'function') {
      return null;
    }
    return store;
  } catch {
    return null;
  }
}

function degrade(reason: string, seed: string | null): void {
  if (!usingMemory) {
    usingMemory = true;
    memoryValue = seed;
  }
  warning = reason;
}

function readRaw(): string | null {
  if (usingMemory) return memoryValue;
  const store = localStore();
  if (store === null) {
    degrade(UNAVAILABLE, null);
    return memoryValue;
  }
  try {
    return store.getItem(STORAGE_KEY);
  } catch {
    degrade(UNAVAILABLE, null);
    return memoryValue;
  }
}

/** Persists `value`. Returns false when it only made it into the in-memory fallback. */
function writeRaw(value: string): boolean {
  if (!usingMemory) {
    const store = localStore();
    if (store !== null) {
      try {
        store.setItem(STORAGE_KEY, value);
        return true;
      } catch {
        // Quota exceeded, or storage revoked mid-session.
        degrade(WRITE_FAILED, value);
        memoryValue = value;
        return false;
      }
    }
    degrade(UNAVAILABLE, value);
  }
  memoryValue = value;
  return false;
}

/**
 * The warning to surface in the UI: storage unavailable, a write that only reached memory,
 * or a stored payload that could not be read. `null` when everything is healthy.
 */
export function storageWarning(): string | null {
  return warning;
}

// ---------------------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------------------

/** Reads and migrates the store. Never writes, whatever it finds. */
function loadFile(): LinesFile {
  const raw = readRaw();
  const result = migrate(raw);
  if (result.error !== undefined) {
    warning = `Saved lines could not be read: ${result.error}`;
  } else if (warning !== null && !usingMemory) {
    // A previous read complained about the payload; it is fine now.
    warning = null;
  }
  return result.file;
}

/** Writes the file back. Returns false when the write only reached memory. */
function saveFile(lines: Line[]): boolean {
  const file: LinesFile = {
    schemaVersion: LINES_SCHEMA_VERSION,
    exportedAt: Date.now(),
    lines,
  };
  let json: string;
  try {
    json = serialiseLinesFile(file);
  } catch {
    warning = 'Lines could not be serialised for storage.';
    return false;
  }
  const persisted = writeRaw(json);
  if (persisted && !usingMemory) {
    warning = null;
  }
  return persisted;
}

function newId(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch {
    // fall through to the non-crypto fallback below
  }
  // Insecure context / very old engine: good enough for a local, single-user store.
  return `line-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function byUpdatedAtDesc(a: Line, b: Line): number {
  if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
  if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
  return a.name.localeCompare(b.name);
}

// ---------------------------------------------------------------------------------------
// Server lines
// ---------------------------------------------------------------------------------------

/** The bundled lines, as last handed in by `setServerLines`. Never persisted. */
let serverLines: Line[] = [];

/**
 * Hidden server ids, mirrored in memory so a session whose storage is blocked still hides what
 * the user deleted. `null` until first read.
 */
let hiddenIds: Set<string> | null = null;

/** Replaces the bundled lines (validated by the caller), each marked `origin: 'server'`. */
export function setServerLines(lines: readonly Line[]): void {
  serverLines = lines.map((line) => ({ ...line, origin: 'server' }));
}

function readHidden(): Set<string> {
  if (hiddenIds !== null) return hiddenIds;
  hiddenIds = new Set();
  const store = localStore();
  if (store === null) return hiddenIds;
  try {
    const parsed: unknown = JSON.parse(store.getItem(HIDDEN_KEY) ?? '[]');
    if (Array.isArray(parsed)) {
      for (const id of parsed) if (typeof id === 'string') hiddenIds.add(id);
    }
  } catch {
    // Unreadable record: hide nothing. Worst case a deleted bundled line reappears.
  }
  return hiddenIds;
}

/** Best-effort, like the record it replaces: losing it only brings bundled lines back. */
function hideServerLines(ids: readonly string[]): void {
  if (ids.length === 0) return;
  const hidden = readHidden();
  for (const id of ids) hidden.add(id);
  const store = localStore();
  if (store === null) return;
  try {
    store.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
  } catch {
    // Kept in memory for this session.
  }
}

/**
 * Removes only the hidden-ids record — every bundled line is visible again, the user's own lines
 * stay. Returns false when the key could not be removed from disk; the session un-hides them
 * either way, so the caller reports it rather than retrying.
 */
export function clearHiddenServerLines(): boolean {
  hiddenIds = new Set();
  const store = localStore();
  if (store === null) return false;
  try {
    store.removeItem(HIDDEN_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Bundled lines currently hidden — deleted by the user, or replaced by an edited copy. */
export function hiddenServerLineCount(): number {
  const hidden = readHidden();
  return serverLines.filter((line) => hidden.has(line.id)).length;
}

function visibleServerLines(): Line[] {
  const hidden = readHidden();
  return serverLines.filter((line) => !hidden.has(line.id));
}

function findServerLine(id: string): Line | null {
  return visibleServerLines().find((l) => l.id === id) ?? null;
}

/**
 * An edited copy of a server line: a user line under a fresh id, everything but the identity
 * carried over. The caller stores it and hides the original.
 */
function forkServerLine(line: Line): Line {
  const copy: Line = { ...line, id: newId(), createdAt: Date.now() };
  delete copy.origin;
  return copy;
}

/** Ids that resolve right now — what a write to the Personal set keeps. */
function liveIds(): Set<string> {
  return new Set([...loadFile().lines, ...visibleServerLines()].map((line) => line.id));
}

// ---------------------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------------------

/** All lines — the user's own and the visible server ones — most recently updated first. */
export function listLines(): Line[] {
  return [...loadFile().lines, ...visibleServerLines()].sort(byUpdatedAtDesc);
}

export function getLine(id: string): Line | null {
  if (typeof id !== 'string' || id.length === 0) return null;
  return loadFile().lines.find((l) => l.id === id) ?? findServerLine(id);
}

export function isServerLine(line: Line): boolean {
  return line.origin === 'server';
}

export function createLine(input: Omit<Line, 'id' | 'createdAt' | 'updatedAt'>): Line {
  const now = Date.now();
  const line: Line = {
    id: newId(),
    name: input.name,
    startFen: input.startFen,
    tree: cloneTree(input.tree),
    userColor: input.userColor,
    createdAt: now,
    updatedAt: now,
  };
  const folder = normaliseFolderPath(input.folder);
  if (folder.length > 0) {
    line.folder = folder;
  }
  if (input.notes !== undefined) {
    line.notes = input.notes;
  }
  const file = loadFile();
  saveFile([...file.lines, line]);
  return line;
}

/**
 * Applies `patch` to line `id`. Editing a **server** line stores the result as a new user line
 * (fresh id) and hides the original, so the returned line's `id` can differ from `id`.
 */
export function updateLine(
  id: string,
  patch: Partial<Omit<Line, 'id' | 'createdAt' | 'origin'>>,
): Line | null {
  const file = loadFile();
  let index = file.lines.findIndex((l) => l.id === id);
  let forkedFrom: string | null = null;
  if (index === -1) {
    const server = findServerLine(id);
    if (server === null) return null;
    file.lines.push(forkServerLine(server));
    index = file.lines.length - 1;
    forkedFrom = server.id;
  }
  const current = file.lines[index] as Line;

  const updated: Line = {
    ...current,
    name: patch.name ?? current.name,
    startFen: patch.startFen ?? current.startFen,
    tree: patch.tree === undefined ? current.tree : cloneTree(patch.tree),
    userColor: patch.userColor ?? current.userColor,
    updatedAt: patch.updatedAt ?? Date.now(),
  };
  if (patch.folder !== undefined) {
    // `''` is a meaningful value here — "move this line to the root" — so the key is deleted
    // rather than written empty, keeping the stored record free of no-op fields.
    const folder = normaliseFolderPath(patch.folder);
    if (folder.length > 0) updated.folder = folder;
    else delete updated.folder;
  }
  if (patch.notes !== undefined) {
    updated.notes = patch.notes;
  }

  const next = file.lines.slice();
  next[index] = updated;
  const persisted = saveFile(next);
  // Only once the copy is stored: hiding the original after a failed write would lose the line.
  if (forkedFrom !== null && persisted) {
    hideServerLines([forkedFrom]);
    replacePersonalIds(new Map([[forkedFrom, updated.id]]), liveIds());
  }
  return updated;
}

/**
 * Deletes a user line, or hides a server line (it stays hidden across builds). Either way it
 * leaves the Personal set too.
 */
export function deleteLine(id: string): boolean {
  const file = loadFile();
  const next = file.lines.filter((l) => l.id !== id);
  if (next.length === file.lines.length) {
    if (findServerLine(id) === null) return false;
    hideServerLines([id]);
  } else {
    saveFile(next);
  }
  removePersonalIds([id], liveIds());
  return true;
}

/**
 * Removes the user's lines from storage and un-hides every server line — the "clear data"
 * escape hatch, not an operation any normal edit reaches.
 *
 * The in-memory fallback and its warning are dropped too: a session that had degraded must not
 * keep serving the copy that is now meant to be gone. Returns false when the on-disk payload
 * could not be removed (storage blocked or revoked); the session is empty either way, so the
 * caller reports it rather than retrying.
 */
export function clearLines(): boolean {
  usingMemory = false;
  memoryValue = null;
  warning = null;
  hiddenIds = null;
  const store = localStore();
  if (store !== null) {
    try {
      store.removeItem(STORAGE_KEY);
      store.removeItem(HIDDEN_KEY);
      return true;
    } catch {
      // Storage revoked mid-session, or no `removeItem` at all.
    }
  }
  degrade(UNAVAILABLE, null);
  return false;
}

// ---------------------------------------------------------------------------------------
// Folders
//
// Folders live only in each line's `folder` path (see `folders.ts`), so every folder operation
// is a bulk edit of lines. There is nothing else to delete, create or keep in sync.
// ---------------------------------------------------------------------------------------

export interface FolderOpResult {
  ok: boolean;
  /** Lines whose folder path changed. */
  moved: number;
  /** Why nothing was done, or why the write did not reach disk. */
  error?: string;
}

/**
 * Renames folder `from` to `to`, carrying its whole subtree with it. `to` may name a folder that
 * already exists — the two simply merge, which is the only reasonable reading of "rename A to B"
 * when B is already there and folders have no identity of their own.
 *
 * `updatedAt` is deliberately **not** touched: filing a line somewhere else is not a change to
 * the line, and bumping it would reshuffle the whole list order for a rename.
 *
 * Server lines in the folder are edits like any other: each becomes a user copy (see
 * `updateLine`) filed under the new name.
 */
export function renameFolder(from: string, to: string): FolderOpResult {
  const invalid = folderRenameError(from, to);
  if (invalid !== null) return { ok: false, moved: 0, error: invalid };

  const file = loadFile();
  const forked = visibleServerLines().filter((line) => isWithinFolder(lineFolder(line), from));
  const copies = forked.map(forkServerLine);
  let moved = 0;
  const next = [...file.lines, ...copies].map((line) => {
    const current = lineFolder(line);
    if (!isWithinFolder(current, from)) return line;
    const folder = renameFolderPath(current, from, to);
    if (folder === current) return line;
    moved++;
    const updated: Line = { ...line };
    if (folder.length > 0) updated.folder = folder;
    else delete updated.folder;
    return updated;
  });

  if (moved === 0) return { ok: true, moved: 0 };
  const persisted = saveFile(next);
  if (persisted) {
    hideServerLines(forked.map((line) => line.id));
    replacePersonalIds(
      new Map(forked.map((line, i) => [line.id, (copies[i] as Line).id])),
      liveIds(),
    );
  }
  const result: FolderOpResult = { ok: true, moved };
  if (!persisted) result.error = warning ?? WRITE_FAILED;
  return result;
}

/** Files one line under `folder` (`''` for the root). Returns the updated line, or null. */
export function moveLineToFolder(id: string, folder: string): Line | null {
  const current = getLine(id);
  if (current === null) return null;
  return updateLine(id, { folder: normaliseFolderPath(folder), updatedAt: current.updatedAt });
}

// ---------------------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------------------

/**
 * The whole repertoire, in the same shape as an export file on disk.
 *
 * Kept as its own name (rather than `exportFolder('')`) because "export everything" is what the
 * round-trip tests and the bundled `public/data/*.json` files are about.
 */
export function exportAll(): LinesFile {
  return exportFolder('');
}

/**
 * One folder and everything below it — the same scope as "Drill folder" and Explore, so an
 * export taken from inside a folder contains exactly the lines that folder was showing.
 *
 * Folder paths are exported **unchanged**, absolute rather than relative to `folder`: importing
 * the file back rebuilds the tree where it came from, and an export of `Black/Sicilian` merged
 * into another repertoire lands under the same path it had. The root exports everything.
 */
export function exportFolder(folder: string): LinesFile {
  const scope = normaliseFolderPath(folder);
  const lines = listLines();
  return {
    schemaVersion: LINES_SCHEMA_VERSION,
    exportedAt: Date.now(),
    lines: scope.length === 0 ? lines : linesUnderFolder(lines, scope),
  };
}

export interface ImportRejection {
  name: string;
  reason: string;
}

export interface ImportResult {
  added: number;
  skipped: number;
  rejections: ImportRejection[];
  error?: string;
}

/** What became of one candidate line from a file: a usable `Line`, or a reason it was refused. */
export interface LineCandidate {
  /** Position in the file's `lines` array — the caller's handle on the raw entry. */
  index: number;
  /** Label used in rejection messages (the line's name, or `(unnamed line #n)`). */
  name: string;
  /** Validated and SAN-normalised, still carrying the file's own `id`. Null when rejected. */
  line: Line | null;
  reason?: string;
}

function validateCandidate(raw: unknown, index: number, schemaVersion: number): LineCandidate {
  const name = lineLabel(raw, index);

  const shape = validateLineShape(raw, schemaVersion);
  if (!shape.valid) {
    return { index, name, line: null, reason: shape.error ?? 'invalid line' };
  }
  const line = toLine(raw, schemaVersion);
  if (line === null) {
    return { index, name, line: null, reason: 'invalid line' };
  }

  const fen = validateFenRules(line.startFen);
  if (!fen.valid) {
    return {
      index,
      name,
      line: null,
      reason: `illegal start position: ${fen.error ?? 'invalid FEN'}`,
    };
  }

  const replay = replayTree(line.startFen, line.tree);
  if (replay.broken !== null) {
    const { path, san } = replay.broken;
    const ply = path.length - 1;
    // "move 7 in branch 3": the first branch through the broken move, numbered from 1.
    const where =
      countBranches(line.tree) > 1
        ? `move ${ply + 1} in branch ${branchIndexOf(line.tree, path) + 1}`
        : `move ${ply + 1}`;
    return {
      index,
      name,
      line: null,
      reason: `illegal move "${san.length > 0 ? san : '(missing)'}" at ply ${ply} (${where})`,
    };
  }

  // SANs as chess.js writes them; two spellings of one move become one continuation.
  return { index, name, line: { ...line, tree: dedupeSiblings(replay.tree) } };
}

/**
 * Validates shape, FEN legality and SAN replayability of every candidate line, per line and
 * without writing anything. Shared by `importFile` and by the startup seeder (`seed.ts`),
 * which needs to know *which* lines were accepted, not just how many.
 */
export function validateImportLines(
  rawLines: unknown[],
  schemaVersion: number = LINES_SCHEMA_VERSION,
): LineCandidate[] {
  return rawLines.map((raw, index) => validateCandidate(raw, index, schemaVersion));
}

/**
 * Appends already-validated lines in one write, each under a **fresh id** — which is what
 * makes an import (or a seed) unable to clobber an existing line. `error` is set when the
 * write only reached the in-memory fallback.
 */
export function addLines(lines: Line[]): { added: number; error?: string } {
  if (lines.length === 0) return { added: 0 };
  const existing = loadFile().lines;
  const fresh = lines.map((line) => ({ ...line, id: newId() }));
  const persisted = saveFile([...existing, ...fresh]);
  if (persisted) return { added: fresh.length };
  return { added: fresh.length, error: warning ?? WRITE_FAILED };
}

/**
 * Validates shape, FEN legality, and SAN replayability of every line BEFORE writing
 * anything.
 *
 * - A structurally broken *file* (bad JSON, unknown/future `schemaVersion`, no `lines`
 *   array) imports nothing at all and reports `error`.
 * - Individual bad lines are rejected with a reason naming the line; the good lines from
 *   the same file are still imported.
 * - Every imported line gets a fresh `id`, so an import can never clobber an existing
 *   line; duplicate names are tolerated.
 */
export function importFile(json: string): ImportResult {
  const payload = parseLinesFilePayload(json);
  if (!payload.ok) {
    return { added: 0, skipped: 0, rejections: [], error: payload.error };
  }

  const candidates = validateImportLines(payload.rawLines, payload.schemaVersion);
  const accepted = candidates
    .map((c) => c.line)
    .filter((line): line is Line => line !== null);
  const rejections: ImportRejection[] = candidates
    .filter((c) => c.line === null)
    .map((c) => ({ name: c.name, reason: c.reason ?? 'invalid line' }));

  if (accepted.length === 0) {
    return { added: 0, skipped: rejections.length, rejections };
  }

  // Nothing has been written up to this point — all validation is done.
  const write = addLines(accepted);
  const result: ImportResult = {
    added: write.added,
    skipped: rejections.length,
    rejections,
  };
  if (write.error !== undefined) {
    result.error = write.error;
  }
  return result;
}
