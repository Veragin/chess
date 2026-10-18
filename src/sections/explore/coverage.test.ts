import { describe, expect, it } from 'vitest';
import { fenAfter } from '../../chess/game';
import { START_FEN } from '../../chess/position';
import type { Line } from '../../storage/schema';
import {
  arrivalComments,
  buildCoverageIndex,
  coverageArrows,
  coverageAt,
  EMPTY_COVERAGE,
  linesTrainedFor,
  positionKey,
} from './coverage';
import { treeFromMoves, type MoveNode, type MoveTree } from '../../chess/tree';

function line(name: string, moves: string[], overrides: Partial<Line> = {}): Line {
  return {
    id: `id-${name}`,
    name,
    startFen: START_FEN,
    tree: treeFromMoves(moves),
    userColor: 'w',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

/** A tree node; `next` given as further nodes. */
function n(san: string, next: MoveNode[] = [], comment?: string): MoveNode {
  return comment === undefined ? { san, next } : { san, comment, next };
}

function treeLine(name: string, tree: MoveTree, overrides: Partial<Line> = {}): Line {
  return line(name, [], { tree, ...overrides });
}

/** The position after `moves` from the standard start, as chess.js writes it. */
function after(moves: string[]): string {
  const fen = fenAfter(START_FEN, moves);
  if (fen === null) throw new Error(`illegal test moves: ${moves.join(' ')}`);
  return fen;
}

describe('positionKey', () => {
  it('ignores the halfmove clock and the move number, so transpositions match', () => {
    const direct = after(['d4', 'Nf6', 'Nf3']);
    const transposed = after(['Nf3', 'Nf6', 'd4']);
    expect(direct).not.toBe(transposed); // the halfmove clocks differ
    expect(positionKey(direct)).toBe(positionKey(transposed));
  });

  it('keeps side to move, castling rights and the en-passant square', () => {
    expect(positionKey(after(['e4']))).not.toBe(positionKey(START_FEN));
    // chess.js writes an en-passant square only when the capture is actually available, which
    // here it is (the e5 pawn can take on d6). Two positions differing only in that are not
    // the same position.
    const withEp = after(['e4', 'e6', 'e5', 'd5']);
    expect(withEp.split(' ')[3]).toBe('d6');
    expect(positionKey(withEp)).not.toBe(positionKey(withEp.replace(' d6 ', ' - ')));
  });

  it('never throws on a malformed FEN', () => {
    expect(positionKey('')).toBe(' w - -');
    expect(positionKey('nonsense')).toBe('nonsense w - -');
  });
});

describe('coverageAt', () => {
  const italian = line('Italian', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']);
  const spanish = line('Spanish', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
  const scotch = line('Scotch', ['e4', 'e5', 'Nf3', 'Nc6', 'd4']);
  const french = line('French', ['e4', 'e6', 'd4']);
  const index = buildCoverageIndex([italian, spanish, scotch, french]);

  it('finds every line that reaches the position, and what each plays next', () => {
    const coverage = coverageAt(index, after(['e4', 'e5', 'Nf3', 'Nc6']));
    expect(coverage.lines.map((l) => l.name)).toEqual(['Italian', 'Scotch', 'Spanish']);
    expect(coverage.moves.map((m) => m.san)).toEqual(['Bb5', 'Bc4', 'd4']);
    expect(coverage.moves.map((m) => m.lines.map((l) => l.name))).toEqual([
      ['Spanish'],
      ['Italian'],
      ['Scotch'],
    ]);
  });

  it('orders continuations by how many lines play them', () => {
    const coverage = coverageAt(index, after(['e4']));
    expect(coverage.moves.map((m) => [m.san, m.lines.length])).toEqual([
      ['e5', 3],
      ['e6', 1],
    ]);
  });

  it('counts the start position of every line, before a single move', () => {
    const coverage = coverageAt(index, START_FEN);
    expect(coverage.lines).toHaveLength(4);
    expect(coverage.reaching.every((r) => r.ply === 0)).toBe(true);
    expect(coverage.moves.map((m) => m.san)).toEqual(['e4']);
  });

  it('reports the lines that end in the position rather than listing a next move', () => {
    const coverage = coverageAt(index, after(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']));
    expect(coverage.moves).toEqual([]);
    expect(coverage.endsHere.map((r) => r.line.name)).toEqual(['Italian']);
    expect(coverage.endsHere[0]?.ply).toBe(5);
    expect(coverage.endsHere[0]?.leaf).toBe(true);
    expect(coverage.endsHere[0]?.path).toEqual([0, 0, 0, 0, 0]);
  });

  it('matches by transposition, not by move order', () => {
    const viaC4 = line('English', ['c4', 'Nf6', 'd4', 'e6']);
    const viaD4 = line('Queens Pawn', ['d4', 'Nf6', 'c4', 'e6']);
    const both = buildCoverageIndex([viaC4, viaD4]);
    const coverage = coverageAt(both, after(['d4', 'Nf6', 'c4']));
    expect(coverage.lines.map((l) => l.name)).toEqual(['English', 'Queens Pawn']);
    expect(coverage.moves).toEqual([
      expect.objectContaining({ san: 'e6' }),
    ]);
  });

  it('is empty for a position no line reaches', () => {
    const coverage = coverageAt(index, after(['a4']));
    expect(coverage.lines).toEqual([]);
    expect(coverage.moves).toEqual([]);
    expect(coverage.reaching).toEqual([]);
  });

  it('accepts a FEN with different move counters for the same position', () => {
    const fen = after(['e4', 'e5', 'Nf3', 'Nc6']);
    const fields = fen.split(' ');
    const restated = [...fields.slice(0, 4), '17', '42'].join(' ');
    expect(coverageAt(index, restated).lines).toHaveLength(3);
  });

  it('indexes lines that start from a custom position', () => {
    const endgameFen = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
    const endgame = line('King and pawn', ['e4', 'Kd7'], { startFen: endgameFen });
    const custom = buildCoverageIndex([endgame]);
    const coverage = coverageAt(custom, endgameFen);
    expect(coverage.lines.map((l) => l.name)).toEqual(['King and pawn']);
    expect(coverage.moves.map((m) => m.san)).toEqual(['e4']);
  });

  it('counts a line that transposes into the same position twice only once', () => {
    // Knights out and back: the position after 2...Ng8 repeats the start position.
    const shuffle = line('Shuffle', ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'e4']);
    const repeats = buildCoverageIndex([shuffle]);
    const coverage = coverageAt(repeats, START_FEN);
    expect(coverage.reaching).toHaveLength(2);
    expect(coverage.lines).toHaveLength(1);
    // Tie on count, so the SAN tie-break decides: code-point order, not locale order.
    expect(coverage.moves.map((m) => [m.san, m.lines.length])).toEqual([
      ['Nf3', 1],
      ['e4', 1],
    ]);
  });
});

describe('coverageAt with moves that transpose into a line', () => {
  // Saved from the position after 1.e4 e5 2.Nf3 Nf6 3.Nxe5 Nc6 4.Nxc6 dxc6 5.d3, like the
  // Stafford files: the line never sees 5.Be2 Bc5 6.d3, which reaches the same position.
  const stafford = ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5', 'Nc6', 'Nxc6', 'dxc6'];
  const fromD3 = line('Stafford d3', ['Bc5', 'Be2', 'h5'], {
    startFen: after([...stafford, 'd3']),
  });
  const index = buildCoverageIndex([fromD3]);

  it('lists a move no reaching line plays when it lands in a saved position', () => {
    const coverage = coverageAt(index, after([...stafford, 'Be2', 'Bc5']));
    expect(coverage.reaching).toEqual([]);
    expect(coverage.moves).toEqual([
      expect.objectContaining({ san: 'd3', reaches: [], transposes: true }),
    ]);
    expect(coverage.moves[0]?.lines.map((l) => l.name)).toEqual(['Stafford d3']);
    expect(coverage.moves[0]?.transpositions[0]?.nextSan).toBe('h5');
    expect(coverageArrows(coverage, after([...stafford, 'Be2', 'Bc5']))).toEqual([
      { san: 'd3', from: 'd2', to: 'd3', weight: 1, side: 'w' },
    ]);
  });

  it('adds transposing lines to a move another line plays directly, counting each line once', () => {
    const direct = line('Main', [...stafford, 'Be2', 'Bc5', 'd3', 'Bg4']);
    const both = buildCoverageIndex([direct, fromD3]);
    const coverage = coverageAt(both, after([...stafford, 'Be2', 'Bc5']));
    expect(coverage.moves.map((m) => [m.san, m.transposes, m.lines.map((l) => l.name)])).toEqual([
      ['d3', false, ['Main', 'Stafford d3']],
    ]);
    expect(coverage.moves[0]?.transpositions.map((r) => r.line.name)).toEqual(['Stafford d3']);
  });

  it('carries the comments of the transposed-into line, from the transposing move', () => {
    const commented = treeLine('Commented', [n('Bc5', [n('Be2', [n('h5', [], 'Push')])])], {
      startFen: after([...stafford, 'd3']),
    });
    const coverage = coverageAt(
      buildCoverageIndex([commented]),
      after([...stafford, 'Be2', 'Bc5']),
    );
    expect(coverage.moves[0]?.comments.map((c) => [c.moves.join(' '), c.text])).toEqual([
      ['d3 h5', 'Push'],
    ]);
  });
});

describe('buildCoverageIndex with damaged lines', () => {
  it('indexes a broken line as far as it replays and reports where it broke', () => {
    const damaged = line('Damaged', ['e4', 'e5', 'Qxd8']);
    const index = buildCoverageIndex([damaged]);

    expect(index.broken).toEqual([{ line: damaged, failedAtPly: 2, path: [0, 0, 0] }]);
    expect(coverageAt(index, after(['e4'])).moves.map((m) => m.san)).toEqual(['e5']);

    // The position where it gives up: reached, but with no playable continuation.
    const atBreak = coverageAt(index, after(['e4', 'e5']));
    expect(atBreak.moves).toEqual([]);
    expect(atBreak.endsHere).toEqual([]);
    expect(atBreak.breaksHere.map((r) => r.line.name)).toEqual(['Damaged']);
    expect(atBreak.breaksHere[0]).toMatchObject({ brokenSan: 'Qxd8', nextPath: [0, 0, 0] });
  });

  it('keeps indexing the playable siblings of a broken move', () => {
    const damaged = treeLine('Damaged', [n('e4', [n('Qxd8'), n('c5', [n('Nf3')])])]);
    const index = buildCoverageIndex([damaged]);
    expect(index.broken).toEqual([{ line: damaged, failedAtPly: 1, path: [0, 0] }]);
    const afterE4 = coverageAt(index, after(['e4']));
    expect(afterE4.moves.map((m) => m.san)).toEqual(['c5']);
    expect(afterE4.breaksHere.map((r) => r.brokenSan)).toEqual(['Qxd8']);
    expect(coverageAt(index, after(['e4', 'c5'])).moves.map((m) => m.san)).toEqual(['Nf3']);
  });

  it('reports an illegal start position and indexes nothing for it', () => {
    const nonsense = line('Nonsense', ['e4'], { startFen: 'not a fen' });
    const index = buildCoverageIndex([nonsense, line('Good', ['e4'])]);
    expect(index.broken).toEqual([{ line: nonsense, failedAtPly: null, path: [] }]);
    expect(index.lineCount).toBe(2);
    expect(coverageAt(index, START_FEN).lines.map((l) => l.name)).toEqual(['Good']);
  });
});

describe('coverage of a branched line', () => {
  // 1.e4 e5 2.Nf3 (2.Bc4 Nf6) Nc6 — one line, two continuations after 1...e5.
  const branched = treeLine('Open games', [
    n('e4', [
      n('e5', [
        n('Nf3', [n('Nc6')], 'Develop and attack e5'),
        n('Bc4', [n('Nf6', [], 'Petroff-style counter')], 'Bishop first'),
      ]),
    ]),
  ]);

  it('covers every continuation of the tree, not just the main line', () => {
    const index = buildCoverageIndex([branched]);
    const coverage = coverageAt(index, after(['e4', 'e5']));
    expect(coverage.lines.map((l) => l.name)).toEqual(['Open games']);
    expect(coverage.moves.map((m) => [m.san, m.lines.length])).toEqual([
      ['Bc4', 1],
      ['Nf3', 1],
    ]);
    expect(coverage.reaching.map((r) => [r.nextSan, r.nextPath, r.branchCount])).toEqual([
      ['Nf3', [0, 0, 0], 2],
      ['Bc4', [0, 0, 1], 2],
    ]);
    // The side branch is indexed all the way to its leaf.
    const leaf = coverageAt(index, after(['e4', 'e5', 'Bc4', 'Nf6']));
    expect(leaf.endsHere.map((r) => [r.line.name, r.path, r.leaf, r.branchCount])).toEqual([
      ['Open games', [0, 0, 1, 0], true, 1],
    ]);
  });

  it('carries the next move\'s comment on each reach', () => {
    const coverage = coverageAt(buildCoverageIndex([branched]), after(['e4', 'e5']));
    expect(coverage.reaching.map((r) => [r.nextSan, r.comment])).toEqual([
      ['Nf3', 'Develop and attack e5'],
      ['Bc4', 'Bishop first'],
    ]);
  });

  it('groups comments per continuation, from every line that plays it', () => {
    const other = treeLine('Bishop lines', [
      n('e4', [n('e5', [n('Bc4', [n('Nc6', [n('Qh5', [], 'Scholar threat')])])])]),
    ]);
    const coverage = coverageAt(buildCoverageIndex([branched, other]), after(['e4', 'e5']));
    const bc4 = coverage.moves.find((m) => m.san === 'Bc4');
    const nf3 = coverage.moves.find((m) => m.san === 'Nf3');
    expect(bc4?.lines.map((l) => l.name)).toEqual(['Bishop lines', 'Open games']);
    // The first comment on each branch from the move on, with the moves that lead to it.
    expect(bc4?.comments.map((c) => [c.line.name, c.moves.join(' '), c.text])).toEqual([
      ['Bishop lines', 'Bc4 Nc6 Qh5', 'Scholar threat'],
      ['Open games', 'Bc4', 'Bishop first'],
    ]);
    expect(nf3?.comments.map((c) => [c.line.name, c.text])).toEqual([
      ['Open games', 'Develop and attack e5'],
    ]);
  });

  it('counts a line reaching a position along two branches with the same next move once', () => {
    // 1.Nf3 Nf6 2.d4 e6 and 1.d4 Nf6 2.Nf3 e6 — the same position, the same reply.
    const transposing = treeLine('Queen pawn', [
      n('Nf3', [n('Nf6', [n('d4', [n('e6', [], 'Solid')])])]),
      n('d4', [n('Nf6', [n('Nf3', [n('e6', [], 'Also solid')])])]),
    ]);
    const coverage = coverageAt(buildCoverageIndex([transposing]), after(['d4', 'Nf6', 'Nf3']));
    expect(coverage.reaching).toHaveLength(1);
    expect(coverage.moves).toEqual([
      expect.objectContaining({ san: 'e6', reaches: [expect.anything()] }),
    ]);
    // Both branches' comments survive the dedupe.
    expect(coverage.moves[0]?.comments.map((c) => c.text)).toEqual(['Solid', 'Also solid']);
    // Both leaves end here, but the line is named once.
    const end = coverageAt(buildCoverageIndex([transposing]), after(['d4', 'Nf6', 'Nf3', 'e6']));
    expect(end.endsHere).toHaveLength(1);
  });

  it('finds the comment on the move that led to the board position', () => {
    const index = buildCoverageIndex([branched]);
    const fen = after(['e4', 'e5', 'Bc4']);
    const before = after(['e4', 'e5']);
    expect(arrivalComments(index, fen, { san: 'Bc4', fenBefore: before })).toEqual([
      { line: branched, text: 'Bishop first' },
    ]);
    // Another move into the same position is not this move.
    expect(arrivalComments(index, fen, { san: 'Bc4', fenBefore: START_FEN })).toEqual([]);
    expect(arrivalComments(index, fen, null)).toEqual([]);
  });
});

describe('coverageArrows', () => {
  const index = buildCoverageIndex([
    line('Italian', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']),
    line('Spanish', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']),
    line('French', ['e4', 'e6', 'd4']),
    line('London', ['d4', 'd5', 'Bf4']),
  ]);

  it('turns each continuation into squares, weighted by its share of the most-played move', () => {
    const arrows = coverageArrows(coverageAt(index, START_FEN), START_FEN);
    expect(arrows).toEqual([
      { san: 'e4', from: 'e2', to: 'e4', weight: 1, side: 'w' },
      { san: 'd4', from: 'd2', to: 'd4', weight: 1 / 3, side: 'w' },
    ]);
  });

  it('draws castling as the king move', () => {
    const castled = line('Castle', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O']);
    const fen = after(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']);
    const arrows = coverageArrows(coverageAt(buildCoverageIndex([castled]), fen), fen);
    expect(arrows).toEqual([{ san: 'O-O', from: 'e1', to: 'g1', weight: 1, side: 'w' }]);
  });

  it('is empty where the repertoire says nothing', () => {
    expect(coverageArrows(EMPTY_COVERAGE, START_FEN)).toEqual([]);
  });

  it('marks each arrow with the side its lines are trained for', () => {
    const lines = [
      line('White e4', ['e4', 'e5']),
      line('Black e4', ['e4', 'c5'], { userColor: 'b' }),
      line('Black d4', ['d4', 'd5'], { userColor: 'b' }),
      line('White c4', ['c4', 'e5']),
    ];
    const arrows = coverageArrows(coverageAt(buildCoverageIndex(lines), START_FEN), START_FEN);
    expect(arrows.map((a) => [a.san, a.side])).toEqual([
      ['e4', 'both'],
      ['c4', 'w'],
      ['d4', 'b'],
    ]);
  });
});

describe('linesTrainedFor', () => {
  const white = line('White', ['e4']);
  const black = line('Black', ['e4', 'e5'], { userColor: 'b' });

  it('keeps only the lines trained for the chosen side', () => {
    expect(linesTrainedFor([white, black], 'w')).toEqual([white]);
    expect(linesTrainedFor([white, black], 'b')).toEqual([black]);
    expect(linesTrainedFor([white, black], 'both')).toEqual([white, black]);
  });
});
