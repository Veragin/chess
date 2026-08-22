/**
 * The ONLY module in the app that imports `chess.js` (README §6). Everything else consumes
 * plain data: FEN strings, SAN strings and the `LegalMove` records below.
 *
 * Installed chess.js: 1.4.0. Notes on that API surface, since it differs from 0.x:
 *  - named export `Chess`, plus a standalone `validateFen(fen): { ok, error? }`
 *  - predicates are `isCheckmate()/isStalemate()/isDraw()/inCheck()`, not `in_*`
 *  - `move()` THROWS on illegal input (it does not return null) and returns a `Move` whose
 *    capture/castle/en-passant facts are methods (`isCapture()`, `isKingsideCastle()`, ...)
 *  - `move(null)` is a legal "null move" that just flips the turn — it must be rejected here
 *  - `moves({ verbose: true })` returns `Move[]`
 *  - `Move.isCapture()` reports FALSE for an en-passant capture (flag 'e'); normalised below
 *  - `move({ from, to })` onto a promotion square THROWS when `promotion` is omitted, so the
 *    UI must resolve the piece choice first (`isPromotion` exists for exactly that)
 *  - `Square` is a strict string-literal union, so our looser `Square = string` is cast at
 *    the boundary after validating with `isSquare`
 */

import { Chess, validateFen } from 'chess.js';
import type { Move, Square as ChessSquare } from 'chess.js';
import { isSquare, isValidFen, squareToCoords, START_FEN, type Square } from './position';

export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type PromotionPiece = 'q' | 'r' | 'b' | 'n';

export interface PlacedPiece {
  square: Square;
  color: Color;
  type: PieceType;
}

export interface LegalMove {
  from: Square;
  to: Square;
  san: string;
  piece: PieceType;
  color: Color;
  promotion?: PromotionPiece;
  captured?: PieceType;
  isCapture: boolean;
  isEnPassant: boolean;
  isKingsideCastle: boolean;
  isQueensideCastle: boolean;
}

export interface MoveInput {
  from: Square;
  to: Square;
  promotion?: PromotionPiece;
}

export interface GameStatus {
  turn: Color;
  inCheck: boolean;
  isCheckmate: boolean;
  isStalemate: boolean;
  isDraw: boolean;
  isInsufficientMaterial: boolean;
  isThreefoldRepetition: boolean;
  isGameOver: boolean;
  /** Square of the king of the side to move, when in check; else null. */
  checkedKingSquare: Square | null;
}

export interface Game {
  fen(): string;
  turn(): Color;
  pieces(): PlacedPiece[];
  legalMoves(): LegalMove[];
  legalMovesFrom(square: Square): LegalMove[];
  /** Applies the move. Returns null and leaves state untouched if illegal. */
  move(m: string | MoveInput): LegalMove | null;
  undo(): LegalMove | null;
  status(): GameStatus;
  /** SAN history, oldest first. */
  history(): string[];
  clone(): Game;
  /** True if a pawn move from->to would be a promotion (used to trigger the dialog). */
  isPromotion(from: Square, to: Square): boolean;
}

const PROMOTION_PIECES: readonly string[] = ['q', 'r', 'b', 'n'];

function toChessSquare(sq: Square): ChessSquare {
  return sq as ChessSquare;
}

function toLegalMove(m: Move): LegalMove {
  const out: LegalMove = {
    from: m.from,
    to: m.to,
    san: m.san,
    piece: m.piece,
    color: m.color,
    // chess.js 1.4.0 quirk: `isCapture()` is false for en passant (flag 'e'), even though
    // `captured` is set. Normalise it — callers highlight captures off this flag.
    isCapture: m.isCapture() || m.isEnPassant(),
    isEnPassant: m.isEnPassant(),
    isKingsideCastle: m.isKingsideCastle(),
    isQueensideCastle: m.isQueensideCastle(),
  };
  if (m.promotion !== undefined) {
    out.promotion = m.promotion as PromotionPiece;
  }
  if (m.captured !== undefined) {
    out.captured = m.captured;
  }
  return out;
}

