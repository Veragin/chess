import { describe, expect, it } from 'vitest';
import { START_FEN } from './position';
import {
  applyMove,
  colorAt,
  createHistory,
  currentFen,
  historyFromSan,
  isAtEnd,
  isAtStart,
  jumpTo,
  lastMoveOf,
  moveCount,
  moveNumberFor,
  sansOf,
  sideToMove,
  startColor,
  stepBack,
  stepForward,
  toEnd,
  toStart,
  type HistoryState,
} from './history';

/** 1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 — Spanish, Morphy Defence. */
const SPANISH = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'];

/** FEN after each of the moves above, verified against chess.js. */
const SPANISH_FENS = [
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
  'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
  'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',
  'r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4',
];

const CASTLING_FEN = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1';
const PROMOTION_FEN = '8/P6k/8/8/8/8/8/K7 w - - 0 1';
/** Standard start plus 1. e4 — Black to move, so the first entry is "1... e5". */
const BLACK_TO_MOVE_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

/** Applies SAN moves in order, failing the test if any is rejected. */
function play(h: HistoryState, sans: string[]): HistoryState {
  let cur = h;
  for (const san of sans) {
    const next = applyMove(cur, san);
    expect(next, `expected ${san} to be legal`).not.toBeNull();
    cur = next as HistoryState;
  }
  return cur;
}

function spanish(): HistoryState {
  return play(createHistory(START_FEN), SPANISH);
}

describe('createHistory', () => {
  it('starts empty with the cursor at the start position', () => {
    const h = createHistory(START_FEN);
    expect(h.entries).toEqual([]);
    expect(h.cursor).toBe(-1);
    expect(currentFen(h)).toBe(START_FEN);
    expect(isAtStart(h)).toBe(true);
    expect(isAtEnd(h)).toBe(true);
    expect(startColor(h)).toBe('w');
  });

  it('records a custom start position with Black to move', () => {
    const h = createHistory(BLACK_TO_MOVE_FEN);
    expect(h.startFen).toBe(BLACK_TO_MOVE_FEN);
    expect(startColor(h)).toBe('b');
    expect(sideToMove(h)).toBe('b');
  });

  it('does not throw on an unparseable FEN and refuses every move', () => {
    const h = createHistory('not a fen');
    expect(h.entries).toEqual([]);
    expect(applyMove(h, 'e4')).toBeNull();
  });
});

