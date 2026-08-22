/**
 * Linear move history with a cursor (README §7 Phase 2).
 *
 * Deliberately DOM-free and React-free: this is plain data plus pure transitions, so it is
 * unit-testable without a renderer and reusable by analyze / line-play / drill later on.
 *
 * Model: a start position plus an ordered list of `{ san, fenAfter }` entries, and a cursor.
 * `cursor === -1` means "at the start position"; `cursor === entries.length - 1` means "at the
 * end". There is deliberately NO variation tree (README §1 non-goals) — making a move while the
 * cursor is behind the end TRUNCATES the future and appends.
 *
 * Every function is pure and returns a freshly built `HistoryState` with a freshly built
 * `entries` array. Navigation therefore cannot mutate the move list even by accident: callers
 * that hold on to an older state keep seeing exactly what they had. The extra array copy per
 * keystroke is irrelevant next to the DOM work it triggers.
 */

import { createGame, type Game, type MoveInput, type Color } from './game';
import type { Square } from './position';

export interface HistoryEntry {
  san: string;
  fenAfter: string;
}

export interface HistoryState {
  startFen: string;
  entries: HistoryEntry[];
  /** -1 = at the start position. Otherwise the index of the last applied entry. */
  cursor: number;
}

/** Copies `entries` up to and including `upTo` (pass -1 for "none"). */
function copyEntries(entries: HistoryEntry[], upTo: number): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (let i = 0; i <= upTo && i < entries.length; i++) {
    const e = entries[i];
    if (e !== undefined) out.push({ san: e.san, fenAfter: e.fenAfter });
  }
  return out;
}

/** Builds a new state, always with a fresh `entries` array. */
function state(startFen: string, entries: HistoryEntry[], cursor: number): HistoryState {
  return { startFen, entries, cursor };
}

function clampCursor(h: HistoryState, cursor: number): number {
  if (!Number.isFinite(cursor)) return -1;
  const c = Math.trunc(cursor);
  if (c < -1) return -1;
  const max = h.entries.length - 1;
  return c > max ? max : c;
}

/**
 * `startFen` is normalised through `chess.js` so that `currentFen` at the start position is
 * directly comparable with the `fenAfter` strings the engine and the board see. An unparseable
 * FEN is kept verbatim rather than throwing — the UI stays alive and `applyMove` will simply
 * refuse every move.
 */
export function createHistory(startFen: string): HistoryState {
  const raw = typeof startFen === 'string' ? startFen.trim() : '';
  let normalised = raw;
  try {
    normalised = createGame(raw).fen();
  } catch {
    /* keep the raw string; applyMove/currentFen degrade gracefully */
  }
  return state(normalised, [], -1);
}

export function currentFen(h: HistoryState): string {
  const cursor = clampCursor(h, h.cursor);
  if (cursor < 0) return h.startFen;
  const entry = h.entries[cursor];
  return entry === undefined ? h.startFen : entry.fenAfter;
}

/**
 * Applies `m` from the position at the cursor, truncating anything after it, then appends.
 * Returns `null` (leaving the caller's state untouched) if the move is illegal.
 */
export function applyMove(h: HistoryState, m: string | MoveInput): HistoryState | null {
  let game: Game;
  try {
    game = createGame(currentFen(h));
  } catch {
    return null;
  }
  const applied = game.move(m);
  if (applied === null) return null;

  const entries = copyEntries(h.entries, clampCursor(h, h.cursor));
  entries.push({ san: applied.san, fenAfter: game.fen() });
  return state(h.startFen, entries, entries.length - 1);
}

/** Clamps out-of-range cursors instead of throwing. Never mutates or drops entries. */
export function jumpTo(h: HistoryState, cursor: number): HistoryState {
  return state(h.startFen, copyEntries(h.entries, h.entries.length - 1), clampCursor(h, cursor));
}

export function stepBack(h: HistoryState): HistoryState {
  return jumpTo(h, clampCursor(h, h.cursor) - 1);
}

export function stepForward(h: HistoryState): HistoryState {
  return jumpTo(h, clampCursor(h, h.cursor) + 1);
}

export function toStart(h: HistoryState): HistoryState {
  return jumpTo(h, -1);
}

