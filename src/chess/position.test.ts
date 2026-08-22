import { describe, expect, it } from 'vitest';
import {
  coordsToSquare,
  EMPTY_FEN,
  fileLabels,
  flipOrientation,
  isSquare,
  isValidFen,
  orderedSquares,
  rankLabels,
  squareShade,
  squareToCoords,
  START_FEN,
  type Orientation,
} from './position';

describe('isValidFen', () => {
  it('accepts the standard start and empty positions', () => {
    expect(isValidFen(START_FEN)).toEqual({ valid: true });
    expect(isValidFen(EMPTY_FEN)).toEqual({ valid: true });
  });

  it('accepts a position with an en-passant target consistent with the side to move', () => {
    expect(
      isValidFen('rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR w KQkq e6 0 2').valid,
    ).toBe(true);
    expect(
      isValidFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1').valid,
    ).toBe(true);
  });

  it('rejects a wrong number of fields', () => {
    expect(isValidFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -').valid).toBe(false);
    expect(isValidFen('').valid).toBe(false);
    expect(isValidFen('nonsense').valid).toBe(false);
  });

  it('rejects a wrong rank count', () => {
    const r = isValidFen('rnbqkbnr/pppppppp/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/8 ranks/);
  });

  it('rejects ranks that do not sum to 8 squares', () => {
    const short = isValidFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN w KQkq - 0 1');
    expect(short.valid).toBe(false);
    expect(short.error).toMatch(/7 squares/);

    const long = isValidFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNRR w KQkq - 0 1');
    expect(long.valid).toBe(false);
    expect(long.error).toMatch(/9 squares/);
  });

  it('rejects invalid piece characters and consecutive digits', () => {
    expect(isValidFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNX w KQkq - 0 1').valid).toBe(
      false,
    );
    const consecutive = isValidFen('44/8/8/8/8/8/8/8 w - - 0 1');
    expect(consecutive.valid).toBe(false);
    expect(consecutive.error).toMatch(/consecutive digits/);
  });

  it('rejects a bad side-to-move token', () => {
    const r = isValidFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/Side to move/);
  });

  it('rejects a bad castling token', () => {
    expect(isValidFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkqX - 0 1').valid).toBe(
      false,
    );
    // Out of canonical KQkq order is also rejected.
    expect(isValidFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w qKQk - 0 1').valid).toBe(
      false,
    );
    expect(isValidFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1').valid).toBe(true);
    expect(isValidFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w Kq - 0 1').valid).toBe(true);
  });

  it('rejects a bad en-passant token', () => {
    expect(isValidFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq z9 0 1').valid).toBe(
      false,
    );
    // Rank 4 is never a valid en-passant target.
    expect(isValidFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq e4 0 1').valid).toBe(
      false,
    );
    // Rank 3 target with White to move is inconsistent.
    const inconsistent = isValidFen(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq e3 0 1',
    );
    expect(inconsistent.valid).toBe(false);
    expect(inconsistent.error).toMatch(/inconsistent/);
  });

  it('rejects non-numeric or zero move counters', () => {
    expect(isValidFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - x 1').valid).toBe(
      false,
    );
    expect(isValidFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 x').valid).toBe(
      false,
    );
    expect(isValidFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 0').valid).toBe(
      false,
    );
    expect(isValidFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - -1 1').valid).toBe(
      false,
    );
  });

  it('does not depend on chess-rule legality', () => {
    // Structurally fine, rule-illegal (no kings at all) — that is game.ts's job.
    expect(isValidFen('8/8/8/8/8/8/8/QQQQQQQQ w - - 0 1').valid).toBe(true);
  });
});

describe('square <-> coords', () => {
  it('maps corners', () => {
    expect(squareToCoords('a1')).toEqual({ file: 0, rank: 0 });
    expect(squareToCoords('h8')).toEqual({ file: 7, rank: 7 });
    expect(squareToCoords('e4')).toEqual({ file: 4, rank: 3 });
    expect(coordsToSquare(0, 0)).toBe('a1');
    expect(coordsToSquare(7, 7)).toBe('h8');
    expect(coordsToSquare(4, 3)).toBe('e4');
  });

  it('round-trips all 64 squares', () => {
    for (const sq of orderedSquares('white')) {
      const { file, rank } = squareToCoords(sq);
      expect(coordsToSquare(file, rank)).toBe(sq);
    }
  });

  it('throws on out-of-range input', () => {
    expect(() => squareToCoords('j9')).toThrow();
    expect(() => coordsToSquare(-1, 0)).toThrow();
    expect(() => coordsToSquare(0, 8)).toThrow();
    expect(() => coordsToSquare(1.5, 0)).toThrow();
  });
});

describe('isSquare', () => {
  it('accepts algebraic squares only', () => {
    expect(isSquare('a1')).toBe(true);
    expect(isSquare('h8')).toBe(true);
    expect(isSquare('A1')).toBe(false);
    expect(isSquare('i1')).toBe(false);
    expect(isSquare('a9')).toBe(false);
    expect(isSquare('a')).toBe(false);
    expect(isSquare('a11')).toBe(false);
    expect(isSquare('')).toBe(false);
  });
});

describe('squareShade', () => {
  it('matches the real board colouring', () => {
    expect(squareShade('a1')).toBe('dark');
    expect(squareShade('h1')).toBe('light');
    expect(squareShade('a8')).toBe('light');
    expect(squareShade('h8')).toBe('dark');
    expect(squareShade('e4')).toBe('light');
    expect(squareShade('d4')).toBe('dark');
  });

  it('alternates between horizontally adjacent squares', () => {
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 7; file++) {
        expect(squareShade(coordsToSquare(file, rank))).not.toBe(
          squareShade(coordsToSquare(file + 1, rank)),
        );
      }
    }
  });
});

describe('orientation mapping', () => {
  const orientations: Orientation[] = ['white', 'black'];

  it('renders 64 unique squares in both orientations', () => {
    for (const o of orientations) {
      const squares = orderedSquares(o);
      expect(squares).toHaveLength(64);
      expect(new Set(squares).size).toBe(64);
    }
  });

  it('puts the expected square top-left and bottom-right', () => {
    const white = orderedSquares('white');
    expect(white[0]).toBe('a8');
    expect(white[7]).toBe('h8');
    expect(white[56]).toBe('a1');
    expect(white[63]).toBe('h1');

    const black = orderedSquares('black');
    expect(black[0]).toBe('h1');
    expect(black[7]).toBe('a1');
    expect(black[56]).toBe('h8');
    expect(black[63]).toBe('a8');
  });

  it('is its own inverse: reversing one orientation yields the other', () => {
    expect([...orderedSquares('white')].reverse()).toEqual(orderedSquares('black'));
    expect([...orderedSquares('black')].reverse()).toEqual(orderedSquares('white'));
  });

  it('flipOrientation is an involution', () => {
    for (const o of orientations) {
      expect(flipOrientation(flipOrientation(o))).toBe(o);
      expect(flipOrientation(o)).not.toBe(o);
      // ...and so is the square ordering it induces.
      expect(orderedSquares(flipOrientation(flipOrientation(o)))).toEqual(orderedSquares(o));
    }
  });

  it('gives labels in render order consistent with orderedSquares', () => {
    for (const o of orientations) {
      const squares = orderedSquares(o);
      const files = fileLabels(o);
      const ranks = rankLabels(o);
      expect(files).toHaveLength(8);
      expect(ranks).toHaveLength(8);
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          expect(squares[row * 8 + col]).toBe(`${files[col] as string}${ranks[row] as string}`);
        }
      }
    }
  });

  it('label lists are also mirror images of each other', () => {
    expect([...fileLabels('white')].reverse()).toEqual(fileLabels('black'));
    expect([...rankLabels('white')].reverse()).toEqual(rankLabels('black'));
  });
});
