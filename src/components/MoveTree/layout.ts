/**
 * Layout of a move tree for display (pure, unit-tested): the main line as inline runs of moves,
 * each set of alternatives as a nested `variation` block right after the move it is an
 * alternative to. Move numbers follow PGN: always before White's moves, before Black's only at
 * the start of a run (start of the tree, of a variation, or where the main line resumes).
 */

import type { Color } from '../../chess/game';
import { plyColor, plyMoveNumber } from '../../chess/history';
import type { MoveNode, MoveTree, NodePath } from '../../chess/tree';

export interface MoveToken {
  path: NodePath;
  key: string;
  san: string;
  comment?: string;
  /** `12.` / `12…`, or `''` when the number is implied by the previous move. */
  number: string;
}

export type Block =
  | { kind: 'run'; key: string; moves: MoveToken[] }
  | { kind: 'variation'; key: string; body: Block[] };

export interface Numbering {
  start: Color;
  startNumber: number;
}

function token(node: MoveNode, path: NodePath, numbering: Numbering, force: boolean): MoveToken {
  const ply = path.length - 1;
  const white = plyColor(numbering.start, ply) === 'w';
  const n = plyMoveNumber(numbering.start, numbering.startNumber, ply);
  const out: MoveToken = {
    path,
    key: path.join('.'),
    san: node.san,
    number: white ? `${n}.` : force ? `${n}…` : '',
  };
  if (node.comment !== undefined && node.comment.trim().length > 0) out.comment = node.comment;
  return out;
}

/**
 * Appends the line starting at `children[0]` (after `parent`) to `blocks`, splitting the inline
 * run wherever alternatives have to be shown.
 */
function appendLine(
  children: MoveNode[],
  parent: NodePath,
  numbering: Numbering,
  forceNumber: boolean,
  blocks: Block[],
  run: MoveToken[],
): void {
  let kids = children;
  let prefix = parent;
  let force = forceNumber;
  const flush = () => {
    if (run.length === 0) return;
    const moves = run.splice(0);
    blocks.push({ kind: 'run', key: `run-${moves[0]?.key ?? ''}`, moves });
  };
  while (kids.length > 0) {
    const main = kids[0] as MoveNode;
    const path = [...prefix, 0];
    run.push(token(main, path, numbering, force));
    force = false;
    if (kids.length > 1) {
      flush();
      kids.slice(1).forEach((alt, j) => {
        const altPath = [...prefix, j + 1];
        const body: Block[] = [];
        appendLine(alt.next, altPath, numbering, false, body, [
          token(alt, altPath, numbering, true),
        ]);
        blocks.push({ kind: 'variation', key: `var-${altPath.join('.')}`, body });
      });
      force = true;
    }
    kids = main.next;
    prefix = path;
  }
  flush();
}

export function buildBlocks(tree: MoveTree, numbering: Numbering): Block[] {
  const blocks: Block[] = [];
  appendLine(tree, [], numbering, true, blocks, []);
  return blocks;
}
