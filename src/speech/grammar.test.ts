/**
 * The largest test file in the project (README §7 Phase 8). Every legal-move list is built with
 * `createGame(fen).legalMoves()` from a real FEN — never a hand-written fixture — so the grammar
 * is always resolved against what chess.js actually allows.
 */

import { describe, expect, it } from 'vitest';
import { createGame, type LegalMove } from '../chess/game';
import { START_FEN } from '../chess/position';
import {
  normaliseTranscript,
  parseIntent,
  resolveSpokenMove,
  type ResolveOutcome,
} from './grammar';

// --- positions -----------------------------------------------------------------------------

/** 1.e4 — Black to move. */
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
/** Spanish with 3...a6: White may play Bxc6 (not check) or Bxa6, and O-O. */
const RUY = 'r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4';
/** White pawn on e7, nothing in the way: four promotions, none of them check. */
const PROMO = '8/4P3/8/8/7k/8/8/4K3 w - - 0 1';
/** Promotion by capture available too: e8=* and exf8=*. */
const PROMO_CAPTURE = '5r1k/4P3/8/8/8/8/8/4K3 w - - 0 1';
/** Both castlings legal for White. */
const BOTH_CASTLES = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
/** Only kingside castling legal for White. */
const ONLY_SHORT_CASTLE = 'r3k2r/8/8/8/8/8/8/4K2R w Kk - 0 1';
/** Both castlings legal for Black. */
const BLACK_CASTLES = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R b KQkq - 0 1';
/** Rooks a1 + f1: Rad1 / Rfd1 — disambiguation by file. */
const ROOKS_A1_F1 = '4k3/8/8/8/8/8/8/R4RK1 w - - 0 1';
/** Rooks a5 + h1: Raa1 / Rha1 — "rook a1" is genuinely ambiguous. */
const ROOKS_A5_H1 = '4k3/8/8/R7/4K3/8/8/7R w - - 0 1';
/** Rooks a5 + a2: R5a3 / R2a3 — disambiguation by rank. */
const ROOKS_A5_A2 = '4k3/8/8/R7/8/8/R7/4K3 w - - 0 1';
/** Lone white king on f1: Kg1 is a plain king move, no castling anywhere. */
const KING_F1 = '4k3/8/8/8/8/8/8/5K2 w - - 0 1';
/** En passant available: exf6. */
const EN_PASSANT = 'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3';
/** Two white pawns (c4, e4) and the queen can all take on d5. */
const TWO_PAWN_CAPTURES = 'rnbqkbnr/ppp1pppp/8/3p4/2P1P3/8/PP3PPP/RNBQKBNR w KQkq - 0 1';

// --- helpers -------------------------------------------------------------------------------

function legalFor(fen: string): LegalMove[] {
  return createGame(fen).legalMoves();
}

function resolve(fen: string, ...alternatives: string[]): ResolveOutcome {
  return resolveSpokenMove(alternatives, legalFor(fen));
}

function resolved(outcome: ResolveOutcome): { san: string; spoken: string; from: string } {
  if (outcome.status !== 'resolved') {
    throw new Error(`expected 'resolved', got '${outcome.status}'`);
  }
  return { san: outcome.san, spoken: outcome.spoken, from: outcome.move.from };
}

function ambiguous(outcome: ResolveOutcome): string[] {
  if (outcome.status !== 'ambiguous') {
    throw new Error(`expected 'ambiguous', got '${outcome.status}'`);
  }
  return [...outcome.candidates].sort();
}

/** Convenience: resolve a single phrase and return its SAN. */
function san(fen: string, phrase: string): string {
  return resolved(resolve(fen, phrase)).san;
}

// ============================================================================================
// normaliseTranscript
// ============================================================================================

