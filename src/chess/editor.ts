/**
 * Pure position-editor model (README §7 Phase 4, §9 "keep logic out of components").
 *
 * The editable representation of a position: 64 slots, a side to move, four castling rights,
 * an en-passant target and the two clocks. Every mutator is pure and returns a fresh model, so
 * the UI can hold it in `useState` and undo simply by keeping the previous value.
 *
 * Two rules that the rest of the app depends on:
 *
 *  1. `fromFen` / `toFen` round-trip losslessly. `fromFen` is deliberately *verbatim*: it does
 *     not sanitise anything, so a pasted FEN comes back out byte-identical and the user sees
 *     exactly what they typed.
 *  2. Sanity is applied on *edits*, not on parse. Placement mutators run `normalise`, which
 *     drops castling rights and an en-passant target that the piece placement cannot support —
 *     dragging the h1 rook away silently drops `K`. A FEN that arrives with impossible rights is
 *     kept as-is and reported by `validate` instead, so the user is told rather than
 *     second-guessed.
 *
 * Rule-level legality is NOT reimplemented here: `validate` adds the structural checks and then
 * delegates to `validateFenRules` from `game.ts` (the only module allowed to touch chess.js).
 */

import { validateFenRules, type Color, type PieceType } from './game';
import {
  coordsToSquare,
  isSquare,
  isValidFen,
  squareToCoords,
  START_FEN,
  type Square,
} from './position';

export interface EditorPiece {
  color: Color;
  type: PieceType;
}

export type CastlingRight = 'K' | 'Q' | 'k' | 'q';
export type CastlingRights = Record<CastlingRight, boolean>;

export interface EditorModel {
  /** 64 slots. Index = rank * 8 + file, with file 0 = 'a' and rank 0 = rank 1 (so index 0 = a1). */
  board: readonly (EditorPiece | null)[];
  turn: Color;
  castling: CastlingRights;
  /** Algebraic square on rank 3 or 6, or `null` for '-'. */
  enPassant: Square | null;
  halfmove: number;
  fullmove: number;
}

export interface EditorValidation {
  valid: boolean;
  /** User-facing reason, present exactly when `valid` is false. */
  error?: string;
}

export const CASTLING_RIGHTS: readonly CastlingRight[] = ['K', 'Q', 'k', 'q'];

const NO_RIGHTS: CastlingRights = { K: false, Q: false, k: false, q: false };

/** Home squares a right needs: [king square, rook square]. */
const CASTLING_HOME: Record<CastlingRight, { color: Color; king: Square; rook: Square }> = {
  K: { color: 'w', king: 'e1', rook: 'h1' },
  Q: { color: 'w', king: 'e1', rook: 'a1' },
  k: { color: 'b', king: 'e8', rook: 'h8' },
  q: { color: 'b', king: 'e8', rook: 'a8' },
};

/** Human label for a castling right, for messages and control labels. */
export function castlingLabel(right: CastlingRight): string {
  switch (right) {
    case 'K':
      return 'White kingside';
    case 'Q':
      return 'White queenside';
    case 'k':
      return 'Black kingside';
    default:
      return 'Black queenside';
  }
}

/* ------------------------------------------------------------------------------------ *
 * Square/piece plumbing
 * ------------------------------------------------------------------------------------ */

function indexOfSquare(sq: Square): number | null {
  if (!isSquare(sq)) return null;
  const { file, rank } = squareToCoords(sq);
  return rank * 8 + file;
}

function squareOfIndex(index: number): Square {
  return coordsToSquare(index % 8, Math.floor(index / 8));
}

const PIECE_TYPES: Record<string, PieceType> = {
  p: 'p',
  n: 'n',
  b: 'b',
  r: 'r',
  q: 'q',
  k: 'k',
};

function charToPiece(ch: string): EditorPiece | null {
  const lower = ch.toLowerCase();
  const type = PIECE_TYPES[lower];
  if (type === undefined) return null;
  return { color: ch === lower ? 'b' : 'w', type };
}

/** FEN character for a piece: uppercase for White. */
export function pieceToChar(piece: EditorPiece): string {
  return piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
}

export function pieceAt(model: EditorModel, square: Square): EditorPiece | null {
  const index = indexOfSquare(square);
  if (index === null) return null;
  return model.board[index] ?? null;
}

