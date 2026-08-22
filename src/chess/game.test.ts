import { describe, expect, it } from 'vitest';
import {
  createGame,
  fenAfter,
  pvToSan,
  replaySan,
  sanToUci,
  uciToSan,
  validateFenRules,
} from './game';
import { EMPTY_FEN, START_FEN } from './position';

/** White knight on e2 is pinned to the king on e1 by the black rook on e8. */
const PINNED_KNIGHT_FEN = '4r2k/8/8/8/8/8/4N3/4K3 w - - 0 1';
/** Both sides can castle either way; nothing in between. */
const CASTLING_FEN = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1';
/**
 * White pawn on g7 is one move from promoting, with a black rook on h8 to capture.
 * The black king sits on a4 so that no promotion choice delivers check — that keeps the
 * expected SAN free of a '+' suffix.
 */
const PROMOTION_FEN = '7r/6P1/8/8/k7/8/8/4K3 w - - 0 1';
/** Black king is stalemated: not in check, no legal move. */
const STALEMATE_FEN = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';

describe('createGame', () => {
  it('defaults to the standard start position', () => {
    expect(createGame().fen()).toBe(START_FEN);
    expect(createGame().turn()).toBe('w');
  });

  it('loads a supplied FEN', () => {
    const g = createGame(CASTLING_FEN);
    expect(g.fen()).toBe(CASTLING_FEN);
  });

  it('throws on a structurally unparseable FEN', () => {
    expect(() => createGame('not a fen')).toThrow();
    expect(() => createGame('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq - 0 1')).toThrow();
  });

  it('lists all 32 pieces at the start', () => {
    const pieces = createGame().pieces();
    expect(pieces).toHaveLength(32);
    expect(pieces.filter((p) => p.color === 'w')).toHaveLength(16);
    expect(pieces.find((p) => p.square === 'e1')).toEqual({
      square: 'e1',
      color: 'w',
      type: 'k',
    });
  });

  it('starts with an empty SAN history', () => {
    expect(createGame().history()).toEqual([]);
  });
});

describe('legal move generation', () => {
  it('offers 20 moves from the start position', () => {
    expect(createGame().legalMoves()).toHaveLength(20);
  });

  it('gives a pinned knight no moves at all', () => {
    const g = createGame(PINNED_KNIGHT_FEN);
    expect(g.legalMovesFrom('e2')).toEqual([]);
    // The king can still step off the file, so the position is not mate.
    const kingMoves = g.legalMovesFrom('e1').map((m) => m.to).sort();
    expect(kingMoves).toEqual(['d1', 'd2', 'f1', 'f2']);
    expect(g.status().isCheckmate).toBe(false);
  });

  it('still allows a pinned piece to move along the pin line', () => {
    // The rook on e2 is pinned by the rook on e8 but may move up and down the e-file.
    const g = createGame('4r2k/8/8/8/8/8/4R3/4K3 w - - 0 1');
    const tos = g.legalMovesFrom('e2').map((m) => m.to).sort();
    expect(tos).toEqual(['e3', 'e4', 'e5', 'e6', 'e7', 'e8']);
  });

  it('returns nothing for a square with no piece or a bad square', () => {
    const g = createGame();
    expect(g.legalMovesFrom('e5')).toEqual([]);
    expect(g.legalMovesFrom('zz')).toEqual([]);
  });

  it('flags captures, en-passant and castling on the move records', () => {
    const g = createGame(CASTLING_FEN);
    const castles = g.legalMoves().filter((m) => m.isKingsideCastle || m.isQueensideCastle);
    expect(castles.map((m) => m.san).sort()).toEqual(['O-O', 'O-O-O']);
    expect(castles.every((m) => !m.isCapture && !m.isEnPassant)).toBe(true);
  });
});

