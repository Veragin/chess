/**
 * The line-editor's draft model and its validation (README §7 Phase 5).
 *
 * Everything here is pure and DOM-free so `LineEditor.tsx` stays wiring only (README §9).
 * The moves are a `TreeHistoryState` from `chess/treeHistory.ts` — a move tree with a cursor —
 * so the editor gets branching, cursor navigation and per-move comments without reimplementing
 * any of it here.
 *
 * Editing semantics, stated once so the component does not have to decide:
 *   - playing a move at the cursor follows an existing continuation, or adds a new branch from
 *     there — nothing is ever truncated;
 *   - "New branch" moves the cursor to the parent move, it does NOT delete anything;
 *   - **the saved line is the whole tree**, wherever the cursor happens to be. Removing moves is
 *     an explicit action ("Delete from here").
 */

import { validateFenRules, type Color } from '../../../chess/game';
import { sansOf, type HistoryState } from '../../../chess/history';
import { START_FEN } from '../../../chess/position';
import {
  branchIndexOf,
  cloneTree,
  countBranches,
  dedupeSiblings,
  replayTree,
  treeFromMoves,
  type MoveTree,
} from '../../../chess/tree';
import {
  createTreeHistory,
  endOfLine,
  normaliseComments,
  treeContentKey,
  type TreeHistoryState,
} from '../../../chess/treeHistory';
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
  /** The move tree, its start position and the cursor. Comments are held as typed. */
  history: TreeHistoryState;
}

/** A brand-new line: standard start position, White, nothing played, at the root. */
export function emptyDraft(folder = ''): LineDraft {
  return {
    name: '',
    userColor: 'w',
    folder: normaliseFolderPath(folder),
    notes: '',
    history: createTreeHistory(START_FEN),
  };
}

/**
 * SAN moves up to the cursor of a *linear* history (`chess/history.ts`). Not used by the editor
 * any more — Analyze and Explore use it for their "Save as new line" hand-off, which stages a
 * linear move list (`state/newLine.ts`).
 */
export function draftMoves(history: HistoryState): string[] {
  const all = sansOf(history);
  const cursor = history.cursor < -1 ? -1 : Math.min(history.cursor, all.length - 1);
  return all.slice(0, cursor + 1);
}

export interface LoadedTree {
  /** The playable part of the tree, SANs normalised, cursor at the end of the main line. */
  history: TreeHistoryState;
  /** Moves that could not be replayed from the start position and were dropped. */
  dropped: number;
}

/**
 * Builds the editor's tree state from a stored (or handed-over) tree. Unplayable moves are cut
 * with their subtrees and counted, never thrown — the editor must open and explain. Siblings
 * that only became equal through SAN normalisation are merged.
 */
export function loadTree(startFen: string, tree: MoveTree): LoadedTree {
  const base = createTreeHistory(startFen);
  const replay = replayTree(base.startFen, tree);
  const kept = dedupeSiblings(replay.tree);
  return {
    history: { ...base, tree: kept, cursor: endOfLine(kept, []) },
    dropped: replay.dropped,
  };
}

/** Loads a linear move list (Explore / Analyze hand-off) as a single-branch tree. */
export function loadMoves(startFen: string, sans: string[]): LoadedTree {
  return loadTree(startFen, treeFromMoves(sans));
}

/** Loads a stored line into a draft, every branch and comment included. */
export function draftFromLine(line: Line): { draft: LineDraft; dropped: number } {
  const loaded = loadTree(line.startFen, line.tree);
  return {
    draft: {
      name: line.name,
      userColor: line.userColor,
      folder: normaliseFolderPath(line.folder),
      notes: line.notes ?? '',
      history: loaded.history,
    },
    dropped: loaded.dropped,
  };
}

export interface DraftValidation {
  ok: boolean;
  /** Why the draft cannot be saved. Present exactly when `ok` is false. */
  error?: string;
  /**
   * What should actually be written: SANs normalised by chess.js, duplicate siblings merged,
   * comments trimmed. When `ok` is false, the draft's tree with comments trimmed.
   */
  tree: MoveTree;
}

/**
 * Save-time validation. Refuses an empty name and an empty tree with a clear reason, and
 * re-checks that **every** move of every branch is legal from `startFen` (README Phase 5) rather
 * than trusting the tree the UI accumulated.
 */
export function validateDraft(draft: LineDraft): DraftValidation {
  const tree = normaliseComments(draft.history.tree);

  if (draft.name.trim().length === 0) {
    return { ok: false, error: 'Give the line a name before saving.', tree };
  }

  const fen = validateFenRules(draft.history.startFen);
  if (!fen.valid) {
    return {
      ok: false,
      error: `The starting position is not legal: ${fen.error ?? 'invalid FEN'}.`,
      tree,
    };
  }

  if (tree.length === 0) {
    return {
      ok: false,
      error: 'A line needs at least one move — play it on the board below.',
      tree,
    };
  }

  const replay = replayTree(draft.history.startFen, tree);
  if (replay.broken !== null) {
    const { path, san } = replay.broken;
    const branch =
      countBranches(tree) > 1 ? ` in branch ${branchIndexOf(tree, path) + 1}` : '';
    return {
      ok: false,
      error: `Move ${path.length} ("${san}")${branch} is not legal from the starting position.`,
      tree,
    };
  }

  return { ok: true, tree: dedupeSiblings(replay.tree) };
}

/**
 * The payload for `createLine` / `updateLine`. Call only after `validateDraft` succeeds, and pass
 * its `tree` so the normalised moves are what gets stored; without it the draft's tree is used
 * with comments trimmed. The tree is a deep copy — storage never shares structure with state.
 */
export function toLineInput(
  draft: LineDraft,
  tree: MoveTree = normaliseComments(draft.history.tree),
): Omit<Line, 'id' | 'createdAt' | 'updatedAt'> {
  const notes = draft.notes.trim();
  const input: Omit<Line, 'id' | 'createdAt' | 'updatedAt'> = {
    name: draft.name.trim(),
    startFen: draft.history.startFen,
    tree: cloneTree(tree),
    userColor: draft.userColor,
    // Always present, including as `''`: on an update this is what moves a line back to the
    // root, and `updateLine` reads a missing key as "leave the folder alone".
    folder: normaliseFolderPath(draft.folder),
  };
  if (notes.length > 0) input.notes = notes;
  return input;
}

/**
 * Has anything the user would lose changed? Compares only what gets persisted — moves, sibling
 * order (the main line), trimmed comments — so cursor navigation is correctly *not* a change.
 */
export function isDirty(draft: LineDraft, baseline: LineDraft): boolean {
  if (draft.name !== baseline.name) return true;
  if (draft.userColor !== baseline.userColor) return true;
  if (normaliseFolderPath(draft.folder) !== normaliseFolderPath(baseline.folder)) return true;
  if (draft.notes.trim() !== baseline.notes.trim()) return true;
  if (draft.history.startFen !== baseline.history.startFen) return true;
  if (draft.history.tree === baseline.history.tree) return false;
  return treeContentKey(draft.history.tree) !== treeContentKey(baseline.history.tree);
}
