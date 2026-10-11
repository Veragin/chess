/**
 * A move *tree* with a cursor — the line editor's counterpart of `history.ts`.
 *
 * `history.ts` is linear: playing a different move behind the end truncates the future. The
 * editor edits repertoire lines that branch (`tree.ts`), so here playing a move never deletes
 * anything — an existing continuation is simply followed, a new one becomes a new branch from
 * the cursor. Analyze and Explore keep using `history.ts`.
 *
 * State: `{ startFen, tree, cursor }`, where `cursor` is a `NodePath` (`[]` = the start
 * position). Every function is pure and total: an illegal move is refused with `null`, a cursor
 * that does not address a node is clamped to the longest prefix that does, and nothing throws.
 *
 * Comments: `setCommentAt` stores the text *as typed* (only an empty string removes the field),
 * because trimming on every keystroke would eat the space the user just typed between two words.
 * `normaliseComments` does the trimming once, at save time.
 */

import { createGame, type Color, type Game, type MoveInput } from './game';
import { plyColor, plyMoveNumber } from './history';
import type { Square } from './position';
import {
  addMove,
  childrenAt,
  countMoves,
  deleteSubtree,
  nodeAt,
  pathSans,
  promoteVariation,
  pruneIllegal,
  type MoveNode,
  type MoveTree,
  type NodePath,
} from './tree';

export interface TreeHistoryState {
  startFen: string;
  tree: MoveTree;
  /** The node the board shows; `[]` = the start position. */
  cursor: NodePath;
}

/**
 * A state on `startFen` (normalised through chess.js when it parses, kept verbatim otherwise —
 * every move is then simply refused), holding `tree` as given, cursor at the start.
 */
export function createTreeHistory(startFen: string, tree: MoveTree = []): TreeHistoryState {
  const raw = typeof startFen === 'string' ? startFen.trim() : '';
  let normalised = raw;
  try {
    normalised = createGame(raw).fen();
  } catch {
    /* keep the raw string */
  }
  return { startFen: normalised, tree, cursor: [] };
}

/** The longest prefix of `path` that addresses a node of `tree` (possibly `[]`). */
export function clampPath(tree: MoveTree, path: NodePath): NodePath {
  const out: NodePath = [];
  let children = tree;
  for (const step of path) {
    const node = children[step];
    if (node === undefined) break;
    out.push(step);
    children = node.next;
  }
  return out;
}

function cursorOf(h: TreeHistoryState): NodePath {
  return clampPath(h.tree, h.cursor);
}

/** Replays the moves leading to `path` on a fresh game, or `null` if that is impossible. */
function gameAt(h: TreeHistoryState, path: NodePath): Game | null {
  let game: Game;
  try {
    game = createGame(h.startFen);
  } catch {
    return null;
  }
  for (const san of pathSans(h.tree, path)) {
    if (game.move(san) === null) return null;
  }
  return game;
}

/**
 * FEN of the position at `path` (default: the cursor). Falls back to the start FEN when the
 * moves cannot be replayed — the editor only ever holds replayable trees, so that is a
 * last-resort answer rather than an expected one.
 */
export function fenAt(h: TreeHistoryState, path: NodePath = h.cursor): string {
  return gameAt(h, clampPath(h.tree, path))?.fen() ?? h.startFen;
}

/** From/to squares of the move at the cursor, for the board's `lastMove`; `null` at the start. */
export function lastMoveAt(h: TreeHistoryState): { from: Square; to: Square } | null {
  const cursor = cursorOf(h);
  if (cursor.length === 0) return null;
  const before = gameAt(h, cursor.slice(0, -1));
  const node = nodeAt(h.tree, cursor);
  if (before === null || node === null) return null;
  const applied = before.move(node.san);
  return applied === null ? null : { from: applied.from, to: applied.to };
}

/**
 * Plays `m` from the cursor. An existing continuation with the same (normalised) SAN is followed;
 * otherwise the move is added as a new child — a new branch when the cursor already has
 * continuations. Returns `null` (state untouched) when the move is illegal.
 */
