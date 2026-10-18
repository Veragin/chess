/**
 * A repertoire line as a **move tree**: one start position, and from it any number of
 * continuations, each of which may branch again.
 *
 * Shape (persisted as-is, `storage/schema.ts` v2): a tree is the list of moves playable from the
 * start position, and every node carries its own continuations in `next`. The **first child is
 * the main line**, so sibling order means something and is preserved by every operation here.
 *
 * Two kinds of address, used everywhere:
 *
 *  - a **`NodePath`** is the list of child indices from the root — `[0, 1]` is "first move of
 *    the tree, then its second continuation". `[]` is the start position itself (no node).
 *  - a **branch** is one root-to-leaf path, identified at runtime by its index in
 *    `branchesOf(tree)` (depth-first, children in order — so branch 0 is the main line). Branch
 *    indices are never persisted: any edit may renumber them.
 *
 * Every function is immutable (a changed tree is a fresh structure; untouched subtrees may be
 * shared) and total: an invalid path is a no-op or an empty answer, never a throw. Everything but
 * `replayTree` / `pruneIllegal` is free of `chess.js` — SANs are compared as plain strings, so
 * callers that need `Nf3` and `Ng1f3` to be the same move normalise through `replayTree` first.
 */

import { createGame, type Game } from './game';
import type { Square } from './position';

export interface MoveNode {
  /** The move, in SAN, from the position reached by the path to this node's parent. */
  san: string;
  /** What to know about playing this move. Absent rather than empty. */
  comment?: string;
  /**
   * Moves the position after this move threatens (see `threats.ts`), e.g. `["Bxf7+"]`. Absent
   * rather than empty.
   */
  threats?: string[];
  /** Continuations after this move; the first one is the main line. */
  next: MoveNode[];
}

/** The moves playable from the start position. Empty for a line with no moves. */
export type MoveTree = MoveNode[];

/** Child indices from the root; `[]` addresses the start position. */
export type NodePath = number[];

/* ------------------------------------------------------------------------------------- *
 * Building and reading
 * ------------------------------------------------------------------------------------- */

/** A single-branch tree playing `sans` in order. */
export function treeFromMoves(sans: readonly string[]): MoveTree {
  let next: MoveNode[] = [];
  for (let i = sans.length - 1; i >= 0; i--) {
    next = [{ san: sans[i] as string, next }];
  }
  return next;
}

/** Deep copy, so a caller can hand a tree to storage without sharing structure with its state. */
export function cloneTree(tree: MoveTree): MoveTree {
  return tree.map((node) => {
    const copy: MoveNode = { san: node.san, next: cloneTree(node.next) };
    if (node.comment !== undefined) copy.comment = node.comment;
    if (node.threats !== undefined) copy.threats = node.threats.slice();
    return copy;
  });
}

/**
 * Every root-to-leaf path, depth-first with children in order, so index 0 is the main line.
 * An empty tree has exactly one branch — the empty one — so a linear consumer can always ask
 * for branch 0.
 */
export function branchesOf(tree: MoveTree): NodePath[] {
  if (tree.length === 0) return [[]];
  const out: NodePath[] = [];
  const walk = (children: MoveNode[], prefix: NodePath): void => {
    children.forEach((child, i) => {
      const path = [...prefix, i];
      if (child.next.length === 0) out.push(path);
      else walk(child.next, path);
    });
  };
  walk(tree, []);
  return out;
}

/**
 * Index (in `branchesOf`) of the first branch passing through `path`, or -1 when `path` does not
 * address a node. `[]` lies on every branch, so it answers 0.
 */
export function branchIndexOf(tree: MoveTree, path: NodePath): number {
  if (path.length > 0 && nodeAt(tree, path) === null) return -1;
  return branchesOf(tree).findIndex((branch) => path.every((step, i) => branch[i] === step));
}

/** The node at `path`, or `null` for the start position (`[]`) and for a path that leads nowhere. */
export function nodeAt(tree: MoveTree, path: NodePath): MoveNode | null {
  let children = tree;
  let node: MoveNode | null = null;
  for (const step of path) {
    node = children[step] ?? null;
    if (node === null) return null;
    children = node.next;
  }
  return node;
}