describe('normaliseTranscript', () => {
  it('lowercases, strips punctuation and tokenises', () => {
    expect(normaliseTranscript('Knight, F3!')).toEqual(['knight', 'f3']);
    expect(normaliseTranscript('  BISHOP   takes   C6.  ')).toEqual(['bishop', 'takes', 'c6']);
  });

  it('returns no tokens for empty input', () => {
    expect(normaliseTranscript('')).toEqual([]);
    expect(normaliseTranscript('   ...!!  ')).toEqual([]);
  });

  it('keeps number words alive as squares', () => {
    expect(normaliseTranscript('e four')).toEqual(['e4']);
    expect(normaliseTranscript('e 4')).toEqual(['e4']);
    expect(normaliseTranscript('rook a one')).toEqual(['rook', 'a1']);
  });

  describe('homophone table', () => {
    const cases: [string, string[]][] = [
      // README: night → knight
      ['night f3', ['knight', 'f3']],
      ['nite f3', ['knight', 'f3']],
      // README: won/one → 1
      ['a won', ['a1']],
      ['a one', ['a1']],
      // README: to/too/two → 2 (contextually, see the dedicated block below)
      ['d two', ['d2']],
      ['d to', ['d2']],
      ['d too', ['d2']],
      // README: for/four → 4
      ['e four', ['e4']],
      ['e for', ['e4']],
      ['e fore', ['e4']],
      // README: ate/eight → 8
      ['g eight', ['g8']],
      ['g ate', ['g8']],
      // README: be/bee → b
      ['be four', ['b4']],
      ['bee four', ['b4']],
      // README: see/sea/cee → c
      ['see six', ['c6']],
      ['sea six', ['c6']],
      ['cee six', ['c6']],
      // README: dee → d
      ['dee five', ['d5']],
      // README: ef → f
      ['ef three', ['f3']],
      ['eff three', ['f3']],
      // README: gee/jee → g
      ['gee seven', ['g7']],
      ['jee seven', ['g7']],
      // README: aitch/each/h → h
      ['aitch three', ['h3']],
      ['each three', ['h3']],
      ['h three', ['h3']],
      // README: queue → q
      ['e8 queue', ['e8', 'q']],
      // README: ex/axe → takes
      ['bishop ex c6', ['bishop', 'takes', 'c6']],
      ['bishop axe c6', ['bishop', 'takes', 'c6']],
      // Additional obvious mishearings
      ['ay tree', ['a3']],
      ['aye tree', ['a3']],
      ['b three', ['b3']],
      ['c five', ['c5']],
      ['f sicks', ['f6']],
      ['f six', ['f6']],
      ['g seven', ['g7']],
      ['h nine', ['h', '9']],
      ['rock a1', ['rook', 'a1']],
      ['rocks a1', ['rook', 'a1']],
      ['prawn e4', ['pawn', 'e4']],
      ['knights f3', ['knight', 'f3']],
      ['bishops c4', ['bishop', 'c4']],
      ['quinn d1', ['queen', 'd1']],
      ['kings g1', ['king', 'g1']],
      ['bishop captures c6', ['bishop', 'takes', 'c6']],
      ['bishop capture c6', ['bishop', 'takes', 'c6']],
      ['bishop take c6', ['bishop', 'takes', 'c6']],
      ['bishop x c6', ['bishop', 'takes', 'c6']],
      ['castle short', ['castles', 'short']],
      ['castling long', ['castles', 'long']],
      ['castles kingside', ['castles', 'short']],
      ['castles queenside', ['castles', 'long']],
      ['e8 promote to queen', ['e8', 'promotes', 'queen']],
      ['e8 promotion queen', ['e8', 'promotes', 'queen']],
      ['e8 equals queen', ['e8', 'promotes', 'queen']],
    ];

    for (const [input, expected] of cases) {
      it(`"${input}" → ${JSON.stringify(expected)}`, () => {
        expect(normaliseTranscript(input)).toEqual(expected);
      });
    }
  });

  it('treats "to"/"too" as a preposition unless a file letter precedes it', () => {
    expect(normaliseTranscript('rook to d1')).toEqual(['rook', 'd1']);
    expect(normaliseTranscript('pawn to e4')).toEqual(['pawn', 'e4']);
    expect(normaliseTranscript('e8 promotes to queen')).toEqual(['e8', 'promotes', 'queen']);
    expect(normaliseTranscript('d to')).toEqual(['d2']);
  });

  it('drops filler words', () => {
    expect(normaliseTranscript('please move the knight to f3')).toEqual(['knight', 'f3']);
    expect(normaliseTranscript('ok now play bishop takes c6 check')).toEqual([
      'bishop',
      'takes',
      'c6',
    ]);
    expect(normaliseTranscript('move a knight to f3')).toEqual(['knight', 'f3']);
  });

  it('expands notation the recogniser sometimes returns verbatim', () => {
    expect(normaliseTranscript('Nf3')).toEqual(['knight', 'f3']);
    expect(normaliseTranscript('Bxc6')).toEqual(['bishop', 'takes', 'c6']);
    expect(normaliseTranscript('exd5')).toEqual(['e', 'takes', 'd5']);
    expect(normaliseTranscript('Rad1')).toEqual(['rook', 'a', 'd1']);
    expect(normaliseTranscript('R1a3')).toEqual(['rook', '1', 'a3']);
    // '=' is stripped as punctuation, so 'Q' arrives as its own token.
    expect(normaliseTranscript('e8=Q')).toEqual(['e8', 'q']);
    expect(normaliseTranscript('e8q')).toEqual(['e8', 'promotes', 'queen']);
    expect(normaliseTranscript('O-O')).toEqual(['castles', 'short']);
    expect(normaliseTranscript('0-0-0')).toEqual(['castles', 'long']);
    expect(normaliseTranscript('oh oh')).toEqual(['castles', 'short']);
    expect(normaliseTranscript('b4')).toEqual(['b4']);
  });

  it('leaves unknown words alone', () => {
    expect(normaliseTranscript('hello world')).toEqual(['hello', 'world']);
  });
});

