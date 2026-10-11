/**
 * "Open in analyze" from a finished drill run.
 *
 * The same hand-off the lines list makes (`state/analysis.ts` first, navigation second), but
 * reached from a screen that is not allowed to *hold* the line: this reads storage inside the
 * click handler and puts the moves straight into the analysis store, so nothing about the line
 * ever enters drill's React state or its DOM (README §8.11, and see `useDrillRun`'s note on the
 * opaque handle).
 *
 * Returns `false` when the line has been deleted since the run started, so the caller can leave
 * the user where they are instead of navigating to an unrelated position.
 */

import { branchSpec } from '../../../chess/line';
import { loadPosition } from '../../../state/analysis';
import { getLine } from '../../../storage/lines';

/**
 * `branch` is the branch that was drilled (an index into `branchesOf(line.tree)`). If an edit
 * since then removed it, the main line is loaded instead — still the same line.
 */
export function loadLineIntoAnalysis(id: string, branch = 0): boolean {
  const stored = id.length === 0 ? null : getLine(id);
  if (stored === null) return false;
  const spec = branchSpec(stored, branch) ?? branchSpec(stored, 0);
  // Moves that no longer replay are dropped by `loadPosition`, which leaves the start position —
  // still the most useful place to land when the line needs fixing.
  loadPosition(stored.startFen, spec?.moves ?? []);
  return true;
}