/** The moves playable after `path` (the tree's roots for `[]`); empty when the path leads nowhere. */
export function childrenAt(tree: MoveTree, path: NodePath): MoveNode[] {
  if (path.length === 0) return tree;
  return nodeAt(tree, path)?.next ?? [];
}

/** The nodes `path` walks through, root first. Stops where the path stops making sense. */
function nodesAlong(tree: MoveTree, path: NodePath): MoveNode[] {
  const out: MoveNode[] = [];
  let children = tree;
  for (const step of path) {
    const node = children[step];
    if (node === undefined) break;
    out.push(node);
    children = node.next;
  }
  return out;
}

/** SANs of the moves along `path`, oldest first — the move history that leads to it. */
export function pathSans(tree: MoveTree, path: NodePath): string[] {
  return nodesAlong(tree, path).map((node) => node.san);
}

/** SANs of one branch (a path from `branchesOf`), as a linear move list. */
export function branchMoves(tree: MoveTree, path: NodePath): string[] {
  return pathSans(tree, path);
}

/** Comments of one branch, parallel to `branchMoves`; `undefined` where a move has none. */
export function branchComments(tree: MoveTree, path: NodePath): (string | undefined)[] {
  return nodesAlong(tree, path).map((node) => node.comment);
}

/** Threats of one branch, parallel to `branchMoves`; `undefined` where a move has none. */
export function branchThreats(tree: MoveTree, path: NodePath): (string[] | undefined)[] {
  return nodesAlong(tree, path).map((node) => node.threats);
}

/* ------------------------------------------------------------------------------------- *
 * Editing
 * ------------------------------------------------------------------------------------- */

/**
 * Rebuilds the node at `path` through `edit`, copying only the nodes on the way down. Returns
 * `tree` itself when `path` leads nowhere (or is `[]`, which has no node to edit).
 */
function updateAt(tree: MoveTree, path: NodePath, edit: (node: MoveNode) => MoveNode): MoveTree {
  if (path.length === 0) return tree;
  const [step, ...rest] = path as [number, ...number[]];
  const node = tree[step];
  if (node === undefined) return tree;
  const replaced =
    rest.length === 0 ? edit(node) : { ...node, next: updateAt(node.next, rest, edit) };
  if (replaced === node) return tree;
  const out = tree.slice();
  out[step] = replaced;
  return out;
}

/** Same as `updateAt`, but on the *children list* after `path` (the roots for `[]`). */
function updateChildrenAt(
  tree: MoveTree,
  path: NodePath,
  edit: (children: MoveNode[]) => MoveNode[],
): MoveTree {
  if (path.length === 0) return edit(tree);
  return updateAt(tree, path, (node) => {
    const next = edit(node.next);
    return next === node.next ? node : { ...node, next };
  });
}

/** True when `path` is `[]` or addresses a node. */
function isValidPath(tree: MoveTree, path: NodePath): boolean {
  return path.length === 0 || nodeAt(tree, path) !== null;
}

/**
 * Plays `san` after `path`. If that move is already a continuation there, the tree is unchanged
 * and the returned path simply descends into it; otherwise it is appended as the *last* child —
 * a new branch when siblings exist, a plain extension at a leaf. A path that leads nowhere is a
 * no-op (the same tree and path come back).
 */
export function addMove(
  tree: MoveTree,
  path: NodePath,
  san: string,
): { tree: MoveTree; path: NodePath } {
  if (!isValidPath(tree, path)) return { tree, path };
  const children = childrenAt(tree, path);
  const existing = children.findIndex((child) => child.san === san);
  if (existing !== -1) return { tree, path: [...path, existing] };
  return {
    tree: updateChildrenAt(tree, path, (kids) => [...kids, { san, next: [] }]),
    path: [...path, children.length],
  };
}

/**
 * Removes the node at `path` and everything after it. `[]` clears the whole tree; a path that
 * leads nowhere changes nothing.
 */
export function deleteSubtree(tree: MoveTree, path: NodePath): MoveTree {
  if (path.length === 0) return [];
  if (nodeAt(tree, path) === null) return tree;
  const parent = path.slice(0, -1);
  const index = path[path.length - 1] as number;
  return updateChildrenAt(tree, parent, (kids) => kids.filter((_, i) => i !== index));
}

