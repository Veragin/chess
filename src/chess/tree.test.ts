import { describe, expect, it } from 'vitest';
import { START_FEN } from './position';
import {
  addMove,
  branchComments,
  branchesOf,
  branchIndexOf,
  branchMoves,
  childrenAt,
  cloneTree,
  countBranches,
  countMoves,
  dedupeSiblings,
  deleteSubtree,
  maxDepth,
  mergeTrees,
  nodeAt,
  pathSans,
  promoteVariation,
  pruneIllegal,
  replayTree,
  setComment,
  treeFromMoves,
  treeKey,
  type MoveTree,
} from './tree';

/**
 * 1. e4 e5 2. Nf3 (2. f4) Nc6 (2... d6) 3. Bb5
 *
 * Branches, depth-first: e4 e5 Nf3 Nc6 Bb5 / e4 e5 Nf3 d6 / e4 e5 f4.
 */
function sample(): MoveTree {
  return [
    {
      san: 'e4',
      next: [
        {
          san: 'e5',
          next: [
            {
              san: 'Nf3',
              comment: 'develop',
              next: [
                { san: 'Nc6', next: [{ san: 'Bb5', next: [] }] },
                { san: 'd6', next: [] },
              ],
            },
            { san: 'f4', next: [] },
          ],
        },
      ],
    },
  ];
}

describe('treeFromMoves', () => {
  it('builds a single chain', () => {
    const tree = treeFromMoves(['e4', 'e5', 'Nf3']);
    expect(tree).toEqual([{ san: 'e4', next: [{ san: 'e5', next: [{ san: 'Nf3', next: [] }] }] }]);
    expect(branchesOf(tree)).toEqual([[0, 0, 0]]);
  });

  it('gives an empty tree for no moves', () => {
    expect(treeFromMoves([])).toEqual([]);
  });
});