/** Every occupied square, in a1..h8 order. Handy for rendering and for counting. */
export function placedPieces(model: EditorModel): { square: Square; piece: EditorPiece }[] {
  const out: { square: Square; piece: EditorPiece }[] = [];
  model.board.forEach((piece, index) => {
    if (piece !== null && piece !== undefined) {
      out.push({ square: squareOfIndex(index), piece });
    }
  });
  return out;
}

function emptyBoard(): (EditorPiece | null)[] {
  return new Array<EditorPiece | null>(64).fill(null);
}

function withBoard(model: EditorModel, board: (EditorPiece | null)[]): EditorModel {
  return { ...model, board };
}

/* ------------------------------------------------------------------------------------ *
 * FEN conversion
 * ------------------------------------------------------------------------------------ */

function parseBoardField(field: string): (EditorPiece | null)[] | null {
  const ranks = field.split('/');
  if (ranks.length !== 8) return null;
  const board = emptyBoard();
  for (let row = 0; row < 8; row++) {
    const text = ranks[row] as string;
    const rank = 7 - row; // FEN lists rank 8 first
    let file = 0;
    for (const ch of text) {
      if (ch >= '1' && ch <= '8') {
        file += ch.charCodeAt(0) - 48;
        continue;
      }
      const piece = charToPiece(ch);
      if (piece === null || file > 7) return null;
      board[rank * 8 + file] = piece;
      file += 1;
    }
    if (file !== 8) return null;
  }
  return board;
}

function parseCastlingField(field: string): CastlingRights {
  if (field === '-') return { ...NO_RIGHTS };
  return {
    K: field.includes('K'),
    Q: field.includes('Q'),
    k: field.includes('k'),
    q: field.includes('q'),
  };
}

/**
 * Parses a FEN into the editor model. Returns `null` only when the FEN is structurally
 * unparseable (`isValidFen` explains why) — an *illegal but well-formed* position parses fine
 * and is reported by `validate`, which is what lets the editor show a reason.
 */
export function fromFen(fen: string): EditorModel | null {
  if (typeof fen !== 'string') return null;
  const trimmed = fen.trim();
  if (!isValidFen(trimmed).valid) return null;

  const [boardField, side, castling, ep, halfmove, fullmove] = trimmed.split(/\s+/) as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const board = parseBoardField(boardField);
  if (board === null) return null;

  return {
    board,
    turn: side === 'b' ? 'b' : 'w',
    castling: parseCastlingField(castling),
    enPassant: ep === '-' ? null : ep,
    halfmove: Number.parseInt(halfmove, 10),
    fullmove: Number.parseInt(fullmove, 10),
  };
}

export function castlingField(rights: CastlingRights): string {
  const text = CASTLING_RIGHTS.filter((r) => rights[r]).join('');
  return text.length === 0 ? '-' : text;
}

export function toFen(model: EditorModel): string {
  const rows: string[] = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const piece = model.board[rank * 8 + file] ?? null;
      if (piece === null) {
        empty += 1;
        continue;
      }
      if (empty > 0) {
        row += String(empty);
        empty = 0;
      }
      row += pieceToChar(piece);
    }
    if (empty > 0) row += String(empty);
    rows.push(row);
  }
  return [
    rows.join('/'),
    model.turn,
    castlingField(model.castling),
    model.enPassant ?? '-',
    String(model.halfmove),
    String(model.fullmove),
  ].join(' ');
}

/* ------------------------------------------------------------------------------------ *
 * Auto-sanity
 * ------------------------------------------------------------------------------------ */

/** True when the piece placement can support `right` (king and rook on their home squares). */
export function canCastle(model: EditorModel, right: CastlingRight): boolean {
  const home = CASTLING_HOME[right];
  const king = pieceAt(model, home.king);
  const rook = pieceAt(model, home.rook);
  return (
    king !== null &&
    king.color === home.color &&
    king.type === 'k' &&
    rook !== null &&
    rook.color === home.color &&
    rook.type === 'r'
  );
}

/** Rights that are set but cannot be, given the placement. */
export function impossibleCastlingRights(model: EditorModel): CastlingRight[] {
  return CASTLING_RIGHTS.filter((r) => model.castling[r] && !canCastle(model, r));
}

