/**
 * Pure position/FEN helpers. Deliberately free of `chess.js` — this module must be usable
 * (and testable) without pulling in the rules engine. Rule-level legality lives in
 * `game.ts` as `validateFenRules`.
 */

export type Square = string; // 'a1'..'h8'
export type Orientation = 'white' | 'black';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const EMPTY_FEN = '8/8/8/8/8/8/8/8 w - - 0 1';

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
export const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;

export interface FenValidation {
  valid: boolean;
  error?: string;
}

const PIECE_CHARS = 'pnbrqkPNBRQK';

function invalid(error: string): FenValidation {
  return { valid: false, error };
}

/**
 * Structural FEN validation: field count, board layout, and the shape of every trailing
 * field. It does NOT judge whether the position is reachable or rule-legal — that is
 * `validateFenRules` in `game.ts`.
 */
export function isValidFen(fen: string): FenValidation {
  if (typeof fen !== 'string') return invalid('FEN must be a string');
  const trimmed = fen.trim();
  if (trimmed.length === 0) return invalid('FEN is empty');

  const fields = trimmed.split(/\s+/);
  if (fields.length !== 6) {
    return invalid(`FEN must have 6 space-separated fields, got ${fields.length}`);
  }

  const [board, side, castling, ep, halfmove, fullmove] = fields as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  // --- Field 1: piece placement -------------------------------------------------
  const ranks = board.split('/');
  if (ranks.length !== 8) {
    return invalid(`Piece placement must have 8 ranks, got ${ranks.length}`);
  }
  for (let i = 0; i < 8; i++) {
    const rank = ranks[i] as string;
    const rankName = String(8 - i);
    if (rank.length === 0) return invalid(`Rank ${rankName} is empty`);
    let count = 0;
    let prevWasDigit = false;
    for (const ch of rank) {
      if (ch >= '1' && ch <= '8') {
        if (prevWasDigit) {
          return invalid(`Rank ${rankName} has consecutive digits`);
        }
        count += ch.charCodeAt(0) - 48;
        prevWasDigit = true;
      } else if (PIECE_CHARS.includes(ch)) {
        count += 1;
        prevWasDigit = false;
      } else {
        return invalid(`Rank ${rankName} contains an invalid character '${ch}'`);
      }
    }
    if (count !== 8) {
      return invalid(`Rank ${rankName} describes ${count} squares, expected 8`);
    }
  }

  // --- Field 2: side to move ----------------------------------------------------
  if (side !== 'w' && side !== 'b') {
    return invalid(`Side to move must be 'w' or 'b', got '${side}'`);
  }

  // --- Field 3: castling availability -------------------------------------------
  if (castling !== '-') {
    if (!/^K?Q?k?q?$/.test(castling)) {
      return invalid(`Castling availability is invalid: '${castling}'`);
    }
  }

  // --- Field 4: en-passant target -----------------------------------------------
  if (ep !== '-') {
    if (!isSquare(ep)) {
      return invalid(`En-passant target is not a square: '${ep}'`);
    }
    const rank = ep[1];
    if (rank !== '3' && rank !== '6') {
      return invalid(`En-passant target must be on rank 3 or 6, got '${ep}'`);
    }
    // The en-passant rank must agree with the side to move: after White's double push
    // the target is on rank 3 and it is Black's turn, and vice versa.
    if (side === 'w' && rank !== '6') {
      return invalid(`En-passant target '${ep}' is inconsistent with White to move`);
    }
    if (side === 'b' && rank !== '3') {
      return invalid(`En-passant target '${ep}' is inconsistent with Black to move`);
    }
  }

  // --- Fields 5 & 6: move counters ----------------------------------------------
  if (!/^\d+$/.test(halfmove)) {
    return invalid(`Halfmove clock must be a non-negative integer, got '${halfmove}'`);
  }
  if (!/^\d+$/.test(fullmove)) {
    return invalid(`Fullmove number must be a positive integer, got '${fullmove}'`);
  }
  if (Number(fullmove) < 1) {
    return invalid(`Fullmove number must be at least 1, got '${fullmove}'`);
  }

  return { valid: true };
}

/** file 0 = 'a' .. 7 = 'h'; rank 0 = rank 1 .. 7 = rank 8. */
export function squareToCoords(sq: Square): { file: number; rank: number } {
  if (!isSquare(sq)) {
    throw new Error(`Not a square: '${sq}'`);
  }
  return {
    file: (sq.charCodeAt(0) as number) - 97,
    rank: (sq.charCodeAt(1) as number) - 49,
  };
}

export function coordsToSquare(file: number, rank: number): Square {
  if (!Number.isInteger(file) || file < 0 || file > 7) {
    throw new Error(`File out of range: ${file}`);
  }
  if (!Number.isInteger(rank) || rank < 0 || rank > 7) {
    throw new Error(`Rank out of range: ${rank}`);
  }
  return `${FILES[file] as string}${RANKS[rank] as string}`;
}

const SQUARE_RE = /^[a-h][1-8]$/;

export function isSquare(v: string): boolean {
  return typeof v === 'string' && SQUARE_RE.test(v);
}

export function squareShade(sq: Square): 'light' | 'dark' {
  const { file, rank } = squareToCoords(sq);
  // a1 (file 0, rank 0) is dark.
  return (file + rank) % 2 === 0 ? 'dark' : 'light';
}

/**
 * 64 squares in DOM render order (row-major, left-to-right, top-to-bottom) as seen by
 * `orientation`. First element is the top-left square: a8 for white, h1 for black.
 */
export function orderedSquares(orientation: Orientation): Square[] {
  const out: Square[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const file = orientation === 'white' ? col : 7 - col;
      const rank = orientation === 'white' ? 7 - row : row;
      out.push(coordsToSquare(file, rank));
    }
  }
  return out;
}

export function flipOrientation(o: Orientation): Orientation {
  return o === 'white' ? 'black' : 'white';
}

/** File labels left-to-right in render order. */
export function fileLabels(orientation: Orientation): string[] {
  const files = [...FILES];
  return orientation === 'white' ? files : files.reverse();
}

/** Rank labels top-to-bottom in render order. */
export function rankLabels(orientation: Orientation): string[] {
  const ranks = [...RANKS].reverse();
  return orientation === 'white' ? ranks : ranks.reverse();
}
