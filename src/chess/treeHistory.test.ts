import { describe, expect, it } from 'vitest';
import { START_FEN } from './position';
import { treeFromMoves, treeKey, type MoveTree } from './tree';
import {
  applyMoveAt,
  canPromote,
  clampPath,
  clearTree,
  commentAt,
  createTreeHistory,
  deleteFromCursor,
  endOfLine,
  fenAt,
  isAtEnd,
  isAtStart,
  jumpTo,
  lastMoveAt,
  moveLabelAt,
  movesFromCursor,
  normaliseComments,
  promoteToMainLine,
  rebaseTree,
  setCommentAt,
  setThreatsAt,
  threatsAt,
  sideToMoveAt,
  stepBack,
  stepForward,
  toEnd,
  toStart,
  treeContentKey,
  type TreeHistoryState,
} from './treeHistory';

function play(h: TreeHistoryState, ...sans: string[]): TreeHistoryState {
  let state = h;
  for (const san of sans) {
    const next = applyMoveAt(state, san);
    if (next === null) throw new Error(`test fixture: ${san} is illegal`);
    state = next;
  }
  return state;
}

/** 1.e4 e5 (1...c5) 2.Nf3 (2.Bc4) 2...Nc6 — cursor left on 1...c5. */
function branched(): TreeHistoryState {
  let h = play(createTreeHistory(START_FEN), 'e4', 'e5', 'Nf3', 'Nc6');
  h = play(jumpTo(h, [0, 0]), 'Bc4');
  h = play(jumpTo(h, [0]), 'c5');
  return h;
}

describe('createTreeHistory', () => {
  it('starts at the root with an empty tree and a normalised FEN', () => {
    const h = createTreeHistory(`  ${START_FEN}  `);
    expect(h.startFen).toBe(START_FEN);
    expect(h.tree).toEqual([]);
    expect(h.cursor).toEqual([]);
    expect(isAtStart(h)).toBe(true);
    expect(isAtEnd(h)).toBe(true);
  });

  it('keeps an unparseable FEN and refuses every move instead of throwing', () => {
    const h = createTreeHistory('not a fen');
    expect(h.startFen).toBe('not a fen');
    expect(applyMoveAt(h, 'e4')).toBeNull();
    expect(fenAt(h)).toBe('not a fen');
  });
});

describe('applyMoveAt', () => {
  it('extends the line and moves the cursor', () => {
    const h = play(createTreeHistory(START_FEN), 'e4', 'e5');
    expect(h.tree).toEqual(treeFromMoves(['e4', 'e5']));
    expect(h.cursor).toEqual([0, 0]);
    expect(fenAt(h)).toContain(' w ');
  });

  it('refuses an illegal move, leaving the state alone', () => {
    expect(applyMoveAt(createTreeHistory(START_FEN), 'e5')).toBeNull();
  });

  it('accepts board input and stores normalised SAN', () => {
    const h = applyMoveAt(createTreeHistory(START_FEN), { from: 'g1', to: 'f3' });
    expect(h?.tree[0]?.san).toBe('Nf3');
    const loose = applyMoveAt(createTreeHistory(START_FEN), 'Ng1f3');
    expect(loose?.tree[0]?.san).toBe('Nf3');
  });

  it('follows an existing continuation instead of duplicating it', () => {
    const h = play(createTreeHistory(START_FEN), 'e4', 'e5');
    const again = play(toStart(h), 'e4');
    expect(again.tree).toBe(h.tree);
    expect(again.cursor).toEqual([0]);
  });

  it('adds a new branch rather than truncating', () => {
    const h = branched();
    expect(treeKey(h.tree)).toBe('e4(c5,e5(Bc4,Nf3(Nc6)))');
    expect(h.tree[0]?.next[0]?.next.map((n) => n.san)).toEqual(['Nf3', 'Bc4']);
    expect(h.cursor).toEqual([0, 1]);
  });
});