// ============================================================================================
// parseIntent
// ============================================================================================

describe('parseIntent', () => {
  const intentOf = (phrase: string) => parseIntent(normaliseTranscript(phrase));

  it('returns null when nothing move-like was said', () => {
    expect(parseIntent([])).toBeNull();
    expect(intentOf('')).toBeNull();
    expect(intentOf('hello world')).toBeNull();
    expect(intentOf('knight')).toBeNull();
    expect(intentOf('bishop takes')).toBeNull();
  });

  it('extracts piece and destination', () => {
    expect(intentOf('knight f3')).toEqual({ piece: 'n', to: 'f3' });
    expect(intentOf('pawn e4')).toEqual({ piece: 'p', to: 'e4' });
    expect(intentOf('king g1')).toEqual({ piece: 'k', to: 'g1' });
    expect(intentOf('e4')).toEqual({ to: 'e4' });
  });

  it('extracts the capture flag', () => {
    expect(intentOf('bishop takes c6')).toEqual({ piece: 'b', to: 'c6', capture: true });
    expect(intentOf('e takes d5')).toEqual({ fromFile: 'e', to: 'd5', capture: true });
  });

  it('extracts origin hints', () => {
    expect(intentOf('rook a d1')).toEqual({ piece: 'r', fromFile: 'a', to: 'd1' });
    expect(intentOf('rook five a3')).toEqual({ piece: 'r', fromRank: '5', to: 'a3' });
    expect(intentOf('e2 e4')).toEqual({ fromFile: 'e', fromRank: '2', to: 'e4' });
    expect(intentOf('rook a1 d1')).toEqual({
      piece: 'r',
      fromFile: 'a',
      fromRank: '1',
      to: 'd1',
    });
  });

  it('extracts promotion, spoken either way', () => {
    expect(intentOf('e8 queen')).toEqual({ to: 'e8', promotion: 'q' });
    expect(intentOf('e8 promotes to queen')).toEqual({ to: 'e8', promotion: 'q' });
    expect(intentOf('e8 knight')).toEqual({ to: 'e8', promotion: 'n' });
    expect(intentOf('e takes f8 promotes to queen')).toEqual({
      fromFile: 'e',
      to: 'f8',
      capture: true,
      promotion: 'q',
    });
  });

  it('extracts castling with a side', () => {
    expect(intentOf('castles short')).toEqual({ castle: 'short' });
    expect(intentOf('castles kingside')).toEqual({ castle: 'short' });
    expect(intentOf('castles king side')).toEqual({ castle: 'short' });
    expect(intentOf('castles long')).toEqual({ castle: 'long' });
    expect(intentOf('castles queenside')).toEqual({ castle: 'long' });
    expect(intentOf('o o')).toEqual({ castle: 'short' });
    expect(intentOf('o o o')).toEqual({ castle: 'long' });
  });

  it('marks the side as unspecified for a bare "castles"', () => {
    expect(intentOf('castles')).toEqual({ castleAnySide: true });
    expect(intentOf('castle')).toEqual({ castleAnySide: true });
  });
});

