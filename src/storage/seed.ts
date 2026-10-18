/**
 * Bundled ("server") lines: every `public/data/*.json` export, loaded on **every** startup and
 * kept apart from the user's own lines (see `lines.ts`).
 *
 * Because server lines are never copied into the user's store, there is nothing to reconcile:
 * a new build replaces them wholesale, and no user data can be lost or duplicated by it. What the
 * user does to a server line is recorded by `lines.ts` instead — an edit becomes a user line
 * with a fresh id, a delete hides the server id.
 *
 * Validation is not duplicated here: `validateImportLines` is the same path a hand-picked
 * import file goes through, so a bundled file cannot smuggle in an illegal FEN or an
 * unplayable move. Rejected lines are reported to the UI instead of being swallowed.
 */

import { setServerLines, validateImportLines, type ImportRejection } from './lines';
import { parseLinesFilePayload, type Line } from './schema';

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
}

/** Server lines need ids that are present and unique — they are how edits and deletes refer to them. */
function idProblem(line: Line, seen: Set<string>): string | null {
  if (line.id.trim().length === 0) return 'missing "id"';
  if (seen.has(line.id)) return `duplicate id "${line.id}"`;
  return null;
}

let lastReport: SeedReport | null = null;

/** What the last `loadServerLines` call made of the bundled files; null before it has run. */
export function seedReport(): SeedReport | null {
  return lastReport;
}

/**
 * Validates every bundled file and hands the accepted lines to `lines.ts` as the server lines,
 * replacing whatever was there. Writes nothing to storage.
 */
export function loadServerLines(files: SeedFile[]): SeedReport {
  const reports: SeedFileReport[] = [];
  const accepted: Line[] = [];
  const ids = new Set<string>();

  for (const file of files) {
    const payload = parseLinesFilePayload(file.payload);
    if (!payload.ok) {
      reports.push({ file: file.name, added: 0, skipped: 0, rejections: [], error: payload.error });
      continue;
    }

    const rejections: ImportRejection[] = [];
    let added = 0;
    for (const candidate of validateImportLines(payload.rawLines, payload.schemaVersion)) {
      const problem =
        candidate.line === null
          ? (candidate.reason ?? 'invalid line')
          : idProblem(candidate.line, ids);
      if (candidate.line === null || problem !== null) {
        rejections.push({ name: candidate.name, reason: problem ?? 'invalid line' });
        continue;
      }
      ids.add(candidate.line.id);
      accepted.push(candidate.line);
      added++;
    }
    reports.push({ file: file.name, added, skipped: rejections.length, rejections });
  }

  setServerLines(accepted);
  const report: SeedReport = { added: accepted.length, files: reports };
  lastReport = report;
  return report;
}