describe('applyMove', () => {
  it('appends entries with the SAN and the resulting FEN', () => {
    const h = spanish();
    expect(sansOf(h)).toEqual(SPANISH);
    expect(h.entries.map((e) => e.fenAfter)).toEqual(SPANISH_FENS);
    expect(h.cursor).toBe(5);
    expect(currentFen(h)).toBe(SPANISH_FENS[5]);
    expect(isAtEnd(h)).toBe(true);
  });

  it('accepts a from/to move input as well as SAN', () => {
    const h = applyMove(createHistory(START_FEN), { from: 'e2', to: 'e4' });
    expect(h).not.toBeNull();
    expect(sansOf(h as HistoryState)).toEqual(['e4']);
    expect(currentFen(h as HistoryState)).toBe(SPANISH_FENS[0]);
  });

  it('returns null for an illegal move and leaves the input untouched', () => {
    const h = spanish();
    const before = structuredClone(h);

    expect(applyMove(h, 'e5')).toBeNull(); // occupied / not legal here
    expect(applyMove(h, 'Qz9')).toBeNull(); // nonsense SAN
    expect(applyMove(h, { from: 'e4', to: 'e8' })).toBeNull(); // illegal geometry
    expect(applyMove(h, '')).toBeNull();

    expect(h).toEqual(before);
  });

  it('applies from the position at the cursor when the start FEN has Black to move', () => {
    const h = createHistory(BLACK_TO_MOVE_FEN);
    expect(h.cursor).toBe(-1);

    // White's e4 is not available — it is Black's turn.
    expect(applyMove(h, 'e4')).toBeNull();

    const after = play(h, ['e5', 'Nf3']);
    expect(sansOf(after)).toEqual(['e5', 'Nf3']);
    expect(after.entries[0]?.fenAfter).toBe(
      'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    );
    expect(after.entries[1]?.fenAfter).toBe(
      'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
    );
  });

  it('truncates the future when a move is made mid-history', () => {
    const h = spanish();
    const atMove3 = jumpTo(h, 2); // after 2. Nf3
    const branched = applyMove(atMove3, 'd6'); // instead of 2... Nc6

    expect(branched).not.toBeNull();
    const b = branched as HistoryState;
    expect(sansOf(b)).toEqual(['e4', 'e5', 'Nf3', 'd6']);
    expect(b.cursor).toBe(3);
    expect(moveCount(b)).toBe(4);

    // The original history is untouched — no branching, no mutation.
    expect(sansOf(h)).toEqual(SPANISH);
    expect(h.cursor).toBe(5);
  });

  it('truncates everything when a move is made from the start position', () => {
    const h = spanish();
    const fresh = applyMove(toStart(h), 'd4');
    expect(fresh).not.toBeNull();
    expect(sansOf(fresh as HistoryState)).toEqual(['d4']);
    expect((fresh as HistoryState).cursor).toBe(0);
    expect(sansOf(h)).toEqual(SPANISH);
  });
});

describe('navigation', () => {
  it('leaves the move list unchanged across a full back-and-forward sweep', () => {
    const h = spanish();
    const snapshot = structuredClone(h.entries);

    let cur: HistoryState = h;
    for (let i = 0; i < SPANISH.length + 2; i++) cur = stepBack(cur);
    expect(cur.cursor).toBe(-1);
    expect(cur.entries).toEqual(snapshot);

    for (let i = 0; i < SPANISH.length + 2; i++) cur = stepForward(cur);
    expect(cur.cursor).toBe(SPANISH.length - 1);
    expect(cur.entries).toEqual(snapshot);

    // The original object was not mutated, and no state shares entry objects with it.
    expect(h.entries).toEqual(snapshot);
    expect(h.cursor).toBe(SPANISH.length - 1);
    expect(cur.entries).not.toBe(h.entries);
    expect(cur.entries[0]).not.toBe(h.entries[0]);
  });

  it('yields the right FEN for every cursor position', () => {
    const h = spanish();
    expect(currentFen(toStart(h))).toBe(START_FEN);
    for (let i = 0; i < SPANISH.length; i++) {
      expect(currentFen(jumpTo(h, i))).toBe(SPANISH_FENS[i]);
    }
  });

  it('clamps out-of-range cursors instead of throwing', () => {
    const h = spanish();
    expect(jumpTo(h, 99).cursor).toBe(5);
    expect(jumpTo(h, -50).cursor).toBe(-1);
    expect(jumpTo(h, Number.NaN).cursor).toBe(-1);
    expect(jumpTo(h, 2.7).cursor).toBe(2);
    expect(jumpTo(h, 99).entries).toEqual(h.entries);

    const empty = createHistory(START_FEN);
    expect(jumpTo(empty, 3).cursor).toBe(-1);
    expect(currentFen(jumpTo(empty, 3))).toBe(START_FEN);
  });

  it('saturates at the boundaries', () => {
    const h = spanish();
    expect(stepBack(toStart(h)).cursor).toBe(-1);
    expect(stepForward(toEnd(h)).cursor).toBe(5);

    const empty = createHistory(START_FEN);
    expect(stepBack(empty).cursor).toBe(-1);
    expect(stepForward(empty).cursor).toBe(-1);
  });

  it('toStart / toEnd jump the whole way', () => {
    const h = jumpTo(spanish(), 2);
    expect(toStart(h).cursor).toBe(-1);
    expect(isAtStart(toStart(h))).toBe(true);
    expect(toEnd(h).cursor).toBe(5);
    expect(isAtEnd(toEnd(h))).toBe(true);
    expect(currentFen(toEnd(h))).toBe(SPANISH_FENS[5]);
    expect(toEnd(h).entries).toEqual(h.entries);
  });

  it('reports the side to move at the cursor', () => {
    const h = spanish();
    expect(sideToMove(toStart(h))).toBe('w');
    expect(sideToMove(jumpTo(h, 0))).toBe('b');
    expect(sideToMove(jumpTo(h, 1))).toBe('w');
    expect(sideToMove(toEnd(h))).toBe('w');

    const black = play(createHistory(BLACK_TO_MOVE_FEN), ['e5']);
    expect(sideToMove(toStart(black))).toBe('b');
    expect(sideToMove(black)).toBe('w');
  });
});

describe('move numbering', () => {
  it('numbers a White-first history in pairs', () => {
    const h = spanish();
    expect(SPANISH.map((_, i) => moveNumberFor(h, i))).toEqual([1, 1, 2, 2, 3, 3]);
    expect(SPANISH.map((_, i) => colorAt(h, i))).toEqual(['w', 'b', 'w', 'b', 'w', 'b']);
  });

  it('numbers a Black-first history so the first entry is Black of move 1', () => {
    const h = play(createHistory(BLACK_TO_MOVE_FEN), ['e5', 'Nf3', 'Nc6', 'Bb5']);
    expect([0, 1, 2, 3].map((i) => moveNumberFor(h, i))).toEqual([1, 2, 2, 3]);
    expect([0, 1, 2, 3].map((i) => colorAt(h, i))).toEqual(['b', 'w', 'b', 'w']);
  });

  it('honours the full-move number in the start FEN', () => {
    const h = play(
      createHistory('r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4'),
      ['Ba4', 'Nf6'],
    );
    expect([0, 1].map((i) => moveNumberFor(h, i))).toEqual([4, 4]);
  });
});

describe('lastMoveOf', () => {
  it('is null at the start position', () => {
    expect(lastMoveOf(createHistory(START_FEN))).toBeNull();
    expect(lastMoveOf(toStart(spanish()))).toBeNull();
  });

  it('returns the from/to squares of the move at the cursor', () => {
    const h = spanish();
    expect(lastMoveOf(h)).toEqual({ from: 'a7', to: 'a6' });
    expect(lastMoveOf(jumpTo(h, 0))).toEqual({ from: 'e2', to: 'e4' });
    expect(lastMoveOf(jumpTo(h, 2))).toEqual({ from: 'g1', to: 'f3' });
    expect(lastMoveOf(jumpTo(h, 4))).toEqual({ from: 'f1', to: 'b5' });
  });

  it('returns the king squares for both castlings', () => {
    const kingside = play(createHistory(CASTLING_FEN), ['O-O']);
    expect(lastMoveOf(kingside)).toEqual({ from: 'e1', to: 'g1' });

    const queenside = play(kingside, ['O-O-O']);
    expect(lastMoveOf(queenside)).toEqual({ from: 'e8', to: 'c8' });
    // and stepping back still reports White's castling
    expect(lastMoveOf(stepBack(queenside))).toEqual({ from: 'e1', to: 'g1' });
  });

  it('returns the pawn squares for a promotion', () => {
    const h = applyMove(createHistory(PROMOTION_FEN), { from: 'a7', to: 'a8', promotion: 'q' });
    expect(h).not.toBeNull();
    expect(sansOf(h as HistoryState)).toEqual(['a8=Q']);
    expect(lastMoveOf(h as HistoryState)).toEqual({ from: 'a7', to: 'a8' });
  });
});

describe('historyFromSan', () => {
  it('replays a legal sequence with the cursor at the end', () => {
    const h = historyFromSan(START_FEN, SPANISH);
    expect(h).not.toBeNull();
    expect(sansOf(h as HistoryState)).toEqual(SPANISH);
    expect((h as HistoryState).entries.map((e) => e.fenAfter)).toEqual(SPANISH_FENS);
    expect((h as HistoryState).cursor).toBe(5);
  });

  it('returns null if any move is illegal', () => {
    // 3. Qh5 is fine, 3... Qh4 is not: the black queen's diagonal is blocked by the f-pawn.
    expect(historyFromSan(START_FEN, ['e4', 'd5', 'Qh5', 'Qh4'])).toBeNull();
    expect(historyFromSan('not a fen', [])).toBeNull();
  });

  it('accepts an empty move list', () => {
    const h = historyFromSan(START_FEN, []);
    expect(h).not.toBeNull();
    expect((h as HistoryState).cursor).toBe(-1);
    expect(currentFen(h as HistoryState)).toBe(START_FEN);
  });
});
