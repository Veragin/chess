/**
 * Turns `storage/lines.ts`'s `ImportResult` into something a human can read.
 *
 * README Phase 5 requires the import to report "added / skipped counts and rejection reasons",
 * and README §6 requires a corrupt file to leave existing data untouched — so the wording has
 * to distinguish "the whole file was refused" from "some lines were refused". Pure, so the
 * wording is unit-tested rather than eyeballed.
 */

import type { ImportResult } from '../../../storage/lines';
import type { ResetResult, ResetSummary } from '../../../storage/reset';
import type { SeedReport } from '../../../storage/seed';

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

/**
 * What "Clear data" did, in the same notice the import uses. The custom count is the part worth
 * repeating afterwards: the bundled lines are coming back on the next load, those were not.
 */
export function describeReset(summary: ResetSummary, result: ResetResult): ImportReportView {
  const details: string[] = [];
  if (summary.blindGame) details.push('The saved blind game was deleted.');
  details.push('The bundled lines are added again the next time the app loads.');

  if (!result.ok) {
    return {
      tone: 'error',
      headline: 'Browser storage could not be fully cleared.',
      details: result.error === undefined ? details : [result.error, ...details],
    };
  }

  const headline =
    summary.custom === 0
      ? `Cleared ${summary.total} stored line(s). Nothing of your own was lost.`
      : `Cleared ${summary.total} stored line(s), ${summary.custom} of them your own. ` +
        'That cannot be undone.';
  return { tone: summary.custom === 0 ? 'ok' : 'warn', headline, details };
}

/**
 * The startup seed of `public/data/*.json` (`storage/seed.ts`) reports only when something
 * went wrong: lines that *did* arrive are self-evident — they are in the list — while a file
 * that was silently refused would leave the user hunting for lines that never appear.
 * Returns null when there is nothing to say.
 */
export function describeSeed(report: SeedReport | null): ImportReportView | null {
  if (report === null) return null;

  const details: string[] = [];
  if (report.error !== undefined) details.push(report.error);
  for (const file of report.files) {
    if (file.error !== undefined) details.push(`${file.file} — ${file.error}`);
    for (const rejection of file.rejections) {
      details.push(`${file.file} — ${rejection.name} — ${rejection.reason}`);
    }
  }
  if (details.length === 0) return null;

  const added = Math.max(0, report.added);
  if (added > 0) {
    return {
      tone: 'warn',
      headline: `Added ${added} bundled line(s); the rest could not be loaded.`,
      details,
    };
  }
  return {
    tone: 'error',
    headline: 'Bundled lines could not be loaded — your saved lines were left untouched.',
    details,
  };
}
