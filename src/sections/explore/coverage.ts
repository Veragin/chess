/**
 * Which saved lines pass through a position, and what each of them plays next.
 *
 * This is the whole point of the explore screen: standing in a position, "is this covered?" is
 * the question the repertoire cannot answer by itself, because lines are stored as linear move
 * lists and the same position is reached by more than one of them.
 *
 * Two decisions worth stating:
 *
 *  1. **Positions are matched by transposition, not by move order.** The key is the first four
 *     FEN fields (placement, side to move, castling rights, en-passant square) — the halfmove
 *     clock and the move number are what differ between two routes to the same position and are
 *     deliberately dropped. `chess.js` only writes an en-passant square when the capture is
 *     actually available, so that field is already transposition-safe.
 *  2. **Every line is replayed exactly once**, into an index keyed by position. A repertoire is
 *     small, but the alternative (replaying every line on every board move) makes the panel's
 *     cost grow with the repertoire on each click. Build the index from the line list, hold it,
 *     and each position is then a `Map` lookup.
 *
 * A line whose stored moves do not all replay (only reachable by hand-editing `localStorage`, or
 * by an edited start position) is indexed as far as it goes and reported in `broken`, rather than
 * being dropped silently or throwing: partial coverage is still coverage, and the screen says so.
 *
 * Pure and DOM-free — no React, no `localStorage` — so it is unit-tested on its own (README §9).
 */

import { createGame, replaySan } from '../../chess/game';
import type { Line } from '../../storage/schema';

/**
 * One line's visit to a position. `ply` counts the line's moves already played, so it is also
 * the index of the move it plays next — the same convention as `chess/line.ts`.
 */
export interface LineReach {
  line: Line;
  ply: number;
  /** Total plies in the line, so `ply === total` means "the line ends in this position". */
  total: number;
  /** SAN the line plays next (as `chess.js` normalises it), or `null` when there is no next move. */
  nextSan: string | null;
}

/** One continuation the repertoire plays from the position, and who plays it. */
export interface CoverageMove {
  san: string;
  /** Every visit that continues with `san`; a line that transposes twice appears twice. */
  reaches: LineReach[];
  /** Distinct lines behind `reaches`, sorted by name — what the UI counts and lists. */
  lines: Line[];
}

export interface Coverage {
  /** Every visit to the position, oldest line name first. */
  reaching: LineReach[];
  /** Distinct lines that pass through it, sorted by name. */
  lines: Line[];
  /** Continuations, most-played first. */
  moves: CoverageMove[];
  /** Lines whose last move lands exactly here. */
  endsHere: LineReach[];
  /** Lines that reach here but whose *next* stored move cannot be played (a damaged line). */
  breaksHere: LineReach[];
}

/** A line that could not be replayed in full, and where it gave up. */
export interface BrokenLine {
  line: Line;
  /** 0-based ply of the first unplayable move; `null` when the start position itself is illegal. */
  failedAtPly: number | null;
}

export interface CoverageIndex {
  /** `positionKey` → every visit to that position. */
  byPosition: Map<string, LineReach[]>;
  /** How many lines went into the index, damaged ones included. */
  lineCount: number;
  broken: BrokenLine[];
}

export const EMPTY_COVERAGE: Coverage = {
  reaching: [],
  lines: [],
  moves: [],
  endsHere: [],
  breaksHere: [],
};

/**
 * Position identity for transposition matching: placement, side to move, castling rights and the
 * en-passant square. Total — a malformed FEN yields a key that simply matches nothing real.
 */
export function positionKey(fen: string): string {
  const fields = typeof fen === 'string' ? fen.trim().split(/\s+/) : [];
  const placement = fields[0] ?? '';
  const turn = fields[1] === 'b' ? 'b' : 'w';
  const castling = fields[2] ?? '-';
  const enPassant = fields[3] ?? '-';
  return `${placement} ${turn} ${castling} ${enPassant}`;
}

function byName(a: Line, b: Line): number {
  const byLabel = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  return byLabel !== 0 ? byLabel : a.id.localeCompare(b.id);
}

/** Code-point order, not locale order: SAN is notation, and the tie-break must be the same
 *  everywhere. `localeCompare` would order `Nf3` against `e4` differently per ICU build. */
function bySan(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Distinct lines behind a set of visits, sorted by name. */
function distinctLines(reaches: readonly LineReach[]): Line[] {
  const seen = new Set<string>();
  const out: Line[] = [];
  for (const reach of reaches) {
    if (seen.has(reach.line.id)) continue;
    seen.add(reach.line.id);
    out.push(reach.line);
  }
  return out.sort(byName);
}

/**
 * Replays every line once and indexes each position it visits, its own start position included.
 * Call this on the line list (memoised), not per board move.
 */
export function buildCoverageIndex(lines: readonly Line[]): CoverageIndex {
  const byPosition = new Map<string, LineReach[]>();
  const broken: BrokenLine[] = [];

  for (const line of lines) {
    let startFen: string;
    try {
      startFen = createGame(line.startFen).fen();
    } catch {
      // Not a position at all: there is nothing to index, but the screen must be able to say so.
      broken.push({ line, failedAtPly: null });
      continue;
    }

    const replay = replaySan(startFen, line.moves);
    if (!replay.ok) {
      broken.push({ line, failedAtPly: replay.failedAtPly ?? replay.sans.length });
    }

    // The position before each played move, plus the position after the last one.
    const fens = [startFen, ...replay.fens];
    const total = line.moves.length;
    for (let ply = 0; ply < fens.length; ply++) {
      const key = positionKey(fens[ply] as string);
      const reach: LineReach = { line, ply, total, nextSan: replay.sans[ply] ?? null };
      const bucket = byPosition.get(key);
      if (bucket === undefined) byPosition.set(key, [reach]);
      else bucket.push(reach);
    }
  }

  return { byPosition, lineCount: lines.length, broken };
}

/** What the repertoire does in the position `fen` — the panel's whole input. */
export function coverageAt(index: CoverageIndex, fen: string): Coverage {
  const found = index.byPosition.get(positionKey(fen));
  if (found === undefined || found.length === 0) return EMPTY_COVERAGE;

  const reaching = found.slice().sort((a, b) => byName(a.line, b.line) || a.ply - b.ply);

  const grouped = new Map<string, LineReach[]>();
  const endsHere: LineReach[] = [];
  const breaksHere: LineReach[] = [];
  for (const reach of reaching) {
    if (reach.nextSan === null) {
      // No next move: either the line is complete here, or its next stored move is unplayable.
      if (reach.ply >= reach.total) endsHere.push(reach);
      else breaksHere.push(reach);
      continue;
    }
    const bucket = grouped.get(reach.nextSan);
    if (bucket === undefined) grouped.set(reach.nextSan, [reach]);
    else bucket.push(reach);
  }

  const moves: CoverageMove[] = [...grouped.entries()]
    .map(([san, reaches]) => ({ san, reaches, lines: distinctLines(reaches) }))
    // Most-played first so the main line leads; alphabetical within a tie keeps it stable.
    .sort((a, b) => b.lines.length - a.lines.length || bySan(a.san, b.san));

  return { reaching, lines: distinctLines(reaching), moves, endsHere, breaksHere };
}
