/**
 * A new line handed from one screen to the editor.
 *
 * Explore's "Save as new line" has a start position and a move list but no name, folder, colour
 * or notes — exactly the four things `LineEditor` already asks for and validates. Rather than
 * grow a second, poorer save form on the explore screen, the moves are staged here and the
 * editor opens on them.
 *
 * Why a module store and not the URL: a move list does not belong in a query string (it is
 * unbounded, and a truncated one would silently save a shorter line). The URL still carries the
 * *intent* — `#/training/new?from=explore` — so a plain "New line" can never pick up a draft
 * left behind by an earlier hand-off.
 *
 * Read with `peekStagedLine`, which is side-effect-free and therefore safe to call while
 * rendering (React's StrictMode runs initialisers twice). The editor clears it on the way out.
 */

import type { Color } from '../chess/game';

export interface StagedLine {
  /** Start position of the line, already normalised by `chess/history.ts`. */
  startFen: string;
  /** SAN moves, in order, from the side to move in `startFen`. */
  moves: string[];
  /** Folder to file it in; `''` for the root. */
  folder: string;
  /** Suggested trained-as colour. The editor shows it as a choice, not a decision. */
  userColor: Color;
}

let staged: StagedLine | null = null;

export function stageNewLine(line: StagedLine): void {
  staged = { ...line, moves: [...line.moves] };
}

/** The staged line, or `null`. Does not consume it — call `clearStagedLine` when done. */
export function peekStagedLine(): StagedLine | null {
  return staged;
}

export function clearStagedLine(): void {
  staged = null;
}