// ============================================================================================
// resolveSpokenMove — the README's worked examples
// ============================================================================================

describe('resolveSpokenMove — README examples', () => {
  it('"e four" → e4', () => {
    expect(san(START_FEN, 'e four')).toBe('e4');
  });

  it('"knight f3" → Nf3', () => {
    expect(san(START_FEN, 'knight f3')).toBe('Nf3');
  });

  it('"night f3" → Nf3', () => {
    expect(san(START_FEN, 'night f3')).toBe('Nf3');
  });

  it('"bishop takes c6" → Bxc6', () => {
    expect(san(RUY, 'bishop takes c6')).toBe('Bxc6');
  });

  it('"castles short" → O-O', () => {
    expect(san(BOTH_CASTLES, 'castles short')).toBe('O-O');
  });

  it('"castles queenside" → O-O-O', () => {
    expect(san(BOTH_CASTLES, 'castles queenside')).toBe('O-O-O');
  });

  it('"e8 queen" → e8=Q', () => {
    expect(san(PROMO, 'e8 queen')).toBe('e8=Q');
  });

  it('"e8 promotes to queen" → e8=Q', () => {
    expect(san(PROMO, 'e8 promotes to queen')).toBe('e8=Q');
  });

  it('a legal-sounding but illegal move is unrecognised', () => {
    expect(resolve(START_FEN, 'queen h5').status).toBe('unrecognised');
    expect(resolve(START_FEN, 'knight f6').status).toBe('unrecognised');
    expect(resolve(START_FEN, 'bishop takes c6').status).toBe('unrecognised');
    expect(resolve(START_FEN, 'castles short').status).toBe('unrecognised');
  });

  it('garbage is unrecognised', () => {
    expect(resolve(START_FEN, 'the weather is lovely today').status).toBe('unrecognised');
    expect(resolve(START_FEN, 'banana bread').status).toBe('unrecognised');
    expect(resolve(START_FEN, '').status).toBe('unrecognised');
    expect(resolveSpokenMove([], legalFor(START_FEN)).status).toBe('unrecognised');
  });

  it('falls through to a later alternative when the first is unusable', () => {
    expect(resolved(resolve(START_FEN, 'banana bread', 'knight f3')).san).toBe('Nf3');
    // First alternative is a legal-sounding illegal move, second is fine.
    expect(resolved(resolve(START_FEN, 'queen h5', 'e four')).san).toBe('e4');
    // Three deep.
    expect(resolved(resolve(START_FEN, 'hello', 'goodbye', 'pawn d4')).san).toBe('d4');
  });
});

// ============================================================================================
// resolveSpokenMove — pieces, pawns, captures
// ============================================================================================

