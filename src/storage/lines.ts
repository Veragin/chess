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
 */

import { replaySan, validateFenRules } from '../chess/game';
import { folderRenameError, isWithinFolder, lineFolder, renameFolderPath } from './folders';
import {
  LINES_SCHEMA_VERSION,
  lineLabel,
  migrate,
  normaliseFolderPath,
  parseLinesFilePayload,
  toLine,
  validateLineShape,
  type Line,
  type LinesFile,
} from './schema';

/** Single storage key for the whole repertoire. The payload is a `LinesFile`. */
const STORAGE_KEY = 'chess-trainer.lines.v1';

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
    json = JSON.stringify(file);
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
// CRUD
// ---------------------------------------------------------------------------------------

/** All saved lines, most recently updated first. */
export function listLines(): Line[] {
  return loadFile().lines.slice().sort(byUpdatedAtDesc);
}

export function getLine(id: string): Line | null {
  if (typeof id !== 'string' || id.length === 0) return null;
  return loadFile().lines.find((l) => l.id === id) ?? null;
}

export function createLine(input: Omit<Line, 'id' | 'createdAt' | 'updatedAt'>): Line {
  const now = Date.now();
  const line: Line = {
    id: newId(),
    name: input.name,
    startFen: input.startFen,
    moves: [...input.moves],
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

export function updateLine(
  id: string,
  patch: Partial<Omit<Line, 'id' | 'createdAt'>>,
): Line | null {
  const file = loadFile();
  const index = file.lines.findIndex((l) => l.id === id);
  if (index === -1) return null;
  const current = file.lines[index] as Line;

  const updated: Line = {
    ...current,
    name: patch.name ?? current.name,
    startFen: patch.startFen ?? current.startFen,
    moves: patch.moves === undefined ? current.moves : [...patch.moves],
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
  saveFile(next);
  return updated;
}

export function deleteLine(id: string): boolean {
  const file = loadFile();
  const next = file.lines.filter((l) => l.id !== id);
  if (next.length === file.lines.length) return false;
  saveFile(next);
  return true;
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
 */
export function renameFolder(from: string, to: string): FolderOpResult {
  const invalid = folderRenameError(from, to);
  if (invalid !== null) return { ok: false, moved: 0, error: invalid };

  const file = loadFile();
  let moved = 0;
  const next = file.lines.map((line) => {
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

export function exportAll(): LinesFile {
  return {
    schemaVersion: LINES_SCHEMA_VERSION,
    exportedAt: Date.now(),
    lines: listLines(),
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

  const accepted: Line[] = [];
  const rejections: ImportRejection[] = [];

  for (let i = 0; i < payload.rawLines.length; i++) {
    const raw = payload.rawLines[i];
    const label = lineLabel(raw, i);

    const shape = validateLineShape(raw);
    if (!shape.valid) {
      rejections.push({ name: label, reason: shape.error ?? 'invalid line' });
      continue;
    }
    const line = toLine(raw);
    if (line === null) {
      rejections.push({ name: label, reason: 'invalid line' });
      continue;
    }

    const fen = validateFenRules(line.startFen);
    if (!fen.valid) {
      rejections.push({
        name: label,
        reason: `illegal start position: ${fen.error ?? 'invalid FEN'}`,
      });
      continue;
    }

    const replay = replaySan(line.startFen, line.moves);
    if (!replay.ok) {
      const ply = replay.failedAtPly ?? 0;
      const san = line.moves[ply] ?? '(missing)';
      rejections.push({
        name: label,
        reason: `illegal move "${san}" at ply ${ply} (move ${Math.floor(ply / 2) + 1}, ${
          ply % 2 === 0 ? 'first' : 'second'
        } side to move)`,
      });
      continue;
    }

    // Fresh id: an import never overwrites an existing line.
    accepted.push({ ...line, id: newId(), moves: replay.sans });
  }

  if (accepted.length === 0) {
    return { added: 0, skipped: rejections.length, rejections };
  }

  // Nothing has been written up to this point — all validation is done.
  const existing = loadFile().lines;
  const persisted = saveFile([...existing, ...accepted]);
  const result: ImportResult = {
    added: accepted.length,
    skipped: rejections.length,
    rejections,
  };
  if (!persisted) {
    result.error = warning ?? WRITE_FAILED;
  }
  return result;
}
