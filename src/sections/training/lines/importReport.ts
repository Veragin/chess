/**
 * Turns `storage/lines.ts`'s `ImportResult` into something a human can read.
 *
 * README Phase 5 requires the import to report "added / skipped counts and rejection reasons",
 * and README §6 requires a corrupt file to leave existing data untouched — so the wording has
 * to distinguish "the whole file was refused" from "some lines were refused". Pure, so the
 * wording is unit-tested rather than eyeballed.
 */

import type { ImportResult } from '../../../storage/lines';
import type { RefreshOptions, RefreshResult, ResetSummary } from '../../../storage/reset';
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

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * What "Refresh data" did, in the same notice the import uses. The headline repeats what became
 * of the user's own lines and of their Personal list — the two things the dialog asked about.
 */
export function describeRefresh(
  summary: ResetSummary,
  options: Pick<RefreshOptions, 'mode' | 'clearPersonal'>,
  result: RefreshResult,
): ImportReportView {
  const deleted = options.mode === 'delete-user-lines';
  const details: string[] = [];
  if (summary.hidden > 0) {
    details.push(
      `${count(summary.hidden, 'bundled line')} you had deleted or edited ${summary.hidden === 1 ? 'is' : 'are'} back.`,
    );
    if (!deleted && summary.custom > 0) {
      details.push('Edited copies of bundled lines are kept alongside the originals.');
    }
  }

  if (!result.ok) {
    return {
      tone: 'error',
      headline: 'Bundled lines refreshed, but browser storage could not be fully updated.',
      details: result.error === undefined ? details : [result.error, ...details],
    };
  }

  const parts = ['Bundled lines refreshed.'];
  if (summary.custom > 0) {
    parts.push(
      deleted
        ? `Deleted ${count(summary.custom, 'line')} of your own. That cannot be undone.`
        : `${summary.custom} of your lines kept.`,
    );
  }
  if (result.personalCleared) {
    if (summary.personal > 0) {
      parts.push(`Your Personal list (${count(summary.personal, 'line')}) was cleared.`);
    }
  } else if (result.personalRemoved > 0) {
    const n = result.personalRemoved;
    parts.push(
      `${count(n, 'personal line')} no longer exist${n === 1 ? 's' : ''} and ${n === 1 ? 'was' : 'were'} removed.`,
    );
  }

  const lost =
    (deleted && summary.custom > 0) || (result.personalCleared && summary.personal > 0);
  return { tone: lost ? 'warn' : 'ok', headline: parts.join(' '), details };
}

/**
 * The startup load of `public/data/*.json` (`storage/seed.ts`) reports only when something
 * went wrong: lines that *did* arrive are self-evident — they are in the list — while a file
 * that was silently refused would leave the user hunting for lines that never appear.
 * Returns null when there is nothing to say.
 */
export function describeSeed(report: SeedReport | null): ImportReportView | null {
  if (report === null) return null;

  const details: string[] = [];
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
      headline: `Loaded ${added} bundled line(s); the rest could not be loaded.`,
      details,
    };
  }
  return {
    tone: 'error',
    headline: 'Bundled lines could not be loaded — your own lines were left untouched.',
    details,
  };
}

const TONE_RANK: Record<ReportTone, number> = { ok: 0, warn: 1, error: 2 };

/**
 * One notice for two reports — "Refresh data" says what it did, and the bundled reload it ran
 * may have problems of its own (`describeSeed`). The first headline leads; the second becomes the
 * first of its details, and the tone is the worse of the two.
 */
export function combineReports(
  first: ImportReportView,
  second: ImportReportView | null,
): ImportReportView {
  if (second === null) return first;
  return {
    tone: TONE_RANK[second.tone] > TONE_RANK[first.tone] ? second.tone : first.tone,
    headline: first.headline,
    details: [...first.details, second.headline, ...second.details],
  };
}