describe('applying moves', () => {
  it('applies a SAN move and records history', () => {
    const g = createGame();
    const m = g.move('e4');
    expect(m).not.toBeNull();
    expect(m?.san).toBe('e4');
    expect(m?.from).toBe('e2');
    expect(m?.to).toBe('e4');
    expect(g.turn()).toBe('b');
    expect(g.history()).toEqual(['e4']);
  });

  it('applies a from/to move', () => {
    const g = createGame();
    const m = g.move({ from: 'g1', to: 'f3' });
    expect(m?.san).toBe('Nf3');
    expect(m?.piece).toBe('n');
  });

  it('rejects an illegal move and leaves state untouched', () => {
    const g = createGame();
    const before = g.fen();
    expect(g.move('e5')).toBeNull();
    expect(g.move({ from: 'e2', to: 'e5' })).toBeNull();
    expect(g.move({ from: 'e4', to: 'e5' })).toBeNull();
    expect(g.move('Kd8')).toBeNull();
    expect(g.fen()).toBe(before);
    expect(g.turn()).toBe('w');
    expect(g.history()).toEqual([]);
  });

  it('rejects malformed move input without flipping the turn', () => {
    const g = createGame();
    const before = g.fen();
    // chess.js treats `null` / '--' as a turn-flipping null move; the wrapper must not.
    expect(g.move('--')).toBeNull();
    expect(g.move('')).toBeNull();
    expect(g.move('   ')).toBeNull();
    expect(g.move({ from: 'zz', to: 'e4' })).toBeNull();
    expect(g.move({ from: 'e2', to: 'e4', promotion: 'k' as 'q' })).toBeNull();
    expect(g.fen()).toBe(before);
    expect(g.turn()).toBe('w');
  });

  it('undoes the last move', () => {
    const g = createGame();
    g.move('e4');
    const undone = g.undo();
    expect(undone?.san).toBe('e4');
    expect(g.fen()).toBe(START_FEN);
    expect(g.undo()).toBeNull();
  });

  it('clones without sharing state', () => {
    const g = createGame();
    g.move('e4');
    const copy = g.clone();
    expect(copy.fen()).toBe(g.fen());
    expect(copy.history()).toEqual(['e4']);
    copy.move('e5');
    expect(copy.fen()).not.toBe(g.fen());
    expect(g.history()).toEqual(['e4']);
  });
});

describe('promotion', () => {
  it('detects promotion candidates', () => {
    const g = createGame(PROMOTION_FEN);
    expect(g.isPromotion('g7', 'g8')).toBe(true);
    expect(g.isPromotion('g7', 'h8')).toBe(true);
    expect(g.isPromotion('e1', 'e2')).toBe(false);
    expect(g.isPromotion('g7', 'g6')).toBe(false);
    expect(g.isPromotion('zz', 'g8')).toBe(false);
  });

  it('produces the requested piece', () => {
    for (const [promotion, san] of [
      ['q', 'g8=Q'],
      ['r', 'g8=R'],
      ['b', 'g8=B'],
      ['n', 'g8=N'],
    ] as const) {
      const g = createGame(PROMOTION_FEN);
      const m = g.move({ from: 'g7', to: 'g8', promotion });
      expect(m?.san).toBe(san);
      expect(m?.promotion).toBe(promotion);
      const promoted = g.pieces().find((p) => p.square === 'g8');
      expect(promoted).toEqual({ square: 'g8', color: 'w', type: promotion });
    }
  });

  it('produces the right piece on a capture-promotion', () => {
    const g = createGame(PROMOTION_FEN);
    const m = g.move({ from: 'g7', to: 'h8', promotion: 'n' });
    expect(m?.san).toBe('gxh8=N');
    expect(m?.captured).toBe('r');
    expect(m?.isCapture).toBe(true);
    expect(g.pieces().find((p) => p.square === 'h8')).toEqual({
      square: 'h8',
      color: 'w',
      type: 'n',
    });
  });

  it('refuses a promotion move that omits the piece choice, leaving state untouched', () => {
    // chess.js throws rather than defaulting, so the UI must resolve the choice first.
    const g = createGame(PROMOTION_FEN);
    expect(g.move({ from: 'g7', to: 'g8' })).toBeNull();
    expect(g.fen()).toBe(PROMOTION_FEN);
  });
});