export function applyMoveAt(h: TreeHistoryState, m: string | MoveInput): TreeHistoryState | null {
  const cursor = cursorOf(h);
  const game = gameAt(h, cursor);
  if (game === null) return null;
  const applied = game.move(m);
  if (applied === null) return null;
  const added = addMove(h.tree, cursor, applied.san);
  return { startFen: h.startFen, tree: added.tree, cursor: added.path };
}

/** Moves the cursor to `path` (clamped to the part of it that exists). */
export function jumpTo(h: TreeHistoryState, path: NodePath): TreeHistoryState {
  return { ...h, cursor: clampPath(h.tree, path) };
}

/** To the parent move (the start position stays put). */
export function stepBack(h: TreeHistoryState): TreeHistoryState {
  return { ...h, cursor: cursorOf(h).slice(0, -1) };
}

/** To the first (main-line) continuation; no-op at a leaf. */
export function stepForward(h: TreeHistoryState): TreeHistoryState {
  const cursor = cursorOf(h);
  if (childrenAt(h.tree, cursor).length === 0) return { ...h, cursor };
  return { ...h, cursor: [...cursor, 0] };
}

export function toStart(h: TreeHistoryState): TreeHistoryState {
  return { ...h, cursor: [] };
}

/** Follows first children from the cursor to the end of the line it is on. */
export function toEnd(h: TreeHistoryState): TreeHistoryState {
  return { ...h, cursor: endOfLine(h.tree, cursorOf(h)) };
}

/** `path` extended by first children until a leaf. */
export function endOfLine(tree: MoveTree, path: NodePath): NodePath {
  const out = clampPath(tree, path);
  let children = childrenAt(tree, out);
  while (children.length > 0) {
    out.push(0);
    children = (children[0] as MoveNode).next;
  }
  return out;
}

export function isAtStart(h: TreeHistoryState): boolean {
  return cursorOf(h).length === 0;
}

/** True when the cursor's move has no continuation. */
export function isAtEnd(h: TreeHistoryState): boolean {
  return childrenAt(h.tree, cursorOf(h)).length === 0;
}

/* ------------------------------------------------------------------------------------- *
 * Move numbering
 * ------------------------------------------------------------------------------------- */

function fenSide(fen: string): Color {
  return fen.trim().split(/\s+/)[1] === 'b' ? 'b' : 'w';
}

