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
 * This module is pure — no `localStorage`, no `chess.js` — so it stays trivially testable.
 */

export const LINES_SCHEMA_VERSION = 1;

/** A linear repertoire line: one starting position, one ordered move sequence. */
export interface Line {
  id: string; // crypto.randomUUID()
  name: string;
  startFen: string; // valid FEN; standard start position by default
  /** SAN moves in order, alternating sides, starting from the side to move in startFen. */
  moves: string[];
  /** Side the user trains as. Determines who moves in drill vs who is auto-played. */
  userColor: 'w' | 'b';
  notes?: string;
  createdAt: number; // epoch ms
  updatedAt: number;
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
 * Validates one candidate `Line` object field by field. Shared by `migrate` (to drop junk
 * out of the store) and by `importFile` (to explain why a line was rejected).
 */
export function validateLineShape(raw: unknown): LineShapeResult {
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
  if (!Array.isArray(raw.moves)) {
    return { valid: false, error: '"moves" must be an array of SAN strings' };
  }
  for (let i = 0; i < raw.moves.length; i++) {
    const mv: unknown = raw.moves[i];
    if (typeof mv !== 'string' || mv.trim().length === 0) {
      return { valid: false, error: `"moves[${i}]" is not a SAN string` };
    }
  }
  if (raw.userColor !== 'w' && raw.userColor !== 'b') {
    return { valid: false, error: '"userColor" must be "w" or "b"' };
  }
  if (raw.notes !== undefined && typeof raw.notes !== 'string') {
    return { valid: false, error: '"notes" must be a string when present' };
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
 * Copies a *validated* candidate into a fresh `Line`, keeping only schema fields.
 * Call `validateLineShape` first; returns null if the shape does not hold.
 */
export function toLine(raw: unknown): Line | null {
  if (!validateLineShape(raw).valid || !isPlainObject(raw)) return null;
  const line: Line = {
    id: raw.id as string,
    name: raw.name as string,
    startFen: (raw.startFen as string).trim(),
    moves: (raw.moves as string[]).map((m) => m.trim()),
    userColor: raw.userColor as 'w' | 'b',
    createdAt: raw.createdAt as number,
    updatedAt: raw.updatedAt as number,
  };
  if (typeof raw.notes === 'string') {
    line.notes = raw.notes;
  }
  return line;
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
  if (version < 1) {
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
    const shape = validateLineShape(candidate);
    const line = shape.valid ? toLine(candidate) : null;
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
