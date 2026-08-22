import { describe, expect, it } from 'vitest';
import {
  canCastle,
  castlingField,
  clearBoard,
  emptyModel,
  fromFen,
  impossibleCastlingRights,
  movePiece,
  normalise,
  placePiece,
  placedPieces,
  pieceAt,
  possibleEnPassantTargets,
  removePiece,
  resetToStart,
  setEnPassant,
  setTurn,
  startModel,
  toFen,
  toggleCastling,
  validate,
  validateFenString,
  type EditorModel,
} from './editor';
import { EMPTY_FEN, START_FEN } from './position';

/** Parse or fail loudly — keeps every test below free of null checks. */
function parse(fen: string): EditorModel {
  const model = fromFen(fen);
  expect(model, `expected ${fen} to parse`).not.toBeNull();
  return model as EditorModel;
}

describe('fromFen / toFen round-tripping', () => {
  const ROUND_TRIP: [string, string][] = [
    ['start position', START_FEN],
    ['empty board', EMPTY_FEN],
    [
      'after 1.e4, Black to move, ep e3',
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    ],
    [
      'ep target on rank 6, White to move',
      'rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR w KQkq e6 0 2',
    ],
    ['partial castling rights', '4k2r/8/8/8/8/8/8/R3K3 w Qk - 4 12'],
    ['no castling rights, high clocks', '8/8/4k3/8/8/3K4/8/8 b - - 37 99'],
    ['sparse endgame', '8/5k2/8/8/2Q5/8/5K2/8 w - - 0 1'],
    ['Kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'],
    ['promotion-heavy placement', 'QQQQQQQQ/8/8/4k3/8/8/8/4K3 b - - 0 40'],
  ];

  it.each(ROUND_TRIP)('round-trips %s losslessly', (_name, fen) => {
    expect(toFen(parse(fen))).toBe(fen);
  });

  it('round-trips a FEN with both a live ep target and partial castling rights', () => {
    const fen = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R b KQq - 5 17';
    expect(toFen(parse(fen))).toBe(fen);

    const epFen = 'r3k2r/pppp1ppp/8/8/4pP2/8/PPPPP1PP/R3K2R b Kq f3 0 9';
    const model = parse(epFen);
    expect(model.enPassant).toBe('f3');
    expect(model.castling).toEqual({ K: true, Q: false, k: false, q: true });
    expect(toFen(model)).toBe(epFen);
  });

  it('parses the board into the right squares', () => {
    const model = parse(START_FEN);
    expect(pieceAt(model, 'a1')).toEqual({ color: 'w', type: 'r' });
    expect(pieceAt(model, 'e1')).toEqual({ color: 'w', type: 'k' });
    expect(pieceAt(model, 'd8')).toEqual({ color: 'b', type: 'q' });
    expect(pieceAt(model, 'h7')).toEqual({ color: 'b', type: 'p' });
    expect(pieceAt(model, 'd4')).toBeNull();
    expect(placedPieces(model)).toHaveLength(32);
  });

  it('rejects structurally broken FENs rather than guessing', () => {
    expect(fromFen('not a fen')).toBeNull();
    expect(fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -')).toBeNull();
    expect(fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN w KQkq - 0 1')).toBeNull();
    expect(fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNRX w KQkq - 0 1')).toBeNull();
    expect(fromFen('')).toBeNull();
  });

  it('keeps a well-formed but illegal position, so validate can explain it', () => {
    const model = fromFen('8/8/8/8/8/8/8/QQQQQQQQ w - - 0 1');
    expect(model).not.toBeNull();
    expect(validate(model as EditorModel).valid).toBe(false);
  });
});

describe('validate — rejections required by Phase 4', () => {
  it('rejects a position with no king', () => {
    const noWhiteKing = parse('4k3/8/8/8/8/8/8/R7 w - - 0 1');
    const result = validate(noWhiteKing);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('White has no king');

    const noBlackKing = parse('8/8/8/8/8/8/8/4K3 w - - 0 1');
    expect(validate(noBlackKing).error).toBe('Black has no king');
  });

  it('rejects two white kings', () => {
    const result = validate(parse('4k3/8/8/8/8/8/8/K3K3 w - - 0 1'));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/White has 2 kings/);
  });

  it('rejects a pawn on the eighth rank', () => {
    const result = validate(parse('4k2P/8/8/8/8/8/8/4K3 w - - 0 1'));
    expect(result.valid).toBe(false);
    expect(result.error).toBe('A pawn cannot stand on rank 8 (h8)');
  });

  it('rejects a pawn on the first rank', () => {
    const result = validate(parse('4k3/8/8/8/8/8/8/4K2p b - - 0 1'));
    expect(result.valid).toBe(false);
    expect(result.error).toBe('A pawn cannot stand on rank 1 (h1)');
  });

  it('rejects a side to move that leaves the other side already in check', () => {
    // White rook on e8 checks the black king, but it is White's move: unreachable.
    const result = validate(parse('4k2R/8/8/8/8/8/8/4K3 w - - 0 1'));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Black is in check but it is not Black's turn/);

    // Same position with Black to move is a perfectly legal position.
    expect(validate(parse('4k2R/8/8/8/8/8/8/4K3 b - - 0 1')).valid).toBe(true);
  });

  it('rejects too many pawns and adjacent kings', () => {
    expect(validate(parse('4k3/8/8/8/8/PPPPPPPP/PPPPPPPP/4K3 w - - 0 1')).error).toMatch(
      /White has 16 pawns/,
    );
    expect(validate(parse('8/8/8/8/8/8/8/4Kk2 w - - 0 1')).error).toMatch(/adjacent/i);
  });

  it('accepts the standard start position and a normal middlegame', () => {
    expect(validate(startModel())).toEqual({ valid: true });
    expect(
      validate(parse('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1')),
    ).toEqual({ valid: true });
  });

  it('rejects an empty board with a reason the user can act on', () => {
    expect(validate(emptyModel()).error).toBe('White has no king');
  });
});

describe('validate — castling rights', () => {
  it('reports castling rights that the placement cannot support', () => {
    // Rights claim both sides can castle, but the white rooks are gone from the corners.
    const model = parse('r3k2r/8/8/8/8/8/8/4K3 w KQkq - 0 1');
    const result = validate(model);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Castling is not possible for White kingside, White queenside/);
    expect(impossibleCastlingRights(model)).toEqual(['K', 'Q']);
  });

  it('knows which rights a placement supports', () => {
    const model = parse('r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1');
    expect(canCastle(model, 'K')).toBe(true);
    expect(canCastle(model, 'Q')).toBe(true);
    expect(canCastle(model, 'k')).toBe(true);
    expect(canCastle(model, 'q')).toBe(true);

    const moved = parse('r3k2r/8/8/8/8/8/8/R4K1R w - - 0 1');
    expect(canCastle(moved, 'K')).toBe(false);
    expect(canCastle(moved, 'Q')).toBe(false);
    expect(canCastle(moved, 'k')).toBe(true);
  });

  it('refuses to switch a right on when it is impossible, and off always works', () => {
    const bare = parse('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
    expect(toggleCastling(bare, 'K')).toBe(bare); // unchanged, same reference
    expect(toggleCastling(bare, 'K').castling.K).toBe(false);

    const full = parse('r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1');
    const withK = toggleCastling(full, 'K');
    expect(withK.castling.K).toBe(true);
    expect(castlingField(withK.castling)).toBe('K');
    expect(toggleCastling(withK, 'K').castling.K).toBe(false);
    expect(castlingField(toggleCastling(withK, 'K').castling)).toBe('-');
  });

  it('drops rights automatically when the rook or king leaves home (auto-sanity)', () => {
    const model = parse('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const rookGone = removePiece(model, 'h1');
    expect(rookGone.castling).toEqual({ K: false, Q: true, k: true, q: true });

    const kingMoved = movePiece(model, 'e1', 'f1');
    expect(kingMoved.castling).toEqual({ K: false, Q: false, k: true, q: true });

    const blackKingReplaced = placePiece(model, 'e8', { color: 'b', type: 'q' });
    expect(blackKingReplaced.castling).toEqual({ K: true, Q: true, k: false, q: false });
  });
});

describe('en-passant handling', () => {
  it('lists only the targets the pawn placement can justify', () => {
    // Black to move: White must have just double-pushed, so targets sit on rank 3.
    const model = parse('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    expect(possibleEnPassantTargets(model)).toEqual(['e3']);

    const white = parse('rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 2');
    expect(possibleEnPassantTargets(white)).toEqual(['e6']);
  });

  it('refuses an impossible target and keeps a possible one', () => {
    const model = parse('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    expect(setEnPassant(model, 'd3').enPassant).toBeNull(); // no pawn on d4
    expect(setEnPassant(model, 'e3').enPassant).toBe('e3');
    expect(setEnPassant(setEnPassant(model, 'e3'), null).enPassant).toBeNull();
    expect(setEnPassant(model, 'zz').enPassant).toBeNull();
  });

  it('validate explains an en-passant target that does not fit the pawns', () => {
    // Structurally fine (rank 3 with Black to move) but there is no white pawn on b4.
    const model = parse('4k3/8/8/8/8/8/8/4K3 b - b3 0 1');
    const result = validate(model);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('En-passant target b3 does not match the pawn placement');
  });

  it('clears the en-passant target when the side to move flips', () => {
    const model = parse('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
    expect(model.enPassant).toBe('e3');
    const flipped = setTurn(model, 'w');
    expect(flipped.turn).toBe('w');
    expect(flipped.enPassant).toBeNull();
    expect(setTurn(flipped, 'w')).toBe(flipped); // no-op keeps the reference
  });

  it('clears the en-passant target when the pushed pawn is removed', () => {
    const model = parse('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
    expect(removePiece(model, 'e4').enPassant).toBeNull();
    // Blocking the target square also invalidates it.
    expect(placePiece(model, 'e3', { color: 'w', type: 'n' }).enPassant).toBeNull();
  });
});

describe('mutators', () => {
  it('places, replaces and removes pieces without touching the rest of the model', () => {
    const model = parse('4k3/8/8/8/8/8/8/4K3 w - - 7 21');
    const withQueen = placePiece(model, 'd4', { color: 'w', type: 'q' });
    expect(pieceAt(withQueen, 'd4')).toEqual({ color: 'w', type: 'q' });
    expect(withQueen.halfmove).toBe(7);
    expect(withQueen.fullmove).toBe(21);
    expect(pieceAt(model, 'd4')).toBeNull(); // original untouched

    const replaced = placePiece(withQueen, 'd4', { color: 'b', type: 'n' });
    expect(pieceAt(replaced, 'd4')).toEqual({ color: 'b', type: 'n' });
    expect(placePiece(replaced, 'd4', { color: 'b', type: 'n' })).toBe(replaced);

    const removed = removePiece(replaced, 'd4');
    expect(pieceAt(removed, 'd4')).toBeNull();
    expect(removePiece(removed, 'd4')).toBe(removed); // nothing to remove
    expect(removePiece(removed, 'nope')).toBe(removed);
  });

  it('moves a piece between squares and refuses nonsense', () => {
    const model = parse('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
    const moved = movePiece(model, 'e1', 'c3');
    expect(pieceAt(moved, 'e1')).toBeNull();
    expect(pieceAt(moved, 'c3')).toEqual({ color: 'w', type: 'k' });
    expect(movePiece(model, 'a1', 'a2')).toBe(model); // empty origin
    expect(movePiece(model, 'e1', 'e1')).toBe(model);
  });

  it('clears the board, including rights, target and clocks', () => {
    const model = parse('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 6 12');
    const cleared = clearBoard(model);
    expect(placedPieces(cleared)).toEqual([]);
    expect(toFen(cleared)).toBe('8/8/8/8/8/8/8/8 b - - 0 1');
    expect(cleared.turn).toBe('b'); // side to move is a separate control
    expect(toFen(model)).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 6 12');
  });

  it('resets to the standard start position', () => {
    expect(toFen(resetToStart())).toBe(START_FEN);
    expect(toFen(startModel())).toBe(START_FEN);
    expect(toFen(emptyModel())).toBe(EMPTY_FEN);
  });

  it('normalise leaves a consistent model alone', () => {
    const model = parse('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(normalise(model)).toBe(model);
  });
});

describe('validateFenString', () => {
  it('explains structural and legal problems alike', () => {
    expect(validateFenString(START_FEN)).toEqual({ valid: true });
    expect(validateFenString('garbage').valid).toBe(false);
    expect(validateFenString('8/8/8/8/8/8/8/8 w - - 0 1').error).toBe('White has no king');
    expect(validateFenString('4k2P/8/8/8/8/8/8/4K3 w - - 0 1').error).toBe(
      'A pawn cannot stand on rank 8 (h8)',
    );
  });
});