/** Normalises a caller-supplied move into something chess.js will accept, or null. */
function normaliseMoveArg(
  m: string | MoveInput,
): string | { from: string; to: string; promotion?: string } | null {
  if (typeof m === 'string') {
    const san = m.trim();
    // `move(null)` and the '--' null move must never be reachable from app code.
    if (san.length === 0 || san === '--') return null;
    return san;
  }
  if (m === null || typeof m !== 'object') return null;
  if (!isSquare(m.from) || !isSquare(m.to)) return null;
  if (m.promotion !== undefined && !PROMOTION_PIECES.includes(m.promotion)) return null;
  return m.promotion === undefined
    ? { from: m.from, to: m.to }
    : { from: m.from, to: m.to, promotion: m.promotion };
}

class GameImpl implements Game {
  private readonly chess: Chess;

  constructor(chess: Chess) {
    this.chess = chess;
  }

  fen(): string {
    return this.chess.fen();
  }

  turn(): Color {
    return this.chess.turn();
  }

  pieces(): PlacedPiece[] {
    const out: PlacedPiece[] = [];
    for (const row of this.chess.board()) {
      for (const cell of row) {
        if (cell) {
          out.push({ square: cell.square, color: cell.color, type: cell.type });
        }
      }
    }
    return out;
  }

  legalMoves(): LegalMove[] {
    return this.chess.moves({ verbose: true }).map(toLegalMove);
  }

  legalMovesFrom(square: Square): LegalMove[] {
    if (!isSquare(square)) return [];
    return this.chess
      .moves({ verbose: true, square: toChessSquare(square) })
      .map(toLegalMove);
  }

  move(m: string | MoveInput): LegalMove | null {
    const arg = normaliseMoveArg(m);
    if (arg === null) return null;
    try {
      // chess.js throws on illegal input and leaves the position untouched.
      return toLegalMove(this.chess.move(arg));
    } catch {
      return null;
    }
  }

  undo(): LegalMove | null {
    const m = this.chess.undo();
    return m === null ? null : toLegalMove(m);
  }

  status(): GameStatus {
    const turn = this.chess.turn();
    const inCheck = this.chess.inCheck();
    let checkedKingSquare: Square | null = null;
    if (inCheck) {
      const kings = this.chess.findPiece({ type: 'k', color: turn });
      checkedKingSquare = kings[0] ?? null;
    }
    return {
      turn,
      inCheck,
      isCheckmate: this.chess.isCheckmate(),
      isStalemate: this.chess.isStalemate(),
      isDraw: this.chess.isDraw(),
      isInsufficientMaterial: this.chess.isInsufficientMaterial(),
      isThreefoldRepetition: this.chess.isThreefoldRepetition(),
      isGameOver: this.chess.isGameOver(),
      checkedKingSquare,
    };
  }

  history(): string[] {
    return this.chess.history();
  }

  clone(): Game {
    // Replaying the SAN history preserves repetition/50-move counters, which a bare
    // FEN copy would lose.
    const fresh = new Chess(this.startFen(), { skipValidation: true });
    for (const san of this.chess.history()) {
      fresh.move(san);
    }
    return new GameImpl(fresh);
  }

  isPromotion(from: Square, to: Square): boolean {
    if (!isSquare(from) || !isSquare(to)) return false;
    const piece = this.chess.get(toChessSquare(from));
    if (!piece || piece.type !== 'p') return false;
    const targetRank = squareToCoords(to).rank;
    const promotionRank = piece.color === 'w' ? 7 : 0;
    if (targetRank !== promotionRank) return false;
    return this.legalMovesFrom(from).some((m) => m.to === to && m.promotion !== undefined);
  }

  /** FEN the current game started from, recovered by rewinding the move history. */
  private startFen(): string {
    const verbose = this.chess.history({ verbose: true });
    const first = verbose[0];
    return first === undefined ? this.chess.fen() : first.before;
  }
}

/** Throws only if `fen` is unparseable; prefer `validateFenRules` first. */
export function createGame(fen?: string): Game {
  const target = fen ?? START_FEN;
  const structural = isValidFen(target);
  if (!structural.valid) {
    throw new Error(structural.error ?? 'Invalid FEN');
  }
  return new GameImpl(new Chess(target));
}

/**
 * Rule-level legality. chess.js `validateFen` already rejects a missing or duplicated king,
 * pawns on the back ranks and a malformed en-passant target; it does NOT reject a position
 * where the side that is *not* to move is in check, nor adjacent kings. Both are added here.
 */