describe('resolveSpokenMove — pieces and pawns', () => {
  it('resolves a pawn push named with its piece', () => {
    expect(san(START_FEN, 'pawn e4')).toBe('e4');
    expect(san(START_FEN, 'prawn e4')).toBe('e4');
  });

  it('resolves a pawn push given as a bare destination', () => {
    expect(san(START_FEN, 'e4')).toBe('e4');
    expect(san(START_FEN, 'd four')).toBe('d4');
    expect(san(START_FEN, 'g three')).toBe('g3');
  });

  it('is ambiguous when a bare destination fits a pawn and a knight', () => {
    // h3 is reachable by the h-pawn and by Ng1.
    expect(ambiguous(resolve(START_FEN, 'h three'))).toEqual(['Nh3', 'h3']);
    expect(san(START_FEN, 'pawn h3')).toBe('h3');
    expect(san(START_FEN, 'knight h3')).toBe('Nh3');
  });

  it('resolves a knight move given as an origin/destination pair', () => {
    expect(san(START_FEN, 'g1 f3')).toBe('Nf3');
    expect(san(START_FEN, 'e2 e4')).toBe('e4');
  });

  it('resolves a plain king move', () => {
    expect(san(KING_F1, 'king g1')).toBe('Kg1');
    expect(san(KING_F1, 'king e2')).toBe('Ke2');
  });

  it('treats "king g1" as the kingside castle when that is the only way there', () => {
    expect(san(RUY, 'king g1')).toBe('O-O');
  });

  it('accepts every capture synonym', () => {
    for (const phrase of [
      'bishop takes c6',
      'bishop take c6',
      'bishop taking c6',
      'bishop captures c6',
      'bishop capture c6',
      'bishop ex c6',
      'bishop axe c6',
      'bishop x c6',
      'Bxc6',
    ]) {
      expect(san(RUY, phrase)).toBe('Bxc6');
    }
  });

  it('resolves a capture even when "takes" was not said', () => {
    expect(san(RUY, 'bishop c6')).toBe('Bxc6');
  });

  it('needs a destination: "bishop takes" alone is unrecognised', () => {
    expect(resolve(RUY, 'bishop takes').status).toBe('unrecognised');
  });

  it('resolves a pawn capture by origin file', () => {
    expect(san(TWO_PAWN_CAPTURES, 'c takes d5')).toBe('cxd5');
    expect(san(TWO_PAWN_CAPTURES, 'see takes d5')).toBe('cxd5');
    expect(san(TWO_PAWN_CAPTURES, 'e takes d5')).toBe('exd5');
    expect(san(TWO_PAWN_CAPTURES, 'exd5')).toBe('exd5');
  });

  it('reports two pawn captures onto the same square as ambiguous', () => {
    expect(ambiguous(resolve(TWO_PAWN_CAPTURES, 'pawn takes d5'))).toEqual(['cxd5', 'exd5']);
  });

  it('resolves an en-passant capture', () => {
    expect(san(EN_PASSANT, 'e takes f6')).toBe('exf6');
    expect(san(EN_PASSANT, 'pawn takes f6')).toBe('exf6');
  });
});

// ============================================================================================
// resolveSpokenMove — disambiguation
// ============================================================================================

describe('resolveSpokenMove — disambiguation', () => {
  it('resolves Rad1-style file disambiguation', () => {
    expect(san(ROOKS_A1_F1, 'rook a d1')).toBe('Rad1');
    expect(san(ROOKS_A1_F1, 'rook f d1')).toBe('Rfd1');
    expect(san(ROOKS_A1_F1, 'rook a1 d1')).toBe('Rad1');
    expect(san(ROOKS_A1_F1, 'Rad1')).toBe('Rad1');
  });

  it('reports a genuinely ambiguous rook move as ambiguous', () => {
    expect(ambiguous(resolve(ROOKS_A1_F1, 'rook d1'))).toEqual(['Rad1', 'Rfd1']);
    expect(ambiguous(resolve(ROOKS_A5_H1, 'rook a1'))).toEqual(['Raa1', 'Rha1']);
  });

  it('resolves "rook a1" once the origin file is named', () => {
    expect(san(ROOKS_A5_H1, 'rook a a1')).toBe('Raa1');
    expect(san(ROOKS_A5_H1, 'rook h a1')).toBe('Rha1');
    expect(san(ROOKS_A5_H1, 'rook aitch a1')).toBe('Rha1');
  });

  it('disambiguates by rank', () => {
    expect(ambiguous(resolve(ROOKS_A5_A2, 'rook a3'))).toEqual(['R2a3', 'R5a3']);
    expect(san(ROOKS_A5_A2, 'rook five a3')).toBe('R5a3');
    expect(san(ROOKS_A5_A2, 'rook two a3')).toBe('R2a3');
    expect(san(ROOKS_A5_A2, 'rook a5 a3')).toBe('R5a3');
  });

  it('prefers a later alternative that resolves over an earlier ambiguous one', () => {
    expect(resolved(resolve(ROOKS_A1_F1, 'rook d1', 'rook a d1')).san).toBe('Rad1');
    expect(resolved(resolve(ROOKS_A5_A2, 'rook a3', 'rook five a3')).san).toBe('R5a3');
  });

  it('reports the highest-confidence ambiguity when nothing resolves', () => {
    const outcome = resolve(ROOKS_A1_F1, 'rook d1', 'rook e1', 'nonsense');
    expect(ambiguous(outcome)).toEqual(['Rad1', 'Rfd1']);
  });

  it('is unrecognised when every alternative is illegal or garbage', () => {
    expect(resolve(ROOKS_A1_F1, 'rook d5', 'nonsense words here').status).toBe('unrecognised');
  });
});

