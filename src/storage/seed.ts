/**
 * Bundled starter lines: every `public/data/*.json` export is folded into the user's own
 * repertoire **once**, at startup, and is an ordinary line from then on.
 *
 * The rules that shape this module:
 *
 * 1. **Seed once, then hands off.** A seeded line is editable and deletable like any other,
 *    and a deleted one must not reappear on the next load. So the seeder keeps its own record
 *    of what it has already handed over — a set of `file::id` keys under a second
 *    `localStorage` key — rather than inferring it from what is currently stored.
 * 2. **New files and new lines still arrive.** Only keys in that record are skipped, so adding
 *    a file (or a line to an existing file) seeds just the new material on the next load.
 * 3. **A broken line is retried.** Rejections are *not* recorded as seeded: fix the file and
 *    the line arrives next time. This is the one thing a content-blind key cannot do on its
 *    own, and it is why rejections are reported to the UI instead of being swallowed.
 * 4. **Never write twice.** All files are validated first and added in a single write, and the
 *    seed record is only persisted if that write actually reached disk — otherwise a
 *    memory-only session would mark lines as delivered that no later session can see.
 *
 * Validation is not duplicated here: `validateImportLines` is the same path a hand-picked
 * import file goes through, so a bundled file cannot smuggle in an illegal FEN or an
 * unplayable move.
 */

import { addLines, listLines, validateImportLines, type ImportRejection } from './lines';
import { parseLinesFilePayload, type Line } from './schema';

/** Where the "already handed over" keys live. Separate from the repertoire itself. */
const SEED_KEY = 'chess-trainer.seededLines.v1';

/** One bundled file: its base name, and its already-parsed (or raw JSON) contents. */
export interface SeedFile {
  name: string;
  payload: unknown;
}

export interface SeedFileReport {
  file: string;
  added: number;
  skipped: number;
  rejections: ImportRejection[];
  /** File-level problem (bad JSON, unknown `schemaVersion`, no `lines` array). */
  error?: string;
}

export interface SeedReport {
  added: number;
  files: SeedFileReport[];
  /** Set when the lines were accepted but the write only reached memory. */
  error?: string;
}

// ---------------------------------------------------------------------------------------
// The seed record
// ---------------------------------------------------------------------------------------

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

/** Reads the keys handed over so far. Any unreadable record is treated as "nothing yet". */
function readSeenKeys(): string[] {
  const store = localStore();
  if (store === null) return [];
  let raw: string | null;
  try {
    raw = store.getItem(SEED_KEY);
  } catch {
    return [];
  }
  if (raw === null || raw.trim().length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((k): k is string => typeof k === 'string');
  } catch {
    return [];
  }
}

/** Best-effort: a record we cannot persist only risks re-offering lines, never losing any. */
function writeSeenKeys(keys: string[]): void {
  const store = localStore();
  if (store === null) return;
  try {
    store.setItem(SEED_KEY, JSON.stringify(keys));
  } catch {
    // Quota or revoked storage. The next load simply re-offers the same lines, and the
    // signature guard below stops them from arriving twice.
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Identity of one seeded line: the file it came from plus the `id` written in that file.
 * Files without ids (hand-written ones) fall back to the position in the list, which is
 * stable as long as lines are appended rather than reordered.
 */
function seedKey(file: string, raw: unknown, index: number): string {
  if (isPlainObject(raw) && typeof raw.id === 'string' && raw.id.trim().length > 0) {
    return `${file}::${raw.id}`;
  }
  return `${file}::#${index}`;
}

/**
 * A safety net independent of the seed record: two lines with the same name, folder, colour,
 * start position and moves are the same line. It keeps a lost or cleared record from adding
 * a second copy of everything.
 */
function lineSignature(line: Line): string {
  return [
    line.folder ?? '',
    line.name.trim(),
    line.userColor,
    line.startFen,
    line.moves.join(' '),
  ].join('|');
}

// ---------------------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------------------

let lastReport: SeedReport | null = null;

/** What the last `seedFromFiles` call made of the bundled files; null before it has run. */
export function seedReport(): SeedReport | null {
  return lastReport;
}

/**
 * Adds every not-yet-seeded line from `files` to the repertoire. Idempotent: running it
 * again adds nothing, and a line the user has since deleted stays deleted.
 */
export function seedFromFiles(files: SeedFile[]): SeedReport {
  const known = new Set(readSeenKeys());
  const seenBefore = known.size;
  const signatures = new Set(listLines().map(lineSignature));

  const reports: SeedFileReport[] = [];
  const pending: Line[] = [];

  for (const file of files) {
    const payload = parseLinesFilePayload(file.payload);
    if (!payload.ok) {
      reports.push({ file: file.name, added: 0, skipped: 0, rejections: [], error: payload.error });
      continue;
    }

    const rejections: ImportRejection[] = [];
    let added = 0;

    for (const candidate of validateImportLines(payload.rawLines)) {
      const raw = payload.rawLines[candidate.index];
      const key = seedKey(file.name, raw, candidate.index);
      if (known.has(key)) continue; // handed over on an earlier visit

      if (candidate.line === null) {
        // Deliberately not marked as seen: a fixed file gets another chance.
        rejections.push({ name: candidate.name, reason: candidate.reason ?? 'invalid line' });
        continue;
      }

      known.add(key);
      const signature = lineSignature(candidate.line);
      if (signatures.has(signature)) continue; // identical line already in the store
      signatures.add(signature);
      pending.push(candidate.line);
      added++;
    }

    reports.push({ file: file.name, added, skipped: rejections.length, rejections });
  }

  const write = addLines(pending);
  const report: SeedReport = { added: write.added, files: reports };
  if (write.error !== undefined) {
    report.error = write.error;
  } else if (known.size !== seenBefore) {
    // Only once the lines are really on disk: a record written after a memory-only write
    // would tell the next session these lines had already been delivered.
    writeSeenKeys([...known]);
  }

  lastReport = report;
  return report;
}
