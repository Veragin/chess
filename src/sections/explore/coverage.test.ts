import { describe, expect, it } from 'vitest';
import { fenAfter } from '../../chess/game';
import { START_FEN } from '../../chess/position';
import type { Line } from '../../storage/schema';
import { buildCoverageIndex, coverageAt, positionKey } from './coverage';

function line(name: string, moves: string[], overrides: Partial<Line> = {}): Line {
  return {
    id: `id-${name}`,
    name,
    startFen: START_FEN,
    moves,
    userColor: 'w',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
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
    expect(coverage.endsHere[0]?.total).toBe(5);
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

describe('buildCoverageIndex with damaged lines', () => {
  it('indexes a broken line as far as it replays and reports where it broke', () => {
    const damaged = line('Damaged', ['e4', 'e5', 'Qxd8']);
    const index = buildCoverageIndex([damaged]);

    expect(index.broken).toEqual([{ line: damaged, failedAtPly: 2 }]);
    expect(coverageAt(index, after(['e4'])).moves.map((m) => m.san)).toEqual(['e5']);

    // The position where it gives up: reached, but with no playable continuation.
    const atBreak = coverageAt(index, after(['e4', 'e5']));
    expect(atBreak.moves).toEqual([]);
    expect(atBreak.endsHere).toEqual([]);
    expect(atBreak.breaksHere.map((r) => r.line.name)).toEqual(['Damaged']);
  });

  it('reports an illegal start position and indexes nothing for it', () => {
    const nonsense = line('Nonsense', ['e4'], { startFen: 'not a fen' });
    const index = buildCoverageIndex([nonsense, line('Good', ['e4'])]);
    expect(index.broken).toEqual([{ line: nonsense, failedAtPly: null }]);
    expect(index.lineCount).toBe(2);
    expect(coverageAt(index, START_FEN).lines.map((l) => l.name)).toEqual(['Good']);
  });
});