export function toEnd(h: HistoryState): HistoryState {
  return jumpTo(h, h.entries.length - 1);
}

/* -------------------------------------------------------------------------------------- *
 * Helpers beyond the pinned contract. The UI (and Phases 4-7) need these; keeping them
 * here rather than in components is what keeps "unit tests only" viable (README §9).
 * -------------------------------------------------------------------------------------- */

/** SAN strings in order — the `moves` prop of `MoveList`. */
export function sansOf(h: HistoryState): string[] {
  return h.entries.map((e) => e.san);
}

export function moveCount(h: HistoryState): number {
  return h.entries.length;
}

export function isAtStart(h: HistoryState): boolean {
  return clampCursor(h, h.cursor) < 0;
}

export function isAtEnd(h: HistoryState): boolean {
  return clampCursor(h, h.cursor) >= h.entries.length - 1;
}

/** Side to move in the start position (a custom start FEN may have Black to move). */
export function startColor(h: HistoryState): Color {
  return fenSide(h.startFen);
}

/** Full-move number of the start position (FEN field 6), defaulting to 1. */
export function startMoveNumber(h: HistoryState): number {
  return fenMoveNumber(h.startFen);
}

/** Side that played the entry at `index`. */
export function colorAt(h: HistoryState, index: number): Color {
  return plyColor(startColor(h), index);
}

/** Side to move in the position at the cursor. */
export function sideToMove(h: HistoryState): Color {
  return plyColor(startColor(h), clampCursor(h, h.cursor) + 1);
}

/** Displayed full-move number of the entry at `index` (the "4" in "4. Nf3"). */
export function moveNumberFor(h: HistoryState, index: number): number {
  return plyMoveNumber(startColor(h), startMoveNumber(h), index);
}

/**
 * From/to squares of the move at the cursor, for the Board's `lastMove` prop. `null` at the
 * start position (nothing has been played) or if the entry cannot be replayed.
 *
 * Derived from the SAN through `game.ts`: `HistoryEntry` stores SAN only, and the Board needs
 * squares.
 */
export function lastMoveOf(h: HistoryState): { from: Square; to: Square } | null {
  const cursor = clampCursor(h, h.cursor);
  if (cursor < 0) return null;
  const entry = h.entries[cursor];
  if (entry === undefined) return null;

  const before = cursor === 0 ? h.startFen : (h.entries[cursor - 1]?.fenAfter ?? h.startFen);
  try {
    const applied = createGame(before).move(entry.san);
    return applied === null ? null : { from: applied.from, to: applied.to };
  } catch {
    return null;
  }
}

/**
 * Builds a history from a start position and a SAN sequence, cursor at the end — used to hand a
 * saved `Line` to analyze / line play. Returns `null` if any move is illegal.
 */
export function historyFromSan(startFen: string, sanMoves: string[]): HistoryState | null {
  const base = createHistory(startFen);
  let game: Game;
  try {
    game = createGame(base.startFen);
  } catch {
    return null;
  }
  const entries: HistoryEntry[] = [];
  for (const san of sanMoves) {
    const applied = game.move(san);
    if (applied === null) return null;
    entries.push({ san: applied.san, fenAfter: game.fen() });
  }
  return state(base.startFen, entries, entries.length - 1);
}

/* --- small FEN/ply arithmetic, kept private-ish but exported where the UI needs it ----- */

function fenSide(fen: string): Color {
  const field = fen.trim().split(/\s+/)[1];
  return field === 'b' ? 'b' : 'w';
}

function fenMoveNumber(fen: string): number {
  const field = fen.trim().split(/\s+/)[5];
  const n = field === undefined ? NaN : Number.parseInt(field, 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Side that plays ply `index` (0-based) given the side to move at the start. */
export function plyColor(start: Color, index: number): Color {
  const white = index % 2 === 0 ? start === 'w' : start === 'b';
  return white ? 'w' : 'b';
}

/**
 * Full-move number of ply `index` (0-based). With Black to move at the start, ply 0 is Black's
 * half of `startNumber`, and the number only increments before each subsequent White move.
 */
export function plyMoveNumber(start: Color, startNumber: number, index: number): number {
  const offset = start === 'w' ? Math.floor(index / 2) : Math.floor((index + 1) / 2);
  return startNumber + offset;
}