// ============================================================================================
// resolveSpokenMove — castling
// ============================================================================================

describe('resolveSpokenMove — castling', () => {
  it('resolves both sides when named', () => {
    expect(san(BOTH_CASTLES, 'castles short')).toBe('O-O');
    expect(san(BOTH_CASTLES, 'castles kingside')).toBe('O-O');
    expect(san(BOTH_CASTLES, 'castle king side')).toBe('O-O');
    expect(san(BOTH_CASTLES, 'castles long')).toBe('O-O-O');
    expect(san(BOTH_CASTLES, 'castles queenside')).toBe('O-O-O');
    expect(san(BOTH_CASTLES, 'castling queen side')).toBe('O-O-O');
    expect(san(BOTH_CASTLES, 'O-O')).toBe('O-O');
    expect(san(BOTH_CASTLES, 'O-O-O')).toBe('O-O-O');
  });

  it('"castles" alone resolves when only one castling is legal', () => {
    expect(san(ONLY_SHORT_CASTLE, 'castles')).toBe('O-O');
    expect(san(ONLY_SHORT_CASTLE, 'castle')).toBe('O-O');
  });

  it('"castles" alone is ambiguous when both are legal', () => {
    expect(ambiguous(resolve(BOTH_CASTLES, 'castles'))).toEqual(['O-O', 'O-O-O']);
  });

  it('is unrecognised when the named castling is not available', () => {
    expect(resolve(ONLY_SHORT_CASTLE, 'castles queenside').status).toBe('unrecognised');
    expect(resolve(START_FEN, 'castles').status).toBe('unrecognised');
  });
});

// ============================================================================================
// resolveSpokenMove — promotion
// ============================================================================================

describe('resolveSpokenMove — promotion', () => {
  it('resolves every promotion piece', () => {
    expect(san(PROMO, 'e8 queen')).toBe('e8=Q');
    expect(san(PROMO, 'e8 promotes to queen')).toBe('e8=Q');
    expect(san(PROMO, 'e8 knight')).toBe('e8=N');
    expect(san(PROMO, 'e8 promotes to knight')).toBe('e8=N');
    expect(san(PROMO, 'e8 promotes to rook')).toBe('e8=R');
    expect(san(PROMO, 'e8 promotes to bishop')).toBe('e8=B');
    expect(san(PROMO, 'e8 queue')).toBe('e8=Q');
    expect(san(PROMO, 'e8=Q')).toBe('e8=Q');
  });

  it('is ambiguous when the promotion piece is not named', () => {
    expect(ambiguous(resolve(PROMO, 'e8'))).toEqual(['e8=B', 'e8=N', 'e8=Q', 'e8=R']);
    expect(ambiguous(resolve(PROMO, 'pawn e8'))).toEqual(['e8=B', 'e8=N', 'e8=Q', 'e8=R']);
  });

  it('resolves a promotion by capture', () => {
    expect(san(PROMO_CAPTURE, 'e takes f8 promotes to queen')).toBe('exf8=Q+');
    expect(san(PROMO_CAPTURE, 'e takes f8 knight')).toBe('exf8=N');
  });
});

