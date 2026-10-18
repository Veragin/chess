/**
 * Threats: moves a position *threatens* — typically what the side that just moved would play
 * next if it were its turn again. A move node may list them (`MoveNode.threats`) as plain move
 * strings about the position **after** that move.
 *
 * A threat is normally written in SAN as the threatening side would play it, i.e. in the
 * position with the turn handed back (`threatFen`). For hand-written data, a SAN that is legal
 * for the side to move and a coordinate move (`f3f7`, no legality asked) are accepted too, so
 * any sensible spelling still lands on the board. Pure; never throws.
 */

import { createGame, validateFenRules, type MoveInput } from './game';
import { isSquare, type Square } from './position';

/** A threat placed on the board. */
export interface ThreatMark {
  /** As stored. */
  move: string;
  from: Square;
  to: Square;
}

/**
 * `fen` with the other side to move (en passant cleared) — the position in which the side that
 * just moved plays its threats. `null` when that position is not legal (the side to move is in
 * check, so handing the turn back would leave a king en prise) or `fen` does not parse.
 */
export function threatFen(fen: string): string | null {
  const fields = fen.trim().split(/\s+/);
  if (fields.length < 4) return null;
  fields[1] = fields[1] === 'w' ? 'b' : 'w';
  fields[3] = '-';
  const flipped = fields.join(' ');
  return validateFenRules(flipped).valid ? flipped : null;
}

/** SAN of `move` played in `threatFen(fen)`, or `null` when it is not a legal threat there. */
export function threatSan(fen: string, move: MoveInput): string | null {
  const flipped = threatFen(fen);
  if (flipped === null) return null;
  try {
    return createGame(flipped).move(move)?.san ?? null;
  } catch {
    return null;
  }
}

/** Squares of `move` as a legal move in `fen`, or `null`. */
function playedSquares(fen: string | null, move: string): { from: Square; to: Square } | null {
  if (fen === null) return null;
  try {
    const applied = createGame(fen).move(move);
    return applied === null ? null : { from: applied.from, to: applied.to };
  } catch {
    return null;
  }
}

/** Squares of a coordinate move (`f3f7`, `e7e8q`), or `null`. */
function coordinateSquares(move: string): { from: Square; to: Square } | null {
  const m = /^([a-h][1-8])-?([a-h][1-8])[qrbn]?$/i.exec(move.trim());
  if (m === null) return null;
  const from = (m[1] as string).toLowerCase();
  const to = (m[2] as string).toLowerCase();
  return isSquare(from) && isSquare(to) && from !== to ? { from, to } : null;
}

/**
 * The threats of the position `fen` placed on the board; moves that make no sense there are
 * skipped, as are repeats of the same squares.
 */
export function threatMarks(fen: string, threats: readonly string[] | undefined): ThreatMark[] {
  if (threats === undefined || threats.length === 0) return [];
  const flipped = threatFen(fen);
  const out: ThreatMark[] = [];
  const seen = new Set<string>();
  for (const move of threats) {
    if (typeof move !== 'string' || move.trim().length === 0) continue;
    const squares =
      playedSquares(flipped, move.trim()) ??
      playedSquares(fen, move.trim()) ??
      coordinateSquares(move);
    if (squares === null) continue;
    const key = `${squares.from}${squares.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ move, ...squares });
  }
  return out;
}

/** Threats trimmed, blanks and repeats dropped; `undefined` when none are left. */
export function normaliseThreats(threats: readonly unknown[] | undefined): string[] | undefined {
  if (!Array.isArray(threats)) return undefined;
  const out: string[] = [];
  for (const raw of threats) {
    if (typeof raw !== 'string') continue;
    const move = raw.trim();
    if (move.length > 0 && !out.includes(move)) out.push(move);
  }
  return out.length > 0 ? out : undefined;
}
