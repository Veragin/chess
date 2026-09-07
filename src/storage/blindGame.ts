/**
 * The single blind-game resume record (README §5 "plus one blind-game resume record",
 * §7 Phase 8 "Persist the game on every move; offer resume on load").
 *
 * Separate `localStorage` key from the repertoire lines, and deliberately *not* part of
 * `LinesFile`: a half-finished blind game is session scratch, not repertoire data, and it must
 * never end up in an export.
 *
 * Same two disciplines as `storage/lines.ts`:
 *
 * 1. **`localStorage` throws** — private mode, blocked cookies, quota (README §8.10). Every
 *    access is wrapped and the module degrades to an in-memory copy for the rest of the
 *    session, surfacing `blindStorageWarning()`. Nothing ever throws into the UI.
 * 2. **Reading never writes.** A record that fails validation is reported as "no resume
 *    available" and left untouched on disk — silently repairing or deleting it as a side
 *    effect of a read would destroy a game the user may still be able to finish.
 *
 * A loaded record is validated all the way to chess legality (FEN rules + every SAN
 * replayable) before it is offered, so a corrupt payload can never reach the board.
 *
 * `localStorage` is looked up lazily inside each accessor (never captured at import time) so
 * the module works in a DOM-less environment and can be tested with a stub.
 */

import { replaySan, validateFenRules } from '../chess/game';

/** Bumped only if the persisted shape changes incompatibly; older payloads are then ignored. */
export const BLIND_GAME_VERSION = 1;

/** Everything needed to resume a blind game exactly where it was left. */
export interface BlindGameRecord {
  /** Position the game started from. Valid FEN, legal by `validateFenRules`. */
  startFen: string;
  /** SAN moves in order from `startFen`, as normalised by chess.js. */
  moves: string[];
  /** Whether the pieces were revealed when the game was last persisted. */
  revealed: boolean;
  /** Epoch ms of the last write, for the "saved N minutes ago" style copy. */
  updatedAt: number;
}

const STORAGE_KEY = 'chess-trainer.blindGame.v1';

const UNAVAILABLE =
  'Browser storage is unavailable (private browsing or blocked cookies). This game is kept ' +
  'in memory only and will be lost if the tab closes.';
const WRITE_FAILED =
  'Browser storage rejected the write (it may be full). This game is kept in memory only and ' +
  'will be lost if the tab closes.';

// ---------------------------------------------------------------------------------------
// Storage access, with in-memory degradation
// ---------------------------------------------------------------------------------------

/**
 * Session-scoped fallback. Once `usingMemory` is set it takes precedence over `localStorage`,
 * because the on-disk copy is by then known to be unreachable or stale (a write failed).
 */
let memoryValue: string | null = null;
let usingMemory = false;
let warning: string | null = null;