/**
 * Every square that could legitimately be an en-passant target: the side to move implies who
 * just double-pushed, so the pawn must be on the square beyond the target and both the target
 * and the pawn's origin square must be empty.
 */
export function possibleEnPassantTargets(model: EditorModel): Square[] {
  // White to move ⇒ Black just pushed ⇒ target on rank 6, pawn on rank 5, origin rank 7.
  const targetRank = model.turn === 'w' ? 5 : 2; // 0-based
  const pawnRank = model.turn === 'w' ? 4 : 3;
  const originRank = model.turn === 'w' ? 6 : 1;
  const pawnColor: Color = model.turn === 'w' ? 'b' : 'w';

  const out: Square[] = [];
  for (let file = 0; file < 8; file++) {
    const target = coordsToSquare(file, targetRank);
    if (pieceAt(model, target) !== null) continue;
    if (pieceAt(model, coordsToSquare(file, originRank)) !== null) continue;
    const pawn = pieceAt(model, coordsToSquare(file, pawnRank));
    if (pawn === null || pawn.color !== pawnColor || pawn.type !== 'p') continue;
    out.push(target);
  }
  return out;
}

function enPassantIsPossible(model: EditorModel): boolean {
  if (model.enPassant === null) return true;
  return possibleEnPassantTargets(model).includes(model.enPassant);
}

/**
 * Drops the castling rights and en-passant target that the current placement cannot support.
 * Applied automatically by every placement mutator; exported so a caller can sanitise a model
 * it built itself.
 */
export function normalise(model: EditorModel): EditorModel {
  const castling: CastlingRights = { ...NO_RIGHTS };
  let castlingChanged = false;
  for (const right of CASTLING_RIGHTS) {
    const keep = model.castling[right] && canCastle(model, right);
    castling[right] = keep;
    if (keep !== model.castling[right]) castlingChanged = true;
  }
  const dropEp = !enPassantIsPossible(model);
  if (!castlingChanged && !dropEp) return model;
  return {
    ...model,
    castling: castlingChanged ? castling : model.castling,
    enPassant: dropEp ? null : model.enPassant,
  };
}

/* ------------------------------------------------------------------------------------ *
 * Construction and mutators — all pure
 * ------------------------------------------------------------------------------------ */

export function emptyModel(): EditorModel {
  return {
    board: emptyBoard(),
    turn: 'w',
    castling: { ...NO_RIGHTS },
    enPassant: null,
    halfmove: 0,
    fullmove: 1,
  };
}

/** The standard starting position. */
export function startModel(): EditorModel {
  const model = fromFen(START_FEN);
  // START_FEN is a constant, so this cannot fail; the fallback keeps the type honest.
  return model ?? emptyModel();
}

export function placePiece(model: EditorModel, square: Square, piece: EditorPiece): EditorModel {
  const index = indexOfSquare(square);
  if (index === null) return model;
  const existing = model.board[index] ?? null;
  if (existing !== null && existing.color === piece.color && existing.type === piece.type) {
    return model;
  }
  const board = [...model.board];
  board[index] = { color: piece.color, type: piece.type };
  return normalise(withBoard(model, board));
}

export function removePiece(model: EditorModel, square: Square): EditorModel {
  const index = indexOfSquare(square);
  if (index === null || (model.board[index] ?? null) === null) return model;
  const board = [...model.board];
  board[index] = null;
  return normalise(withBoard(model, board));
}

/** Drag a piece from one square to another. Dropping onto an occupied square replaces it. */
export function movePiece(model: EditorModel, from: Square, to: Square): EditorModel {
  if (from === to) return model;
  const piece = pieceAt(model, from);
  if (piece === null) return model;
  const fromIndex = indexOfSquare(from);
  const toIndex = indexOfSquare(to);
  if (fromIndex === null || toIndex === null) return model;
  const board = [...model.board];
  board[fromIndex] = null;
  board[toIndex] = piece;
  return normalise(withBoard(model, board));
}

/** Empties the board. Castling rights, en-passant target and the clocks reset with it. */
export function clearBoard(model: EditorModel): EditorModel {
  return {
    board: emptyBoard(),
    turn: model.turn,
    castling: { ...NO_RIGHTS },
    enPassant: null,
    halfmove: 0,
    fullmove: 1,
  };
}

/** Resets to the standard start position, discarding everything else. */
export function resetToStart(): EditorModel {
  return startModel();
}