describe('en passant', () => {
  it('applies an en-passant capture and removes the captured pawn', () => {
    const g = createGame();
    for (const san of ['e4', 'd5', 'e5', 'f5']) {
      expect(g.move(san)).not.toBeNull();
    }
    const ep = g.legalMovesFrom('e5').find((m) => m.isEnPassant);
    expect(ep).toBeDefined();
    expect(ep?.to).toBe('f6');
    expect(ep?.san).toBe('exf6');

    const applied = g.move({ from: 'e5', to: 'f6' });
    expect(applied?.isEnPassant).toBe(true);
    // chess.js reports isCapture() === false here; the wrapper normalises it to true.
    expect(applied?.isCapture).toBe(true);
    expect(applied?.captured).toBe('p');
    // The captured pawn stood on f5, not on the destination square.
    expect(g.pieces().find((p) => p.square === 'f5')).toBeUndefined();
    expect(g.pieces().find((p) => p.square === 'f6')).toEqual({
      square: 'f6',
      color: 'w',
      type: 'p',
    });
  });

  it('loses the en-passant right after an intervening move', () => {
    const g = createGame();
    for (const san of ['e4', 'd5', 'e5', 'f5', 'Nf3', 'Nf6']) {
      expect(g.move(san)).not.toBeNull();
    }
    expect(g.legalMovesFrom('e5').some((m) => m.isEnPassant)).toBe(false);
  });
});

describe('castling', () => {
  it('applies kingside castling, moving both king and rook', () => {
    const g = createGame(CASTLING_FEN);
    const m = g.move('O-O');
    expect(m?.san).toBe('O-O');
    expect(m?.isKingsideCastle).toBe(true);
    expect(m?.from).toBe('e1');
    expect(m?.to).toBe('g1');
    const at = (sq: string) => g.pieces().find((p) => p.square === sq);
    expect(at('g1')).toEqual({ square: 'g1', color: 'w', type: 'k' });
    expect(at('f1')).toEqual({ square: 'f1', color: 'w', type: 'r' });
    expect(at('e1')).toBeUndefined();
    expect(at('h1')).toBeUndefined();
  });

  it('applies queenside castling, moving both king and rook', () => {
    const g = createGame(CASTLING_FEN);
    const m = g.move('O-O-O');
    expect(m?.san).toBe('O-O-O');
    expect(m?.isQueensideCastle).toBe(true);
    expect(m?.to).toBe('c1');
    const at = (sq: string) => g.pieces().find((p) => p.square === sq);
    expect(at('c1')).toEqual({ square: 'c1', color: 'w', type: 'k' });
    expect(at('d1')).toEqual({ square: 'd1', color: 'w', type: 'r' });
    expect(at('a1')).toBeUndefined();
    expect(at('e1')).toBeUndefined();
  });

  it('castles via from/to as well, and both colours work', () => {
    const g = createGame(CASTLING_FEN);
    expect(g.move({ from: 'e1', to: 'g1' })?.san).toBe('O-O');
    expect(g.move({ from: 'e8', to: 'c8' })?.san).toBe('O-O-O');
    expect(g.pieces().find((p) => p.square === 'c8')?.type).toBe('k');
    expect(g.pieces().find((p) => p.square === 'd8')?.type).toBe('r');
  });

  it('refuses castling out of check', () => {
    // Black rook on e2 checks the white king on e1.
    const inCheck = createGame('r3k2r/8/8/8/8/8/4r3/R3K2R w KQ - 0 1');
    expect(inCheck.status().inCheck).toBe(true);
    expect(inCheck.move('O-O')).toBeNull();
    expect(inCheck.move('O-O-O')).toBeNull();
  });
});

