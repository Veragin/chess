/**
 * Browser file download / upload plumbing for the export & import buttons.
 *
 * The interesting parts (filename, JSON shape, report wording) live in `lineFormat.ts`,
 * `storage/lines.ts` and `importReport.ts`; this module is only the two DOM gestures that
 * cannot be unit-tested, kept small and in one place.
 */

import type { LinesFile } from '../../../storage/schema';

/** Pretty-printed so an exported file is human-readable (and diffable). */
export function serialiseLinesFile(file: LinesFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** Triggers a download of `text` as `filename`. Returns false if the browser refused. */
export function downloadText(filename: string, text: string, mime = 'application/json'): boolean {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoking synchronously can race the download in some browsers; one tick is enough.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  } catch {
    return false;
  }
}
