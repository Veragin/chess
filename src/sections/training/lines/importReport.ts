/**
 * Turns `storage/lines.ts`'s `ImportResult` into something a human can read.
 *
 * README Phase 5 requires the import to report "added / skipped counts and rejection reasons",
 * and README §6 requires a corrupt file to leave existing data untouched — so the wording has
 * to distinguish "the whole file was refused" from "some lines were refused". Pure, so the
 * wording is unit-tested rather than eyeballed.
 */

import type { ImportResult } from '../../../storage/lines';

export type ReportTone = 'ok' | 'warn' | 'error';

export interface ImportReportView {
  tone: ReportTone;
  headline: string;
  /** One entry per rejected line (`name — reason`), plus a file-level error if there was one. */
  details: string[];
}

export function describeImport(result: ImportResult): ImportReportView {
  const details: string[] = result.rejections.map((r) => `${r.name} — ${r.reason}`);
  const added = Math.max(0, result.added);
  const skipped = Math.max(0, result.skipped);

  // A file-level error with nothing added means the envelope itself was unusable: bad JSON, an
  // unknown/future schemaVersion, no "lines" array. Nothing was written.
  if (result.error !== undefined && added === 0) {
    return {
      tone: 'error',
      headline: 'Import failed — your saved lines were left untouched.',
      details: [result.error, ...details],
    };
  }

  if (added === 0 && skipped === 0) {
    return {
      tone: 'warn',
      headline: 'That file contained no lines — nothing to import.',
      details,
    };
  }

  if (added === 0) {
    return {
      tone: 'error',
      headline: `Nothing imported: all ${skipped} line(s) in the file were rejected. Your saved lines were left untouched.`,
      details,
    };
  }

  const counts = `Imported ${added} line(s); skipped ${skipped}.`;
  if (result.error !== undefined) {
    // Lines were accepted but the write only reached the in-memory fallback (README §8.10).
    return { tone: 'warn', headline: counts, details: [result.error, ...details] };
  }
  return { tone: skipped > 0 ? 'warn' : 'ok', headline: counts, details };
}