describe('status', () => {
  it('reports a quiet position', () => {
    const s = createGame().status();
    expect(s).toEqual({
      turn: 'w',
      inCheck: false,
      isCheckmate: false,
      isStalemate: false,
      isDraw: false,
      isInsufficientMaterial: false,
      isThreefoldRepetition: false,
      isGameOver: false,
      checkedKingSquare: null,
    });
  });

  it('detects checkmate and names the checked king square', () => {
    const g = createGame();
    for (const san of ['f3', 'e5', 'g4', 'Qh4#']) {
      expect(g.move(san)).not.toBeNull();
    }
    const s = g.status();
    expect(s.isCheckmate).toBe(true);
    expect(s.inCheck).toBe(true);
    expect(s.isGameOver).toBe(true);
    expect(s.isStalemate).toBe(false);
    expect(s.turn).toBe('w');
    expect(s.checkedKingSquare).toBe('e1');
    expect(g.legalMoves()).toEqual([]);
  });

  it('detects stalemate', () => {
    const s = createGame(STALEMATE_FEN).status();
    expect(s.isStalemate).toBe(true);
    expect(s.isDraw).toBe(true);
    expect(s.isGameOver).toBe(true);
    expect(s.isCheckmate).toBe(false);
    expect(s.inCheck).toBe(false);
    expect(s.checkedKingSquare).toBeNull();
    expect(createGame(STALEMATE_FEN).legalMoves()).toEqual([]);
  });

  it('detects insufficient material', () => {
    const s = createGame('4k3/8/8/8/8/8/8/4K1N1 w - - 0 1').status();
    expect(s.isInsufficientMaterial).toBe(true);
    expect(s.isDraw).toBe(true);
  });

  it('detects a plain check', () => {
    const s = createGame('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1').status();
    expect(s.inCheck).toBe(true);
    expect(s.isCheckmate).toBe(false);
    expect(s.checkedKingSquare).toBe('e1');
  });
});

describe('validateFenRules', () => {
  it('accepts the standard start position and a normal middlegame position', () => {
    expect(validateFenRules(START_FEN)).toEqual({ valid: true });
    expect(validateFenRules(CASTLING_FEN).valid).toBe(true);
  });

  it('rejects a position with no king', () => {
    const r = validateFenRules('8/8/8/4p3/8/8/8/8 w - - 0 1');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/king/i);
    expect(validateFenRules(EMPTY_FEN).valid).toBe(false);
    expect(validateFenRules('4k3/8/8/8/8/8/8/8 w - - 0 1').valid).toBe(false);
  });

  it('rejects two white kings', () => {
    const r = validateFenRules('4k3/8/8/8/8/8/8/K3K3 w - - 0 1');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/king/i);
  });

  it('rejects a pawn on the first or eighth rank', () => {
    expect(validateFenRules('4k2P/8/8/8/8/8/8/4K3 w - - 0 1').valid).toBe(false);
    expect(validateFenRules('4k3/8/8/8/8/8/8/4K2p w - - 0 1').valid).toBe(false);
  });

  it('rejects an impossible check: the side not to move is in check', () => {
    const r = validateFenRules('4k3/8/8/8/8/8/4r3/4K3 b - - 0 1');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/check/i);
    // The same position with White to move is perfectly legal.
    expect(validateFenRules('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1').valid).toBe(true);
  });

  it('rejects adjacent kings', () => {
    // chess.js validateFen() accepts this; the extra check in game.ts catches it.
    const r = validateFenRules('8/8/8/8/8/8/8/Kk6 w - - 0 1');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/adjacent/i);
  });

  it('rejects a structurally broken FEN with the structural error', () => {
    const r = validateFenRules('garbage');
    expect(r.valid).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('rejects an inconsistent en-passant square', () => {
    expect(validateFenRules('4k3/8/8/8/8/8/8/4K3 w - e3 0 1').valid).toBe(false);
  });
});

describe('sanToUci / uciToSan', () => {
  it('converts both ways', () => {
    expect(sanToUci(START_FEN, 'e4')).toBe('e2e4');
    expect(sanToUci(START_FEN, 'Nf3')).toBe('g1f3');
    expect(uciToSan(START_FEN, 'e2e4')).toBe('e4');
    expect(uciToSan(START_FEN, 'g1f3')).toBe('Nf3');
  });

  it('handles promotions', () => {
    expect(sanToUci(PROMOTION_FEN, 'g8=N')).toBe('g7g8n');
    expect(uciToSan(PROMOTION_FEN, 'g7g8q')).toBe('g8=Q');
    expect(uciToSan(PROMOTION_FEN, 'g7h8r')).toBe('gxh8=R');
  });

  it('handles castling in UCI king-move form', () => {
    expect(uciToSan(CASTLING_FEN, 'e1g1')).toBe('O-O');
    expect(sanToUci(CASTLING_FEN, 'O-O-O')).toBe('e1c1');
  });

  it('returns null for illegal or malformed input', () => {
    expect(sanToUci(START_FEN, 'e5')).toBeNull();
    expect(sanToUci(START_FEN, '')).toBeNull();
    expect(sanToUci('garbage', 'e4')).toBeNull();
    expect(uciToSan(START_FEN, 'e2e5')).toBeNull();
    expect(uciToSan(START_FEN, 'xx')).toBeNull();
    expect(uciToSan(START_FEN, 'e2e4qq')).toBeNull();
    // 'k' is not a legal promotion piece.
    expect(uciToSan(START_FEN, 'e7e8k')).toBeNull();
    expect(uciToSan('garbage', 'e2e4')).toBeNull();
  });
});