/**
 * Makes the node at `path` the first among its siblings — the main line from its parent on.
 * Returns the node's new path (last index 0). No-op for `[]` and for a path that leads nowhere.
 */
export function promoteVariation(
  tree: MoveTree,
  path: NodePath,
): { tree: MoveTree; path: NodePath } {
  if (path.length === 0 || nodeAt(tree, path) === null) return { tree, path };
  const parent = path.slice(0, -1);
  const index = path[path.length - 1] as number;
  if (index === 0) return { tree, path };
  const next = updateChildrenAt(tree, parent, (kids) => {
    const moved = kids[index] as MoveNode;
    return [moved, ...kids.filter((_, i) => i !== index)];
  });
  return { tree: next, path: [...parent, 0] };
}

/**
 * Sets the comment of the move at `path`. Text is trimmed; empty or whitespace-only text removes
 * the field rather than storing `''`. No-op for `[]` (the start position has no move to describe).
 */
export function setComment(tree: MoveTree, path: NodePath, text: string): MoveTree {
  const comment = typeof text === 'string' ? text.trim() : '';
  return updateAt(tree, path, (node) => {
    if ((node.comment ?? '') === comment) return node;
    const copy: MoveNode = { ...node };
    if (comment.length === 0) delete copy.comment;
    else copy.comment = comment;
    return copy;
  });
}

/** Joins two comments of the same move: one if they agree, both (on separate lines) otherwise. */
function mergeComments(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined || a.length === 0) return b;
  if (b === undefined || b.length === 0 || a === b) return a;
  return `${a}\n${b}`;
}

/** The threats of both copies of a move, each once. */
function mergeThreats(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  if (a === undefined || a.length === 0) return b?.slice();
  if (b === undefined || b.length === 0) return a.slice();
  return [...a, ...b.filter((move) => !a.includes(move))];
}

/**
 * The union of two trees. Siblings are matched by SAN (exact string), so a shared prefix is kept
 * once and the trees diverge where their moves do; `a`'s order comes first, `b`'s new moves are
 * appended. Comments on a shared move are concatenated when they differ; threats are united.
 */
export function mergeTrees(a: MoveTree, b: MoveTree): MoveTree {
  const out: MoveNode[] = cloneTree(a);
  for (const node of b) {
    const index = out.findIndex((existing) => existing.san === node.san);
    if (index === -1) {
      out.push(...cloneTree([node]));
      continue;
    }
    const existing = out[index] as MoveNode;
    const merged: MoveNode = { san: existing.san, next: mergeTrees(existing.next, node.next) };
    const comment = mergeComments(existing.comment, node.comment);
    if (comment !== undefined) merged.comment = comment;
    const threats = mergeThreats(existing.threats, node.threats);
    if (threats !== undefined) merged.threats = threats;
    out[index] = merged;
  }
  return out;
}

/** Collapses siblings with the same SAN (anywhere in the tree) into one, as `mergeTrees` would. */
export function dedupeSiblings(tree: MoveTree): MoveTree {
  return tree.reduce<MoveTree>(
    (acc, node) => mergeTrees(acc, [{ ...node, next: dedupeSiblings(node.next) }]),
    [],
  );
}

/* ------------------------------------------------------------------------------------- *
 * Measuring and comparing
 * ------------------------------------------------------------------------------------- */

/** Number of moves (nodes) in the whole tree. */
export function countMoves(tree: MoveTree): number {
  return tree.reduce((sum, node) => sum + 1 + countMoves(node.next), 0);
}

/** Number of branches — `branchesOf(tree).length`, so 1 for an empty tree. */
export function countBranches(tree: MoveTree): number {
  if (tree.length === 0) return 1;
  const leaves = (children: MoveNode[]): number =>
    children.reduce((sum, node) => sum + (node.next.length === 0 ? 1 : leaves(node.next)), 0);
  return leaves(tree);
}

/** Plies in the longest branch; 0 for an empty tree. */
export function maxDepth(tree: MoveTree): number {
  return tree.reduce((deepest, node) => Math.max(deepest, 1 + maxDepth(node.next)), 0);
}