export function setTurn(model: EditorModel, turn: Color): EditorModel {
  if (model.turn === turn) return model;
  // Flipping the side to move invalidates any en-passant target, which `normalise` clears.
  return normalise({ ...model, turn });
}

/**
 * Toggles a castling right. Turning one *on* is refused when the placement cannot support it
 * (`canCastle` tells the UI to disable the control and say why); turning one off always works.
 */
export function toggleCastling(model: EditorModel, right: CastlingRight): EditorModel {
  const next = !model.castling[right];
  if (next && !canCastle(model, right)) return model;
  return { ...model, castling: { ...model.castling, [right]: next } };
}

/** Sets (or clears, with `null`) the en-passant target. Impossible targets are refused. */
export function setEnPassant(model: EditorModel, square: Square | null): EditorModel {
  if (square === null) {
    return model.enPassant === null ? model : { ...model, enPassant: null };
  }
  if (!isSquare(square)) return model;
  const candidate: EditorModel = { ...model, enPassant: square };
  if (!enPassantIsPossible(candidate)) return model;
  return candidate;
}

export function setClocks(model: EditorModel, halfmove: number, fullmove: number): EditorModel {
  const half = Number.isFinite(halfmove) ? Math.max(0, Math.trunc(halfmove)) : model.halfmove;
  const full = Number.isFinite(fullmove) ? Math.max(1, Math.trunc(fullmove)) : model.fullmove;
  if (half === model.halfmove && full === model.fullmove) return model;
  return { ...model, halfmove: half, fullmove: full };
}

/* ------------------------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------------------------ */

const COLOR_NAME: Record<Color, string> = { w: 'White', b: 'Black' };

function invalid(error: string): EditorValidation {
  return { valid: false, error };
}

/**
 * Why this position cannot be analysed, phrased for a human. Structural checks first (so the
 * message is ours and specific), then the rule-level checks from `game.ts` — which also cover
 * "the side that is not to move is already in check" and adjacent kings.
 */
export function validate(model: EditorModel): EditorValidation {
  const pieces = placedPieces(model);

  // Before the counting checks: a pawn parked on a back rank is the more specific complaint when
  // both apply (dropping a ninth pawn on rank 8 should not be reported as "9 pawns").
  for (const { square, piece } of pieces) {
    if (piece.type !== 'p') continue;
    const { rank } = squareToCoords(square);
    if (rank === 0 || rank === 7) {
      return invalid(`A pawn cannot stand on rank ${rank === 0 ? 1 : 8} (${square})`);
    }
  }

  for (const color of ['w', 'b'] as const) {
    const own = pieces.filter((p) => p.piece.color === color);
    const kings = own.filter((p) => p.piece.type === 'k');
    if (kings.length === 0) return invalid(`${COLOR_NAME[color]} has no king`);
    if (kings.length > 1) {
      return invalid(
        `${COLOR_NAME[color]} has ${kings.length} kings; exactly one king per side is required`,
      );
    }
    const pawns = own.filter((p) => p.piece.type === 'p');
    if (pawns.length > 8) {
      return invalid(`${COLOR_NAME[color]} has ${pawns.length} pawns; the maximum is 8`);
    }
    if (own.length > 16) {
      return invalid(`${COLOR_NAME[color]} has ${own.length} pieces; the maximum is 16`);
    }
  }

  const badRights = impossibleCastlingRights(model);
  if (badRights.length > 0) {
    const names = badRights.map(castlingLabel).join(', ');
    return invalid(
      `Castling is not possible for ${names}: the king or rook is not on its home square`,
    );
  }

  if (!enPassantIsPossible(model)) {
    return invalid(
      `En-passant target ${model.enPassant ?? '-'} does not match the pawn placement`,
    );
  }

  // Rule-level legality (chess.js, via the one module allowed to import it).
  const rules = validateFenRules(toFen(model));
  if (!rules.valid) return invalid(rules.error ?? 'This position is not legal');

  return { valid: true };
}

/** Convenience for the UI: validate a FEN string straight through the editor model. */
export function validateFenString(fen: string): EditorValidation {
  const structural = isValidFen(fen);
  if (!structural.valid) return invalid(structural.error ?? 'Invalid FEN');
  const model = fromFen(fen);
  if (model === null) return invalid('Invalid FEN');
  return validate(model);
}