// ============================================================================================
// resolveSpokenMove — Black to move
// ============================================================================================

describe('resolveSpokenMove — Black to move', () => {
  it('resolves Black pawn and piece moves', () => {
    expect(san(AFTER_E4, 'e five')).toBe('e5');
    expect(san(AFTER_E4, 'e5')).toBe('e5');
    expect(san(AFTER_E4, 'night f6')).toBe('Nf6');
    expect(san(AFTER_E4, 'knight c6')).toBe('Nc6');
    expect(resolved(resolve(AFTER_E4, 'knight f6')).from).toBe('g8');
  });

  it('rejects a White move when it is Black to move', () => {
    expect(resolve(AFTER_E4, 'knight f3').status).toBe('unrecognised');
    expect(resolve(AFTER_E4, 'd four').status).toBe('unrecognised');
  });

  it('resolves Black castling', () => {
    expect(san(BLACK_CASTLES, 'castles short')).toBe('O-O');
    expect(san(BLACK_CASTLES, 'castles queenside')).toBe('O-O-O');
    expect(ambiguous(resolve(BLACK_CASTLES, 'castles'))).toEqual(['O-O', 'O-O-O']);
  });
});

// ============================================================================================
// the spoken echo
// ============================================================================================

describe('resolveSpokenMove — spoken echo', () => {
  it('echoes piece moves in speakable form', () => {
    expect(resolved(resolve(START_FEN, 'knight f3')).spoken).toBe('knight f3');
    expect(resolved(resolve(RUY, 'bishop takes c6')).spoken).toBe('bishop takes c6');
    expect(resolved(resolve(KING_F1, 'king g1')).spoken).toBe('king g1');
  });

  it('echoes pawn moves without the piece name', () => {
    expect(resolved(resolve(START_FEN, 'e four')).spoken).toBe('e4');
    expect(resolved(resolve(EN_PASSANT, 'e takes f6')).spoken).toBe('e takes f6');
  });

  it('echoes castling', () => {
    expect(resolved(resolve(BOTH_CASTLES, 'castles short')).spoken).toBe('castles short');
    expect(resolved(resolve(BOTH_CASTLES, 'castles queenside')).spoken).toBe('castles long');
  });

  it('echoes promotion', () => {
    expect(resolved(resolve(PROMO, 'e8 queen')).spoken).toBe('e8 promotes to queen');
    expect(resolved(resolve(PROMO, 'e8 knight')).spoken).toBe('e8 promotes to knight');
  });

  it('includes the origin square when another identical piece could go there', () => {
    expect(resolved(resolve(ROOKS_A1_F1, 'rook a d1')).spoken).toBe('rook a1 d1');
    expect(resolved(resolve(ROOKS_A1_F1, 'rook a a2')).spoken).toBe('rook a2');
  });
});

// ============================================================================================
// robustness
// ============================================================================================

describe('resolveSpokenMove — robustness', () => {
  it('never resolves against an empty legal-move list', () => {
    // Checkmated position: Black has no legal move at all.
    const mated = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
    expect(resolveSpokenMove(['e four'], legalFor(mated)).status).toBe('unrecognised');
  });

  it('returns the resolved LegalMove itself so the caller can apply it', () => {
    const outcome = resolve(START_FEN, 'knight f3');
    if (outcome.status !== 'resolved') throw new Error('expected resolved');
    expect(outcome.move.from).toBe('g1');
    expect(outcome.move.to).toBe('f3');
    expect(outcome.move.piece).toBe('n');
    expect(createGame(START_FEN).move(outcome.move.san)).not.toBeNull();
  });

  it('tolerates a rambling transcript around the move', () => {
    expect(san(START_FEN, 'um ok so I play knight to f3 please')).toBe('Nf3');
    expect(san(RUY, 'my bishop takes on c6')).toBe('Bxc6');
  });

  it('is stable when the same phrase appears in several alternatives', () => {
    expect(san(START_FEN, 'knight f3')).toBe('Nf3');
    expect(resolved(resolve(START_FEN, 'knight f3', 'night f3', 'nite f3')).san).toBe('Nf3');
  });
});
