/**
 * Pure UCI text parsing. No worker, no DOM, no side effects — this file is the unit-tested
 * heart of Phase 3.
 *
 * THE SIGN RULE (README §6, §8.1): a UCI `score` is always from the perspective of the side
 * to move. Every score that leaves this module has been negated when it was Black's move, so
 * `EngineLine.cp` / `EngineLine.mate` are ALWAYS positive-good-for-White. Nothing downstream
 * (eval bar, engine lines, drill) may negate again.
 */

import type { Color } from '../chess/game';

export interface EngineLine {
  multipv: number; // 1-based
  depth: number;
  /** Centipawns, ALWAYS normalised to White's perspective. */
  cp: number | null;
  /** Mate distance in moves, White's perspective (+ = White mates). */
  mate: number | null;
  /** Principal variation as UCI moves, e.g. ['e2e4','e7e5']. */
  pv: string[];
}

export interface EngineState {
  status: 'idle' | 'loading' | 'ready' | 'analyzing' | 'error';
  fen: string | null;
  lines: EngineLine[]; // sorted by multipv
  nps?: number;
  error?: string;
}

export type UciEvent =
  | { kind: 'uciok' }
  | { kind: 'readyok' }
  | { kind: 'bestmove'; move: string; ponder?: string }
  | { kind: 'info'; line: EngineLine; nps?: number }
  | { kind: 'other'; raw: string };

/** Clamp bounds for the eval bar so it never reads as fully empty (README §6). */
export const WIN_PROB_MIN = 0.02;
export const WIN_PROB_MAX = 0.98;

/** Parses a non-negative integer token; returns null for anything else (never throws). */
function toInt(token: string | undefined): number | null {
  if (token === undefined) return null;
  // Reject '', '12abc', 'e2e4', '1.5'; accept '-3', '+3', '0'.
  if (!/^[+-]?\d+$/.test(token)) return null;
  const n = Number.parseInt(token, 10);
  return Number.isFinite(n) ? n : null;
}

/** Negate for Black so the result is White-positive. `-0` is normalised to `0`. */
function toWhitePerspective(value: number, turn: Color): number {
  if (value === 0) return 0;
  return turn === 'b' ? -value : value;
}

const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbnQRBN]?$/;

/**
 * `turn` is the side to move in the analysed position; scores are negated for 'b' so the
 * result is ALWAYS White-positive. Malformed input returns { kind: 'other' } — never throws.
 */
export function parseUciLine(raw: string, turn: Color): UciEvent {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') return { kind: 'other', raw: typeof raw === 'string' ? raw : '' };

  const tokens = text.split(/\s+/);
  const head = tokens[0];

  if (head === 'uciok') return { kind: 'uciok' };
  if (head === 'readyok') return { kind: 'readyok' };

  if (head === 'bestmove') {
    const move = tokens[1];
    if (!move) return { kind: 'other', raw: text };
    // `bestmove (none)` is emitted for a terminal position; report it as-is.
    const ponderAt = tokens.indexOf('ponder');
    const ponder = ponderAt > 0 ? tokens[ponderAt + 1] : undefined;
    return ponder ? { kind: 'bestmove', move, ponder } : { kind: 'bestmove', move };
  }

  if (head === 'info') return parseInfo(tokens, text, turn);

  return { kind: 'other', raw: text };
}

function parseInfo(tokens: string[], text: string, turn: Color): UciEvent {
  let depth = 0;
  let multipv = 1;
  let cp: number | null = null;
  let mate: number | null = null;
  let nps: number | undefined;
  let pv: string[] = [];
  let sawScore = false;

  for (let i = 1; i < tokens.length; i += 1) {
    const key = tokens[i];
    switch (key) {
      case 'depth': {
        const v = toInt(tokens[i + 1]);
        if (v !== null) {
          depth = v;
          i += 1;
        }
        break;
      }
      case 'seldepth':
      case 'nodes':
      case 'time':
      case 'hashfull':
      case 'tbhits':
      case 'currmovenumber': {
        // Parsed only so their values can never be mistaken for another key's value.
        if (toInt(tokens[i + 1]) !== null) i += 1;
        break;
      }
      case 'currmove': {
        if (tokens[i + 1] !== undefined) i += 1;
        break;
      }
      case 'nps': {
        const v = toInt(tokens[i + 1]);
        if (v !== null) {
          nps = v;
          i += 1;
        }
        break;
      }
      case 'multipv': {
        const v = toInt(tokens[i + 1]);
        if (v !== null && v >= 1) {
          multipv = v;
          i += 1;
        }
        break;
      }
      case 'score': {
        const kindTok = tokens[i + 1];
        const v = toInt(tokens[i + 2]);
        if ((kindTok === 'cp' || kindTok === 'mate') && v !== null) {
          if (kindTok === 'cp') {
            cp = toWhitePerspective(v, turn);
            mate = null;
          } else {
            // Negative mate = the side to move is getting mated.
            mate = toWhitePerspective(v, turn);
            cp = null;
          }
          sawScore = true;
          i += 2;
          // `lowerbound` / `upperbound` follow the value on fail-high/fail-low reports; the
          // score is still meaningful, so keep it and just consume the flag.
          const bound = tokens[i + 1];
          if (bound === 'lowerbound' || bound === 'upperbound') i += 1;
        }
        break;
      }
      case 'pv': {
        pv = tokens.slice(i + 1).filter((m) => UCI_MOVE.test(m));
        i = tokens.length; // `pv` is always last
        break;
      }
      case 'string': {
        // Free text to end of line (e.g. `info string NNUE evaluation using ...`).
        i = tokens.length;
        break;
      }
      default:
        break;
    }
  }

  // Without a score there is nothing to show; `info depth 1 currmove e2e4` and friends are
  // deliberately not surfaced as engine lines.
  if (!sawScore) return { kind: 'other', raw: text };

  const line: EngineLine = { multipv, depth, cp, mate, pv };
  return nps === undefined ? { kind: 'info', line } : { kind: 'info', line, nps };
}

/** 1 / (1 + 10 ** (-cp / 400)), clamped to [0.02, 0.98]. Mate pins to the clamp bound. */
export function winProbability(cp: number | null, mate: number | null): number {
  if (mate !== null && Number.isFinite(mate)) {
    // A normalised mate score is White-positive; `0` (already mated) counts as White mating.
    return mate >= 0 ? WIN_PROB_MAX : WIN_PROB_MIN;
  }
  if (cp === null || !Number.isFinite(cp)) return 0.5;
  const p = 1 / (1 + 10 ** (-cp / 400));
  return Math.min(WIN_PROB_MAX, Math.max(WIN_PROB_MIN, p));
}

/** Display string: '+1.24', '-0.31', '#5', '#-3'. */
export function formatScore(cp: number | null, mate: number | null): string {
  if (mate !== null && Number.isFinite(mate)) return `#${mate}`;
  if (cp === null || !Number.isFinite(cp)) return '—';
  const pawns = cp / 100;
  const sign = pawns < 0 ? '-' : '+';
  return `${sign}${Math.abs(pawns).toFixed(2)}`;
}