function fenMoveNumber(fen: string): number {
  const field = fen.trim().split(/\s+/)[5];
  const n = field === undefined ? NaN : Number.parseInt(field, 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Side to move in the start position. */
export function startColorOf(h: TreeHistoryState): Color {
  return fenSide(h.startFen);
}

/** Full-move number of the start position (FEN field 6), default 1. */
export function startMoveNumberOf(h: TreeHistoryState): number {
  return fenMoveNumber(h.startFen);
}

/** Side to move in the position at the cursor. */
export function sideToMoveAt(h: TreeHistoryState): Color {
  return plyColor(startColorOf(h), cursorOf(h).length);
}

/**
 * `12.Nf3` / `12…Nf3` for the move at `path`, or `null` for the start position or a path that
 * leads nowhere.
 */
export function moveLabelAt(h: TreeHistoryState, path: NodePath): string | null {
  if (path.length === 0) return null;
  const node = nodeAt(h.tree, path);
  if (node === null) return null;
  const ply = path.length - 1;
  const start = startColorOf(h);
  const number = plyMoveNumber(start, startMoveNumberOf(h), ply);
  return `${number}${plyColor(start, ply) === 'w' ? '.' : '…'}${node.san}`;
}

/* ------------------------------------------------------------------------------------- *
 * Editing at the cursor
 * ------------------------------------------------------------------------------------- */

/** Moves that "Delete from here" would remove: the cursor's move and everything after it. */
export function movesFromCursor(h: TreeHistoryState): number {
  const node = nodeAt(h.tree, cursorOf(h));
  return node === null ? 0 : 1 + countMoves(node.next);
}

/** Removes the cursor's move and its subtree; the cursor goes to the parent. No-op at the start. */
export function deleteFromCursor(h: TreeHistoryState): TreeHistoryState {
  const cursor = cursorOf(h);
  if (cursor.length === 0) return { ...h, cursor };
  return { ...h, tree: deleteSubtree(h.tree, cursor), cursor: cursor.slice(0, -1) };
}

/** True when the cursor is off the main line (some step along its path is not a first child). */
export function canPromote(h: TreeHistoryState): boolean {
  return cursorOf(h).some((step) => step !== 0);
}

/**
 * Makes the cursor's move part of the main line: every move on the way to it is promoted to the
 * first child of its parent (`promoteVariation` at each level). The cursor follows.
 */
export function promoteToMainLine(h: TreeHistoryState): TreeHistoryState {
  const cursor = cursorOf(h);
  let tree = h.tree;
  for (let depth = 1; depth <= cursor.length; depth++) {
    // Earlier levels are already at index 0 by now.
    const path = [...cursor.slice(0, depth - 1).map(() => 0), cursor[depth - 1] as number];
    tree = promoteVariation(tree, path).tree;
  }
  return { ...h, tree, cursor: cursor.map(() => 0) };
}

/**
 * Sets the comment on the cursor's move *as typed* (see the module comment); `''` removes it.
 * No-op at the start position.
 */
export function setCommentAt(h: TreeHistoryState, text: string): TreeHistoryState {
  const cursor = cursorOf(h);
  if (cursor.length === 0) return h;
  const edit = (children: MoveNode[], depth: number): MoveNode[] =>
    children.map((node, i) => {
      if (i !== cursor[depth]) return node;
      if (depth < cursor.length - 1) return { ...node, next: edit(node.next, depth + 1) };
      const copy: MoveNode = { ...node };
      if (text.length === 0) delete copy.comment;
      else copy.comment = text;
      return copy;
    });
  return { ...h, tree: edit(h.tree, 0), cursor };
}

/** The comment of the cursor's move, `''` when it has none or the cursor is at the start. */
export function commentAt(h: TreeHistoryState): string {
  return nodeAt(h.tree, cursorOf(h))?.comment ?? '';
}

/** Removes every move; the start position stays. */
export function clearTree(h: TreeHistoryState): TreeHistoryState {
  return { ...h, tree: [], cursor: [] };
}

/**
 * Moves the state onto a different start position, dropping (with their subtrees) the moves that
 * are no longer legal there. The cursor keeps the part of its path that survived.
 */
export function rebaseTree(
  h: TreeHistoryState,
  startFen: string,
): { history: TreeHistoryState; dropped: number } {
  const base = createTreeHistory(startFen);
  const pruned = pruneIllegal(base.startFen, h.tree);
  // Indices are not stable across a prune (a dropped sibling shifts the later ones), so the
  // cursor is re-found by replaying its moves and matching normalised SANs.
  const cursor: NodePath = [];
  try {
    const game = createGame(base.startFen);
    let children = pruned.tree;
    for (const san of pathSans(h.tree, cursorOf(h))) {
      const applied = game.move(san);
      if (applied === null) break;
      const index = children.findIndex((child) => child.san === applied.san);
      if (index === -1) break;
      cursor.push(index);
      children = (children[index] as MoveNode).next;
    }
  } catch {
    /* an unparseable start: the pruned tree is empty, the cursor stays at the start */
  }
  return { history: { ...base, tree: pruned.tree, cursor }, dropped: pruned.dropped };
}

/* ------------------------------------------------------------------------------------- *
 * Comparing
 * ------------------------------------------------------------------------------------- */

/** Every comment trimmed, blank ones removed — what gets persisted. */
export function normaliseComments(tree: MoveTree): MoveTree {
  return tree.map((node) => {
    const copy: MoveNode = { san: node.san, next: normaliseComments(node.next) };
    const comment = node.comment?.trim() ?? '';
    if (comment.length > 0) copy.comment = comment;
    return copy;
  });
}

/**
 * Canonical string of everything the editor persists about a tree: moves, **sibling order**
 * (the first child is the main line, so "Make main line" is a real change) and trimmed comments.
 * Unlike `treeKey`, two trees differing only in order or comments get different keys.
 */
export function treeContentKey(tree: MoveTree): string {
  return JSON.stringify(normaliseComments(tree));
}