describe('navigation', () => {
  it('steps back to the parent and forward along the first child', () => {
    const h = jumpTo(branched(), [0, 0, 1]); // 2.Bc4
    expect(stepBack(h).cursor).toEqual([0, 0]);
    expect(stepForward(stepBack(h)).cursor).toEqual([0, 0, 0]);
    expect(stepBack(toStart(h)).cursor).toEqual([]);
    expect(stepForward(h).cursor).toEqual([0, 0, 1]); // leaf: stays
  });

  it('goes to the end of the line the cursor is on', () => {
    const h = branched();
    expect(toEnd(toStart(h)).cursor).toEqual([0, 0, 0, 0]);
    expect(toEnd(jumpTo(h, [0, 0, 1])).cursor).toEqual([0, 0, 1]);
    expect(endOfLine(h.tree, [9])).toEqual([0, 0, 0, 0]);
  });

  it('clamps a path that leads nowhere', () => {
    const h = branched();
    expect(clampPath(h.tree, [0, 0, 5, 2])).toEqual([0, 0]);
    expect(jumpTo(h, [7]).cursor).toEqual([]);
  });

  it('reports the FEN and last move at any node', () => {
    const h = branched();
    expect(fenAt(h, [])).toBe(START_FEN);
    expect(fenAt(h, [0, 1])).toContain('2p5');
    expect(lastMoveAt(jumpTo(h, [0, 0, 1]))).toEqual({ from: 'f1', to: 'c4' });
    expect(lastMoveAt(toStart(h))).toBeNull();
    expect(sideToMoveAt(jumpTo(h, [0]))).toBe('b');
  });
});

describe('moveLabelAt', () => {
  it('numbers white and black moves', () => {
    const h = branched();
    expect(moveLabelAt(h, [0])).toBe('1.e4');
    expect(moveLabelAt(h, [0, 0])).toBe('1…e5');
    expect(moveLabelAt(h, [0, 0, 1])).toBe('2.Bc4');
    expect(moveLabelAt(h, [])).toBeNull();
    expect(moveLabelAt(h, [3])).toBeNull();
  });

  it('honours a start position with Black to move', () => {
    const h = play(
      createTreeHistory('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 12'),
      'e5',
      'Nf3',
    );
    expect(moveLabelAt(h, [0])).toBe('12…e5');
    expect(moveLabelAt(h, [0, 0])).toBe('13.Nf3');
  });
});

