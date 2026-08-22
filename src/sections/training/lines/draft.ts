/**
 * The line-editor's draft model and its validation (README §7 Phase 5).
 *
 * Everything here is pure and DOM-free so `LineEditor.tsx` stays wiring only (README §9).
 * The move list is a `HistoryState` from `chess/history.ts` rather than a bare `string[]`,
 * which is what gives the editor undo/redo, mid-history truncation and cursor navigation for
 * free — none of that is reimplemented here.
 *
 * Undo/redo semantics, stated once so the component does not have to decide:
 *   - "undo"  = move the cursor back one ply (`stepBack`), the move is NOT deleted;
 *   - "redo"  = move the cursor forward one ply (`stepForward`);
 *   - playing a *different* move while the cursor is behind the end truncates the future
 *     (`applyMove`'s documented behaviour);
 *   - **the saved line is the moves up to the cursor.** Anything after it has been undone, so
 *     it is not part of the line. `pendingRedoCount` lets the UI say so out loud.
 */

import { replaySan, validateFenRules, type Color } from '../../../chess/game';
import { createHistory, sansOf, type HistoryState } from '../../../chess/history';
import { START_FEN } from '../../../chess/position';
import { normaliseFolderPath, type Line } from '../../../storage/schema';

export interface LineDraft {
  name: string;
  userColor: Color;
  /**
   * `/`-separated folder path, exactly as typed. Normalised on save and when comparing for
   * dirtiness, never while the user is mid-keystroke — trimming under the caret would fight
   * whoever is typing `Black / Sicilian`.
   */
  folder: string;
  /** Always a string in the draft; written as `undefined` when blank. */
  notes: string;
  history: HistoryState;
}

/** A brand-new line: standard start position, White, nothing played, at the root. */
export function emptyDraft(folder = ''): LineDraft {
  return {
    name: '',
    userColor: 'w',
    folder: normaliseFolderPath(folder),
    notes: '',
    history: createHistory(START_FEN),
  };
}

/** SAN moves that would be saved: everything up to and including the cursor. */
export function draftMoves(history: HistoryState): string[] {
  const all = sansOf(history);
  const cursor = history.cursor < -1 ? -1 : Math.min(history.cursor, all.length - 1);
  return all.slice(0, cursor + 1);
}

/** How many moves sit after the cursor, i.e. have been undone and will not be saved. */
export function pendingRedoCount(history: HistoryState): number {
  return Math.max(0, sansOf(history).length - draftMoves(history).length);
}

export interface RebaseResult {
  history: HistoryState;
  /** Moves that could not be replayed from the new start position and were dropped. */
  dropped: number;
}

/**
 * Rebuilds a history on a (possibly different) start position, keeping the longest legal
 * prefix of `sans`. Used when the user edits the starting position with moves already entered,
 * and when opening a stored line whose moves no longer replay — the editor must open and
 * explain, never throw.
 */
export function rebaseHistory(startFen: string, sans: string[]): RebaseResult {
  const base = createHistory(startFen);
  if (sans.length === 0) return { history: base, dropped: 0 };

  const replay = replaySan(base.startFen, sans);
  const kept = replay.sans.length;
  const entries = replay.sans.map((san, i) => ({
    san,
    fenAfter: replay.fens[i] ?? base.startFen,
  }));
  return {
    history: { startFen: base.startFen, entries, cursor: entries.length - 1 },
    dropped: sans.length - kept,
  };
}

/** Loads a stored line into a draft. Illegal trailing moves are dropped, never thrown. */
export function draftFromLine(line: Line): { draft: LineDraft; dropped: number } {
  const rebased = rebaseHistory(line.startFen, line.moves);
  return {
    draft: {
      name: line.name,
      userColor: line.userColor,
      folder: normaliseFolderPath(line.folder),
      notes: line.notes ?? '',
      history: rebased.history,
    },
    dropped: rebased.dropped,
  };
}

export interface DraftValidation {
  ok: boolean;
  /** Why the draft cannot be saved. Present exactly when `ok` is false. */
  error?: string;
  /** SAN as normalised by chess.js — what should actually be written. */
  moves: string[];
}

/**
 * Save-time validation. Refuses an empty name and an empty move list with a clear reason, and
 * re-checks that **every** move is legal from `startFen` (README Phase 5) rather than trusting
 * the history the UI accumulated.
 */
export function validateDraft(draft: LineDraft): DraftValidation {
  const moves = draftMoves(draft.history);

  if (draft.name.trim().length === 0) {
    return { ok: false, error: 'Give the line a name before saving.', moves };
  }

  const fen = validateFenRules(draft.history.startFen);
  if (!fen.valid) {
    return {
      ok: false,
      error: `The starting position is not legal: ${fen.error ?? 'invalid FEN'}.`,
      moves,
    };
  }

  if (moves.length === 0) {
    return {
      ok: false,
      error: 'A line needs at least one move — play it on the board below.',
      moves,
    };
  }

  const replay = replaySan(draft.history.startFen, moves);
  if (!replay.ok) {
    const ply = replay.failedAtPly ?? 0;
    const san = moves[ply] ?? '(missing)';
    return {
      ok: false,
      error: `Move ${ply + 1} ("${san}") is not legal from the starting position.`,
      moves,
    };
  }

  return { ok: true, moves: replay.sans };
}

/** The payload for `createLine` / `updateLine`. Call only after `validateDraft` succeeds. */
export function toLineInput(draft: LineDraft): Omit<Line, 'id' | 'createdAt' | 'updatedAt'> {
  const notes = draft.notes.trim();
  const input: Omit<Line, 'id' | 'createdAt' | 'updatedAt'> = {
    name: draft.name.trim(),
    startFen: draft.history.startFen,
    moves: draftMoves(draft.history),
    userColor: draft.userColor,
    // Always present, including as `''`: on an update this is what moves a line back to the
    // root, and `updateLine` reads a missing key as "leave the folder alone".
    folder: normaliseFolderPath(draft.folder),
  };
  if (notes.length > 0) input.notes = notes;
  return input;
}

/**
 * Has anything the user would lose changed? Compares only what gets persisted, so pure cursor
 * navigation (undo then redo back to where it was) is correctly *not* a change.
 */
export function isDirty(draft: LineDraft, baseline: LineDraft): boolean {
  if (draft.name !== baseline.name) return true;
  if (draft.userColor !== baseline.userColor) return true;
  if (normaliseFolderPath(draft.folder) !== normaliseFolderPath(baseline.folder)) return true;
  if (draft.notes.trim() !== baseline.notes.trim()) return true;
  if (draft.history.startFen !== baseline.history.startFen) return true;
  const a = draftMoves(draft.history);
  const b = draftMoves(baseline.history);
  if (a.length !== b.length) return true;
  return a.some((san, i) => san !== b[i]);
}