describe('pvToSan', () => {
  it('converts a whole principal variation', () => {
    expect(pvToSan(START_FEN, ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5'])).toEqual([
      'e4',
      'e5',
      'Nf3',
      'Nc6',
      'Bb5',
    ]);
  });

  it('stops at the first illegal move', () => {
    expect(pvToSan(START_FEN, ['e2e4', 'e7e5', 'e4e5'])).toEqual(['e4', 'e5']);
  });

  it('stops at the first malformed move', () => {
    expect(pvToSan(START_FEN, ['e2e4', 'nonsense', 'g1f3'])).toEqual(['e4']);
  });

  it('handles an empty pv and an unusable FEN', () => {
    expect(pvToSan(START_FEN, [])).toEqual([]);
    expect(pvToSan('garbage', ['e2e4'])).toEqual([]);
  });

  it('renders a promotion inside a pv', () => {
    expect(pvToSan(PROMOTION_FEN, ['g7g8q', 'a4a5'])).toEqual(['g8=Q', 'Ka5']);
  });
});

describe('replaySan', () => {
  it('replays a legal sequence', () => {
    const r = replaySan(START_FEN, ['e4', 'e5', 'Nf3']);
    expect(r.ok).toBe(true);
    expect(r.failedAtPly).toBeUndefined();
    expect(r.sans).toEqual(['e4', 'e5', 'Nf3']);
    expect(r.fens).toHaveLength(3);
    expect(r.fens[2]).toBe(
      'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
    );
  });

  it('reports the ply that failed and keeps the successful prefix', () => {
    const r = replaySan(START_FEN, ['e4', 'e5', 'Nf3', 'Nf6', 'Qh5']);
    expect(r.ok).toBe(false);
    expect(r.failedAtPly).toBe(4);
    expect(r.sans).toEqual(['e4', 'e5', 'Nf3', 'Nf6']);
    expect(r.fens).toHaveLength(4);
  });

  it('fails at ply 0 when the very first move is illegal', () => {
    const r = replaySan(START_FEN, ['e5']);
    expect(r.ok).toBe(false);
    expect(r.failedAtPly).toBe(0);
    expect(r.fens).toEqual([]);
    expect(r.sans).toEqual([]);
  });

  it('fails at ply 2 for a sequence that becomes illegal midway', () => {
    const r = replaySan(START_FEN, ['e4', 'e5', 'e5']);
    expect(r.ok).toBe(false);
    expect(r.failedAtPly).toBe(2);
    expect(r.sans).toEqual(['e4', 'e5']);
  });

  it('fails at ply 0 for an unusable start FEN', () => {
    const r = replaySan('garbage', ['e4']);
    expect(r.ok).toBe(false);
    expect(r.failedAtPly).toBe(0);
  });

  it('normalises loose SAN', () => {
    const r = replaySan(START_FEN, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
    expect(r.ok).toBe(true);
    expect(r.sans[4]).toBe('Bb5');
  });

  it('accepts an empty move list', () => {
    expect(replaySan(START_FEN, [])).toEqual({ ok: true, fens: [], sans: [] });
  });
});

describe('fenAfter', () => {
  it('returns the final FEN', () => {
    expect(fenAfter(START_FEN, ['e4'])).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    );
  });

  it('returns the normalised start FEN for no moves', () => {
    expect(fenAfter(START_FEN, [])).toBe(START_FEN);
  });

  it('returns null when any move is illegal', () => {
    expect(fenAfter(START_FEN, ['e4', 'e5', 'e5'])).toBeNull();
    expect(fenAfter('garbage', [])).toBeNull();
  });
});