/** Returns the real `localStorage`, or null if merely touching it throws. */
function localStore(): Storage | null {
  try {
    const store = (globalThis as { localStorage?: Storage | null }).localStorage;
    if (
      !store ||
      typeof store.getItem !== 'function' ||
      typeof store.setItem !== 'function' ||
      typeof store.removeItem !== 'function'
    ) {
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

/** Removes the record. Returns false when only the in-memory copy could be cleared. */
function removeRaw(): boolean {
  memoryValue = null;
  if (usingMemory) return false;
  const store = localStore();
  if (store === null) {
    degrade(UNAVAILABLE, null);
    return false;
  }
  try {
    store.removeItem(STORAGE_KEY);
    return true;
  } catch {
    degrade(UNAVAILABLE, null);
    return false;
  }
}

/**
 * Warning to surface in the UI: storage unavailable, a write that only reached memory, or a
 * stored record that could not be read. `null` when everything is healthy.
 */
export function blindStorageWarning(): string | null {
  return warning;
}

// ---------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === 'string');
}

/**
 * Turns an unknown payload into a record, or explains why it cannot be one. Never throws.
 *
 * Exported so the UI can validate an in-memory candidate (and so the check is unit-testable
 * without touching storage at all).
 */
export function parseBlindGameRecord(
  raw: unknown,
): { ok: true; record: BlindGameRecord } | { ok: false; error: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'not an object' };
  }
  const obj = raw as Record<string, unknown>;

  if (obj.version !== BLIND_GAME_VERSION) {
    return { ok: false, error: `unsupported version ${String(obj.version)}` };
  }
  if (typeof obj.startFen !== 'string' || obj.startFen.trim().length === 0) {
    return { ok: false, error: 'missing startFen' };
  }
  if (!isStringArray(obj.moves)) {
    return { ok: false, error: 'moves must be an array of SAN strings' };
  }
  if (obj.revealed !== undefined && typeof obj.revealed !== 'boolean') {
    return { ok: false, error: 'revealed must be a boolean' };
  }

  const fen = validateFenRules(obj.startFen);
  if (!fen.valid) {
    return { ok: false, error: `illegal start position: ${fen.error ?? 'invalid FEN'}` };
  }

  // The whole point of the record is to restore a position, so every move must replay.
  const replay = replaySan(obj.startFen, obj.moves);
  if (!replay.ok) {
    const ply = replay.failedAtPly ?? 0;
    return { ok: false, error: `illegal move "${obj.moves[ply] ?? '(missing)'}" at ply ${ply}` };
  }

  const updatedAt =
    typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt) ? obj.updatedAt : 0;

  return {
    ok: true,
    record: {
      startFen: obj.startFen.trim(),
      // chess.js's own normalisation, so what is offered matches what will be replayed.
      moves: replay.sans,
      revealed: obj.revealed === true,
      updatedAt,
    },
  };
}

// ---------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------

/**
 * Persists the record. Called on **every move** (README §2.3) so backgrounding, returning, or
 * an outright reload resumes the exact position.
 *
 * Returns false when the write only reached the in-memory fallback — check
 * `blindStorageWarning()` for the reason. An invalid record is refused rather than written,
 * so a bad save can never turn into a crash on the next load.
 */
export function saveBlindGame(rec: BlindGameRecord): boolean {
  const payload = {
    version: BLIND_GAME_VERSION,
    startFen: rec.startFen,
    moves: rec.moves,
    revealed: rec.revealed,
    updatedAt:
      typeof rec.updatedAt === 'number' && Number.isFinite(rec.updatedAt)
        ? rec.updatedAt
        : Date.now(),
  };

  const parsed = parseBlindGameRecord(payload);
  if (!parsed.ok) {
    warning = `This game could not be saved: ${parsed.error}`;
    return false;
  }

  let json: string;
  try {
    json = JSON.stringify(payload);
  } catch {
    warning = 'This game could not be serialised for storage.';
    return false;
  }

  const persisted = writeRaw(json);
  if (persisted && !usingMemory) warning = null;
  return persisted;
}

/**
 * The saved game, or `null` when there is nothing resumable — including when the stored
 * payload is corrupt. A corrupt record sets `blindStorageWarning()` and is left on disk.
 */
export function loadBlindGame(): BlindGameRecord | null {
  const raw = readRaw();
  if (raw === null) {
    if (!usingMemory) warning = null;
    return null;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    warning = 'The saved blind game could not be read (corrupt data). No resume available.';
    return null;
  }

  const parsed = parseBlindGameRecord(parsedJson);
  if (!parsed.ok) {
    warning = `The saved blind game could not be read: ${parsed.error}. No resume available.`;
    return null;
  }

  if (!usingMemory) warning = null;
  return parsed.record;
}

/**
 * Whether anything is stored under this key — including a payload too corrupt to resume from.
 * Deliberately not `loadBlindGame() !== null`: "clear data" has to mention a record it is about
 * to delete even when that record can no longer be played, and asking must not raise the
 * "could not be read" warning about a game the user never tried to resume.
 */
export function hasStoredBlindGame(): boolean {
  return readRaw() !== null;
}

/** Forgets the saved game. Returns false when only the in-memory copy could be cleared. */
export function clearBlindGame(): boolean {
  const cleared = removeRaw();
  if (cleared && !usingMemory) warning = null;
  return cleared;
}