export function validateFenRules(fen: string): { valid: boolean; error?: string } {
  const structural = isValidFen(fen);
  if (!structural.valid) return structural;

  const res = validateFen(fen.trim());
  if (!res.ok) {
    return { valid: false, error: res.error ?? 'Invalid FEN' };
  }

  let chess: Chess;
  try {
    chess = new Chess(fen.trim());
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Invalid FEN' };
  }

  const turn = chess.turn();
  const waiting: Color = turn === 'w' ? 'b' : 'w';

  const kings = {
    w: chess.findPiece({ type: 'k', color: 'w' })[0],
    b: chess.findPiece({ type: 'k', color: 'b' })[0],
  };
  if (kings.w === undefined) return { valid: false, error: 'Missing white king' };
  if (kings.b === undefined) return { valid: false, error: 'Missing black king' };

  // Kings may never stand on adjacent squares.
  const a = squareToCoords(kings.w);
  const b = squareToCoords(kings.b);
  if (Math.max(Math.abs(a.file - b.file), Math.abs(a.rank - b.rank)) <= 1) {
    return { valid: false, error: 'Kings are adjacent' };
  }

  // The side that just moved cannot be left in check — that position is unreachable.
  const waitingKing = waiting === 'w' ? kings.w : kings.b;
  if (chess.isAttacked(toChessSquare(waitingKing), turn)) {
    const name = waiting === 'w' ? 'White' : 'Black';
    return {
      valid: false,
      error: `${name} is in check but it is not ${name}'s turn`,
    };
  }

  return { valid: true };
}

export function sanToUci(fen: string, san: string): string | null {
  let game: Game;
  try {
    game = createGame(fen);
  } catch {
    return null;
  }
  const applied = game.move(san);
  if (applied === null) return null;
  return `${applied.from}${applied.to}${applied.promotion ?? ''}`;
}

/** Parses a UCI move string ('e2e4', 'e7e8q') into a `MoveInput`. */
function parseUci(uci: string): MoveInput | null {
  if (typeof uci !== 'string') return null;
  const trimmed = uci.trim().toLowerCase();
  if (trimmed.length !== 4 && trimmed.length !== 5) return null;
  const from = trimmed.slice(0, 2);
  const to = trimmed.slice(2, 4);
  if (!isSquare(from) || !isSquare(to)) return null;
  if (trimmed.length === 4) return { from, to };
  const promotion = trimmed[4] as string;
  if (!PROMOTION_PIECES.includes(promotion)) return null;
  return { from, to, promotion: promotion as PromotionPiece };
}

export function uciToSan(fen: string, uci: string): string | null {
  const input = parseUci(uci);
  if (input === null) return null;
  let game: Game;
  try {
    game = createGame(fen);
  } catch {
    return null;
  }
  const applied = game.move(input);
  return applied === null ? null : applied.san;
}

/** Converts a UCI pv to SAN, stopping at the first move that is illegal. */
export function pvToSan(fen: string, uciMoves: string[]): string[] {
  let game: Game;
  try {
    game = createGame(fen);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const uci of uciMoves) {
    const input = parseUci(uci);
    if (input === null) break;
    const applied = game.move(input);
    if (applied === null) break;
    out.push(applied.san);
  }
  return out;
}

export interface ReplayResult {
  ok: boolean;
  /** 0-based index of the first move that could not be played, when !ok. */
  failedAtPly?: number;
  /** FEN after each successfully applied move (does not include startFen). */
  fens: string[];
  /** SAN as normalised by chess.js. */
  sans: string[];
}

export function replaySan(startFen: string, sanMoves: string[]): ReplayResult {
  let game: Game;
  try {
    game = createGame(startFen);
  } catch {
    return { ok: false, failedAtPly: 0, fens: [], sans: [] };
  }

  const fens: string[] = [];
  const sans: string[] = [];
  for (let i = 0; i < sanMoves.length; i++) {
    const san = sanMoves[i];
    const applied = san === undefined ? null : game.move(san);
    if (applied === null) {
      return { ok: false, failedAtPly: i, fens, sans };
    }
    sans.push(applied.san);
    fens.push(game.fen());
  }
  return { ok: true, fens, sans };
}

/** FEN after applying all moves, or null if any is illegal. */
export function fenAfter(startFen: string, sanMoves: string[]): string | null {
  const result = replaySan(startFen, sanMoves);
  if (!result.ok) return null;
  const last = result.fens[result.fens.length - 1];
  if (last !== undefined) return last;
  // No moves: hand back the normalised start position.
  try {
    return createGame(startFen).fen();
  } catch {
    return null;
  }
}