/**
 * Canonical string of the tree's *moves*: siblings sorted by SAN, comments ignored. Two trees
 * with the same key hold the same moves whatever their sibling order — the content comparison
 * behind the seed guard and "Clear data…"'s count of hand-made lines.
 */
export function treeKey(tree: MoveTree): string {
  return tree
    .map((node) =>
      node.next.length === 0 ? node.san : `${node.san}(${treeKey(node.next)})`,
    )
    .sort()
    .join(',');
}

/* ------------------------------------------------------------------------------------- *
 * Replay (chess.js)
 * ------------------------------------------------------------------------------------- */

/** One move of the tree as played on a board. */
export interface ReplayedNode {
  path: NodePath;
  /** SAN as chess.js normalises it. */
  san: string;
  from: Square;
  to: Square;
  fenBefore: string;
  fenAfter: string;
}

/** Where a tree stops replaying. `path` is `[]` when the start position itself is not legal. */
export interface BrokenNode {
  path: NodePath;
  /** The SAN as stored (unnormalised), `''` for the start position. */
  san: string;
  reason: string;
}

export interface TreeReplay {
  /** True when the start position is legal and every node replays. */
  ok: boolean;
  /** Start FEN normalised by chess.js, or `null` when it is not a legal position. */
  startFen: string | null;
  /** Every playable node, depth-first in tree order (parents before children). */
  nodes: ReplayedNode[];
  /**
   * The playable part of the tree with SANs normalised. Unplayable nodes are cut together with
   * their subtrees; their playable siblings are kept, so paths stay stable up to the first break.
   * Siblings that only became equal through normalisation are *not* merged — see `dedupeSiblings`.
   */
  tree: MoveTree;
  /** First unplayable node in depth-first order, or `null`. */
  broken: BrokenNode | null;
  /** Number of moves cut from the tree (the unplayable nodes and everything after them). */
  dropped: number;
}

/**
 * Plays the whole tree on a board, once. Every node is visited (an unplayable one cuts only its
 * own subtree), so an index built from `nodes` covers as much of a damaged line as still makes
 * sense. Never throws.
 */
export function replayTree(startFen: string, tree: MoveTree): TreeReplay {
  let game: Game;
  try {
    game = createGame(typeof startFen === 'string' ? startFen.trim() : '');
  } catch (err) {
    return {
      ok: false,
      startFen: null,
      nodes: [],
      tree: [],
      broken: {
        path: [],
        san: '',
        reason: `Start position is not a legal FEN: ${err instanceof Error ? err.message : 'invalid'}`,
      },
      dropped: countMoves(tree),
    };
  }

  const nodes: ReplayedNode[] = [];
  let broken: BrokenNode | null = null;
  let dropped = 0;

  const walk = (children: MoveNode[], prefix: NodePath): MoveNode[] => {
    const kept: MoveNode[] = [];
    children.forEach((child, i) => {
      const path = [...prefix, i];
      const fenBefore = game.fen();
      const applied = typeof child.san === 'string' ? game.move(child.san) : null;
      if (applied === null) {
        if (broken === null) {
          broken = {
            path,
            san: String(child.san),
            reason: `"${String(child.san)}" cannot be played from this position.`,
          };
        }
        dropped += 1 + countMoves(child.next);
        return;
      }
      const fenAfter = game.fen();
      nodes.push({ path, san: applied.san, from: applied.from, to: applied.to, fenBefore, fenAfter });
      const node: MoveNode = { san: applied.san, next: walk(child.next, path) };
      if (child.comment !== undefined) node.comment = child.comment;
      if (child.threats !== undefined) node.threats = child.threats.slice();
      kept.push(node);
      game.undo();
    });
    return kept;
  };

  const normalised = walk(tree, []);
  return { ok: broken === null, startFen: game.fen(), nodes, tree: normalised, broken, dropped };
}

/**
 * The tree with every move that cannot be played from `startFen` removed (with its subtree),
 * SANs normalised — what the editor keeps when the start position changes under it.
 */
export function pruneIllegal(startFen: string, tree: MoveTree): { tree: MoveTree; dropped: number } {
  const replay = replayTree(startFen, tree);
  return { tree: replay.tree, dropped: replay.dropped };
}
