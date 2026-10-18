/**
 * The persisted form of a move tree (schema v2): PGN-like nested arrays instead of nested nodes.
 *
 * A stored tree is a list of moves played one after another — the main line — where a move is a
 * SAN string, or `{ san, comment?, threats? }` when it carries a comment or threats. A nested
 * array right after a move is an **alternative to that move** (PGN's `( … )`): it starts with the
 * alternative move and continues with that variation's own line. Several arrays after one move
 * are further alternatives, in sibling order.
 *
 *     ["e4", "e5", "Nf3", "Nc6", ["Nf6", "Nxe5"], "Bc4"]
 *     // main line e4 e5 Nf3 Nc6 Bc4; 2…Nf6 3.Nxe5 is the second child of 2.Nf3
 *
 * Only the persisted shape changes: in memory every caller keeps working on `MoveTree`
 * (`chess/tree.ts`). `encodeTree` and `decodeTree` are exact inverses — sibling order, comments,
 * threats and the main line (first child) all survive a round trip. Validation lives in `schema.ts`
 * with the rest of the payload checks; `decodeTree` expects a validated tree.
 */

import { normaliseThreats } from '../chess/threats';
import type { MoveNode, MoveTree } from '../chess/tree';

/** One stored move: bare SAN, or SAN with its comment and/or threats. */
export type StoredMove = string | { san: string; comment?: string; threats?: string[] };

/** The stored form of one node (its continuations aside). */
function encodeMove(node: MoveNode): StoredMove {
  if (node.comment === undefined && node.threats === undefined) return node.san;
  const out: { san: string; comment?: string; threats?: string[] } = { san: node.san };
  if (node.comment !== undefined) out.comment = node.comment;
  if (node.threats !== undefined) out.threats = node.threats.slice();
  return out;
}

/** A stored line of play; a nested array is an alternative to the move before it. */
export type StoredTree = (StoredMove | StoredTree)[];

/** The persisted form of `tree`. Recursion depth is the variation nesting, not the line length. */
export function encodeTree(tree: MoveTree): StoredTree {
  const out: StoredTree = [];
  let children = tree;
  while (children.length > 0) {
    const [main, ...alternatives] = children as [MoveNode, ...MoveNode[]];
    out.push(encodeMove(main));
    for (const alternative of alternatives) out.push(encodeTree([alternative]));
    children = main.next;
  }
  return out;
}

/**
 * The in-memory tree of a *validated* stored tree (see `schema.ts`): SANs trimmed, blank
 * comments and threats dropped.
 */
export function decodeTree(stored: StoredTree): MoveTree {
  const roots: MoveNode[] = [];
  /** The children list the last move went into — where an alternative to it belongs. */
  let siblings = roots;
  let last: MoveNode | null = null;
  for (const item of stored) {
    if (Array.isArray(item)) {
      siblings.push(...decodeTree(item));
      continue;
    }
    const node: MoveNode = { san: (typeof item === 'string' ? item : item.san).trim(), next: [] };
    const comment = typeof item === 'string' ? undefined : item.comment?.trim();
    if (comment !== undefined && comment.length > 0) node.comment = comment;
    const threats = typeof item === 'string' ? undefined : normaliseThreats(item.threats);
    if (threats !== undefined) node.threats = threats;
    siblings = last === null ? roots : last.next;
    siblings.push(node);
    last = node;
  }
  return roots;
}