describe('reading', () => {
  it('enumerates branches depth-first, children in order', () => {
    const tree = sample();
    expect(branchesOf(tree)).toEqual([
      [0, 0, 0, 0, 0],
      [0, 0, 0, 1],
      [0, 0, 1],
    ]);
    expect(branchesOf(tree).map((p) => branchMoves(tree, p).join(' '))).toEqual([
      'e4 e5 Nf3 Nc6 Bb5',
      'e4 e5 Nf3 d6',
      'e4 e5 f4',
    ]);
  });

  it('has one empty branch for an empty tree', () => {
    expect(branchesOf([])).toEqual([[]]);
    expect(countBranches([])).toBe(1);
    expect(branchMoves([], [])).toEqual([]);
  });

  it('lists comments parallel to the moves', () => {
    expect(branchComments(sample(), [0, 0, 0, 1])).toEqual([undefined, undefined, 'develop', undefined]);
  });

  it('finds nodes and children by path', () => {
    const tree = sample();
    expect(nodeAt(tree, [0, 0, 1])?.san).toBe('f4');
    expect(nodeAt(tree, [])).toBeNull();
    expect(nodeAt(tree, [0, 5])).toBeNull();
    expect(childrenAt(tree, []).map((n) => n.san)).toEqual(['e4']);
    expect(childrenAt(tree, [0, 0]).map((n) => n.san)).toEqual(['Nf3', 'f4']);
    expect(childrenAt(tree, [3])).toEqual([]);
    expect(pathSans(tree, [0, 0, 0])).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('maps a path to the first branch through it', () => {
    const tree = sample();
    expect(branchIndexOf(tree, [])).toBe(0);
    expect(branchIndexOf(tree, [0, 0, 0, 1])).toBe(1);
    expect(branchIndexOf(tree, [0, 0, 1])).toBe(2);
    expect(branchIndexOf(tree, [0, 9])).toBe(-1);
  });

  it('counts moves, branches and depth', () => {
    const tree = sample();
    expect(countMoves(tree)).toBe(7);
    expect(countBranches(tree)).toBe(branchesOf(tree).length);
    expect(maxDepth(tree)).toBe(5);
    expect(countMoves([])).toBe(0);
    expect(maxDepth([])).toBe(0);
  });
});

describe('addMove', () => {
  it('descends into an existing move without changing the tree', () => {
    const tree = sample();
    const res = addMove(tree, [0, 0], 'f4');
    expect(res.tree).toBe(tree);
    expect(res.path).toEqual([0, 0, 1]);
  });

  it('appends a new move as a new branch', () => {
    const tree = sample();
    const res = addMove(tree, [0, 0], 'Bc4');
    expect(res.path).toEqual([0, 0, 2]);
    expect(childrenAt(res.tree, [0, 0]).map((n) => n.san)).toEqual(['Nf3', 'f4', 'Bc4']);
    expect(countBranches(res.tree)).toBe(4);
    // The original is untouched.
    expect(childrenAt(tree, [0, 0])).toHaveLength(2);
  });

  it('extends a leaf and starts an empty tree', () => {
    const extended = addMove(sample(), [0, 0, 1], 'exf4');
    expect(branchMoves(extended.tree, extended.path)).toEqual(['e4', 'e5', 'f4', 'exf4']);
    expect(countBranches(extended.tree)).toBe(3);
    expect(addMove([], [], 'd4')).toEqual({ tree: [{ san: 'd4', next: [] }], path: [0] });
  });

  it('ignores a path that leads nowhere', () => {
    const tree = sample();
    expect(addMove(tree, [4], 'd4')).toEqual({ tree, path: [4] });
  });
});

describe('deleteSubtree / promoteVariation / setComment', () => {
  it('deletes a node with everything after it', () => {
    const tree = deleteSubtree(sample(), [0, 0, 0]);
    expect(branchesOf(tree).map((p) => branchMoves(tree, p).join(' '))).toEqual(['e4 e5 f4']);
    expect(deleteSubtree(sample(), [])).toEqual([]);
    expect(deleteSubtree(sample(), [2])).toEqual(sample());
  });

  it('promotes a variation to the first child', () => {
    const res = promoteVariation(sample(), [0, 0, 1]);
    expect(res.path).toEqual([0, 0, 0]);
    expect(branchMoves(res.tree, branchesOf(res.tree)[0] as number[])).toEqual(['e4', 'e5', 'f4']);
    const same = sample();
    expect(promoteVariation(same, [0, 0, 0]).tree).toBe(same);
  });

  it('sets, trims and removes comments', () => {
    const set = setComment(sample(), [0, 0, 1], '  sharp  ');
    expect(nodeAt(set, [0, 0, 1])?.comment).toBe('sharp');
    const cleared = setComment(set, [0, 0, 1], '   ');
    expect('comment' in (nodeAt(cleared, [0, 0, 1]) as object)).toBe(false);
    expect(setComment(sample(), [], 'x')).toEqual(sample());
  });
});

describe('mergeTrees', () => {
  it('keeps a shared prefix once and branches where moves diverge', () => {
    const merged = mergeTrees(treeFromMoves(['e4', 'e5', 'Nf3']), treeFromMoves(['e4', 'e5', 'f4']));
    expect(branchesOf(merged).map((p) => branchMoves(merged, p).join(' '))).toEqual([
      'e4 e5 Nf3',
      'e4 e5 f4',
    ]);
  });

  it('absorbs identical and prefix lines', () => {
    const line = treeFromMoves(['d4', 'd5', 'c4']);
    expect(mergeTrees(line, line)).toEqual(line);
    expect(mergeTrees(line, treeFromMoves(['d4', 'd5']))).toEqual(line);
    expect(mergeTrees(treeFromMoves(['d4']), line)).toEqual(line);
  });

  it('concatenates differing comments and keeps equal ones once', () => {
    const a = setComment(treeFromMoves(['e4']), [0], 'best by test');
    const b = setComment(treeFromMoves(['e4']), [0], 'king pawn');
    expect(mergeTrees(a, b)[0]?.comment).toBe('best by test\nking pawn');
    expect(mergeTrees(a, a)[0]?.comment).toBe('best by test');
    expect(mergeTrees(treeFromMoves(['e4']), b)[0]?.comment).toBe('king pawn');
  });

  it('dedupes equal siblings', () => {
    const tree: MoveTree = [
      { san: 'e4', next: [{ san: 'e5', next: [] }] },
      { san: 'e4', next: [{ san: 'c5', next: [] }] },
    ];
    expect(dedupeSiblings(tree)).toEqual([
      { san: 'e4', next: [{ san: 'e5', next: [] }, { san: 'c5', next: [] }] },
    ]);
    const nested: MoveTree = [
      { san: 'd4', next: [{ san: 'd5', next: [] }, { san: 'd5', next: [{ san: 'c4', next: [] }] }] },
    ];
    expect(dedupeSiblings(nested)).toEqual(treeFromMoves(['d4', 'd5', 'c4']));
  });
});

describe('treeKey', () => {
  it('is stable under sibling order and ignores comments', () => {
    const tree = sample();
    const promoted = promoteVariation(promoteVariation(tree, [0, 0, 1]).tree, [0, 0, 1, 1]).tree;
    expect(treeKey(promoted)).toBe(treeKey(tree));
    expect(treeKey(setComment(tree, [0], 'hi'))).toBe(treeKey(tree));
  });

  it('tells different move sets apart', () => {
    expect(treeKey(treeFromMoves(['e4', 'e5']))).not.toBe(treeKey(treeFromMoves(['e4'])));
    expect(treeKey(addMove(sample(), [0], 'c5').tree)).not.toBe(treeKey(sample()));
    expect(treeKey([])).toBe('');
  });

  it('does not touch the input', () => {
    const tree = sample();
    const copy = cloneTree(tree);
    treeKey(tree);
    expect(tree).toEqual(copy);
  });
});

describe('replayTree / pruneIllegal', () => {
  it('replays every node with squares and positions', () => {
    const replay = replayTree(START_FEN, sample());
    expect(replay.ok).toBe(true);
    expect(replay.broken).toBeNull();
    expect(replay.nodes).toHaveLength(7);
    const f4 = replay.nodes.find((n) => n.san === 'f4');
    expect(f4?.path).toEqual([0, 0, 1]);
    expect(f4?.from).toBe('f2');
    expect(f4?.to).toBe('f4');
    expect(f4?.fenBefore).toBe('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
    expect(replay.tree).toEqual(sample());
  });

  it('normalises SAN', () => {
    const replay = replayTree(START_FEN, treeFromMoves(['e2e4', 'e5', 'Ng1f3']));
    expect(branchMoves(replay.tree, [0, 0, 0])).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('reports the first broken node and keeps its playable siblings', () => {
    const tree: MoveTree = [
      {
        san: 'e4',
        next: [
          { san: 'e6', next: [{ san: 'd4', next: [] }] },
          { san: 'Qh4', next: [] },
          { san: 'c5', next: [] },
        ],
      },
    ];
    const replay = replayTree(START_FEN, tree);
    expect(replay.ok).toBe(false);
    expect(replay.broken?.path).toEqual([0, 1]);
    expect(replay.broken?.san).toBe('Qh4');
    expect(replay.dropped).toBe(1);
    expect(childrenAt(replay.tree, [0]).map((n) => n.san)).toEqual(['e6', 'c5']);
    expect(pruneIllegal(START_FEN, tree)).toEqual({ tree: replay.tree, dropped: 1 });
  });

  it('refuses an illegal start position', () => {
    const replay = replayTree('not a fen', sample());
    expect(replay.ok).toBe(false);
    expect(replay.startFen).toBeNull();
    expect(replay.broken?.path).toEqual([]);
    expect(pruneIllegal('not a fen', sample())).toEqual({ tree: [], dropped: 7 });
  });
});