describe('editing at the cursor', () => {
  it('deletes the subtree and moves the cursor to the parent', () => {
    const h = jumpTo(branched(), [0, 0]);
    expect(movesFromCursor(h)).toBe(4);
    const deleted = deleteFromCursor(h);
    expect(treeKey(deleted.tree)).toBe('e4(c5)');
    expect(deleted.cursor).toEqual([0]);
    expect(movesFromCursor(toStart(h))).toBe(0);
    expect(deleteFromCursor(toStart(h)).tree).toBe(h.tree);
  });

  it('promotes the whole path to the main line', () => {
    let h = branched();
    h = play(jumpTo(h, [0, 0, 1]), 'Nf6', 'd3');
    h = play(jumpTo(h, [0, 0, 1, 0]), 'Nc3');
    const deep = jumpTo(h, [0, 0, 1, 0, 1]); // 3.Nc3 in the 2.Bc4 variation
    expect(canPromote(deep)).toBe(true);
    const promoted = promoteToMainLine(deep);
    expect(promoted.cursor).toEqual([0, 0, 0, 0, 0]);
    expect(moveLabelAt(promoted, promoted.cursor)).toBe('3.Nc3');
    expect(treeKey(promoted.tree)).toBe(treeKey(h.tree));
    expect(promoted.tree[0]?.next[0]?.next.map((n) => n.san)).toEqual(['Bc4', 'Nf3']);
    expect(canPromote(promoted)).toBe(false);
  });

  it('stores comments as typed and normalises them separately', () => {
    const h = jumpTo(branched(), [0, 0, 1]);
    const typed = setCommentAt(h, 'Italian ');
    expect(commentAt(typed)).toBe('Italian ');
    expect(typed.tree[0]?.next[0]?.next[0]?.comment).toBeUndefined();
    expect(normaliseComments(typed.tree)[0]?.next[0]?.next[1]?.comment).toBe('Italian');
    expect(commentAt(setCommentAt(typed, ''))).toBe('');
    expect('comment' in (setCommentAt(typed, '').tree[0]?.next[0]?.next[1] ?? {})).toBe(false);
    expect(setCommentAt(toStart(h), 'x').tree).toBe(h.tree);
    expect(commentAt(toStart(typed))).toBe('');
  });

  it('sets and clears the threats of the cursor move', () => {
    const h = jumpTo(branched(), [0, 0, 1]);
    const threatened = setThreatsAt(h, ['Bxf7+', 'Ng5']);
    expect(threatsAt(threatened)).toEqual(['Bxf7+', 'Ng5']);
    expect(threatened.tree[0]?.next[0]?.next[1]?.threats).toEqual(['Bxf7+', 'Ng5']);
    expect(threatsAt(jumpTo(threatened, [0, 0]))).toEqual([]);
    expect('threats' in (setThreatsAt(threatened, []).tree[0]?.next[0]?.next[1] ?? {})).toBe(false);
    expect(setThreatsAt(toStart(h), ['e4']).tree).toBe(h.tree);
    expect(normaliseComments(setThreatsAt(h, [' Ng5 ', '']).tree)[0]?.next[0]?.next[1]?.threats).toEqual([
      'Ng5',
    ]);
  });

  it('clears every move', () => {
    const h = clearTree(branched());
    expect(h.tree).toEqual([]);
    expect(h.cursor).toEqual([]);
  });
});

describe('rebaseTree', () => {
  it('drops moves that are illegal from the new start and clamps the cursor', () => {
    // Black has no e-pawn: 1.e4 stays, 1...e5 and everything after it goes; 1...c5 survives.
    const h = jumpTo(branched(), [0, 0, 0, 0]);
    const { history, dropped } = rebaseTree(
      h,
      'rnbqkbnr/pppp1ppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    );
    expect(dropped).toBe(4);
    expect(treeKey(history.tree)).toBe('e4(c5)');
    // c5 slid into e5's slot; the cursor must not follow the index onto it.
    expect(history.cursor).toEqual([0]);
    expect(rebaseTree(jumpTo(h, [0, 1]), history.startFen).history.cursor).toEqual([0, 0]);
  });

  it('keeps everything, comments included, on an equivalent position', () => {
    const h = setCommentAt(jumpTo(branched(), [0, 1]), 'Sicilian');
    const { history, dropped } = rebaseTree(h, START_FEN);
    expect(dropped).toBe(0);
    expect(history.tree).toEqual(h.tree);
  });
});

describe('treeContentKey', () => {
  const a: MoveTree = [
    { san: 'e4', next: [] },
    { san: 'd4', comment: 'queen', next: [] },
  ];

  it('ignores whitespace around comments', () => {
    const b: MoveTree = [
      { san: 'e4', next: [] },
      { san: 'd4', comment: ' queen  ', next: [] },
    ];
    expect(treeContentKey(a)).toBe(treeContentKey(b));
  });

  it('notices sibling order and comment changes', () => {
    expect(treeContentKey(a)).not.toBe(treeContentKey([a[1]!, a[0]!]));
    expect(treeContentKey(a)).not.toBe(
      treeContentKey([a[0]!, { san: 'd4', comment: 'other', next: [] }]),
    );
    expect(treeContentKey(a)).not.toBe(treeContentKey([a[0]!, { san: 'd4', next: [] }]));
  });
});
