/**
 * Drill (README §7 Phase 7): repertoire recall, one line at a time, with nothing on screen but
 * the board.
 *
 * Two independent pieces of pure logic live here, both DOM-free and React-free so they can be
 * unit tested (README §1 "Testing"):
 *
 *  1. **The cycle** — which line to serve next. README: "Pick a line uniformly at random from
 *     the saved set, excluding lines already served in the current cycle; when every line has
 *     been served, reshuffle." That is a bag drawn *without replacement*, not independent
 *     random draws, and explicitly **not** spaced repetition (README §1 non-goals). Randomness
 *     is injected (`RandomInt`) so tests are deterministic.
 *  2. **The state machine** — `awaiting-user → auto-reply → complete`, built on the shared
 *     `LineSession` in `./line.ts`. Line following (who moves, what matches, auto-play) is
 *     *not* reimplemented here; this module only adds what drill needs on top: per-ply
 *     bookkeeping of whether the user actually knew the move, which is what the end-of-line
 *     summary reports.
 *
 * Scoring model, since "moves correct / hints used" needs a definition: every ply the **user**
 * owns is scored once. It counts as correct only if it was played with no wrong attempt and no
 * hint at that ply — a wrong move marks the attempt failed (README: "reject, mark the attempt
 * as failed, let them retry") and so does a hint ("also counts as failed"). Retrying the same
 * ply five times still costs exactly one move; the raw attempt counts are reported separately.
 *
 * Nothing here reads or writes storage: drill is practice, not editing, and there is no
 * spaced-repetition state to persist.
 */

import type { Color, MoveInput } from './game';
import { plyColor } from './history';
import {
  attemptMove,
  autoPlay,
  createSession,
  isSessionComplete,
  isSessionUserTurn,
  pendingAutoMove,
  revealNextMove,
  sessionExpectedSan,
  sessionExpectedSquares,
  sessionFen,
  sessionLastMove,
  sessionOrientation,
  sessionTotalPlies,
  type AttemptOutcome,
  type LineSession,
  type PlySquares,
  type ResolvedLine,
} from './line';
import type { Orientation } from './position';

/* ------------------------------------------------------------------------------------- *
 * 1. The cycle
 * ------------------------------------------------------------------------------------- */

/**
 * Returns an integer in `[0, n)` for `n > 0`. Injected everywhere a choice is made so the
 * cycle is deterministic under test; `defaultRandomInt` is the production implementation.
 */
export type RandomInt = (n: number) => number;

/** `Math.random`-backed default. The only place this module touches global randomness. */
export const defaultRandomInt: RandomInt = (n) => Math.floor(Math.random() * n);

/**
 * Progress through one pass over the saved set. `served` holds the ids already handed out in
 * the current cycle, oldest first; it is the "excluding lines already served" of the spec.
 *
 * Deliberately just ids: the cycle must survive the store changing underneath it (a line added
 * or deleted between draws), and it must never be able to serve a line that no longer exists.
 */
export interface DrillCycle {
  readonly served: readonly string[];
}

/** A fresh cycle with nothing served yet. */
export function emptyCycle(): DrillCycle {
  return { served: [] };
}

/** Unique ids, in input order, ignoring anything that is not a non-empty string. */
function normaliseIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Ids of the current pool that have not been served yet in `cycle`.
 *
 * Ids in `cycle.served` that are no longer in the pool are simply absent from both sides — a
 * line deleted mid-cycle stops being a candidate and stops blocking the reshuffle. A line
 * *added* mid-cycle joins the current cycle rather than waiting for the next one, which is the
 * behaviour a user expects right after saving a new line.
 */
export function remainingInCycle(ids: readonly string[], cycle: DrillCycle): string[] {
  const served = new Set(cycle.served);
  return normaliseIds(ids).filter((id) => !served.has(id));
}

/** Outcome of one draw. `id` is `null` only when the pool is empty. */
export interface DrillPick {
  id: string | null;
  /** Cycle to carry into the next draw. Pruned to the ids that still exist. */
  cycle: DrillCycle;
  /** True when this draw started a new pass because every line had been served. */
  reshuffled: boolean;
}

/**
 * Draws the next line id: uniformly at random from the ids not yet served this cycle,
 * reshuffling (emptying the cycle) once every line has been served.
 *
 * A cycle boundary may hand out the same line twice in a row — the last draw of one pass and
 * the first of the next are independent, exactly as the spec's "reshuffle" implies. That is
 * unavoidable for a single-line store and is not corrected for larger ones, because biasing
 * the first draw of a pass would stop it being uniform.
 */
export function pickNextLineId(
  ids: readonly string[],
  cycle: DrillCycle,
  rand: RandomInt = defaultRandomInt,
): DrillPick {
  const pool = normaliseIds(ids);
  if (pool.length === 0) return { id: null, cycle: emptyCycle(), reshuffled: false };

  // Drop served ids that no longer exist, so a deleted line cannot hold the cycle open.
  const inPool = new Set(pool);
  const served = cycle.served.filter((id) => inPool.has(id));

  const reshuffled = served.length >= pool.length;
  const base = reshuffled ? [] : served;
  const baseSet = new Set(base);
  const candidates = pool.filter((id) => !baseSet.has(id));

  const raw = rand(candidates.length);
  const index = Number.isInteger(raw) ? Math.min(Math.max(raw, 0), candidates.length - 1) : 0;
  const id = candidates[index];
  // Unreachable: `candidates` is non-empty whenever the pool is, either because the cycle had
  // room left or because reshuffling emptied it. Belt and braces rather than a `!`.
  if (id === undefined) return { id: null, cycle: emptyCycle(), reshuffled };

  return { id, cycle: { served: [...base, id] }, reshuffled };
}

/**
 * `pickNextLineId` over objects that carry an id, for callers holding records rather than bare
 * ids. Generic so this module needs no dependency on `storage/schema`.
 */
export function pickNextLine<T extends { id: string }>(
  items: readonly T[],
  cycle: DrillCycle,
  rand: RandomInt = defaultRandomInt,
): { item: T | null; cycle: DrillCycle; reshuffled: boolean } {
  const pick = pickNextLineId(
    items.map((item) => item.id),
    cycle,
    rand,
  );
  const item = pick.id === null ? null : (items.find((c) => c.id === pick.id) ?? null);
  return { item, cycle: pick.cycle, reshuffled: pick.reshuffled };
}

/* ------------------------------------------------------------------------------------- *
 * 2. The state machine
 * ------------------------------------------------------------------------------------- */

/**
 * README §7 Phase 7's three states.
 *
 *  - `awaiting-user`: the board accepts the user's colour; wrong moves bounce off it.
 *  - `auto-reply`: the opponent's line move is owed. The screen's timer drives `drillAutoPlay`.
 *  - `complete`: every ply played; show the summary and offer next line / exit.
 */
export type DrillPhase = 'awaiting-user' | 'auto-reply' | 'complete';

/**
 * One run through one line.
 *
 * `session` carries the position and the raw attempt/hint counters; the two ply lists are the
 * per-ply bookkeeping the summary needs. Immutable — every transition returns a new object (or
 * the same one for a no-op), so React can hold it and compare by identity.
 */
export interface DrillState {
  session: LineSession;
  /** User plies where the answer was got wrong or given away. Sorted, no duplicates. */
  readonly failedPlies: readonly number[];
  /** Subset of `failedPlies` where a hint was taken. Sorted, no duplicates. */
  readonly hintedPlies: readonly number[];
}

/** Starts a run at the beginning of `line`, played as the line's stored `userColor`. */
export function createDrill(line: ResolvedLine): DrillState {
  return { session: createSession(line), failedPlies: [], hintedPlies: [] };
}

function withPly(plies: readonly number[], ply: number): readonly number[] {
  return plies.includes(ply) ? plies : [...plies, ply].sort((a, b) => a - b);
}

/** Current state name. Derived, never stored, so it cannot drift from the session. */
export function drillPhase(s: DrillState): DrillPhase {
  if (isSessionComplete(s.session)) return 'complete';
  return isSessionUserTurn(s.session) ? 'awaiting-user' : 'auto-reply';
}

/** Position on the board right now. */
export function drillFen(s: DrillState): string {
  return sessionFen(s.session);
}

/** Colour the user is playing in this run. */
export function drillUserColor(s: DrillState): Color {
  return s.session.userColor;
}

/** Board orientation: the line's start position seen from `userColor` (README §7 Phase 7). */
export function drillOrientation(s: DrillState): Orientation {
  return sessionOrientation(s.session);
}

/** From/to of the move just played, for the Board's `lastMove` prop. */
export function drillLastMove(s: DrillState): PlySquares | null {
  return sessionLastMove(s.session);
}

/** Plies played so far — the index of the ply expected next. */
export function drillPly(s: DrillState): number {
  return s.session.ply;
}

/** The move the app owes the board, or `null` when it is the user's turn / the line ended. */
export function drillPendingAutoMove(s: DrillState): string | null {
  return pendingAutoMove(s.session);
}

/** True if the user owns ply `ply` in this run. Pure arithmetic — no replay. */
function userOwnsPly(s: DrillState, ply: number): boolean {
  return plyColor(s.session.line.startColor, ply) === s.session.userColor;
}

/** Total plies the user has to produce in this line. */
export function drillUserPlyCount(s: DrillState): number {
  let count = 0;
  for (let ply = 0; ply < sessionTotalPlies(s.session); ply++) {
    if (userOwnsPly(s, ply)) count++;
  }
  return count;
}

/**
 * 1-based index of the user's *current* move ("your 3rd move"), clamped to the total. Zero for
 * a line with no user moves at all. Safe to display: it says nothing about which line this is.
 */
export function drillUserMoveNumber(s: DrillState): number {
  const total = drillUserPlyCount(s);
  if (total === 0) return 0;
  let done = 0;
  for (let ply = 0; ply < s.session.ply; ply++) {
    if (userOwnsPly(s, ply)) done++;
  }
  return Math.min(done + 1, total);
}

/* ------------------------------ transitions ------------------------------ */

export interface DrillAttemptResult {
  state: DrillState;
  /** Straight from `line.ts`: `advanced` | `wrong` | `illegal` | `not-your-turn` | `finished`. */
  outcome: AttemptOutcome;
  /** Normalised SAN of what the user played, when it was legal. Never the expected move. */
  san: string | null;
}

/**
 * The user's move. Matching the line advances the run; a legal alternative is refused with the
 * position untouched and the ply marked failed, so the user retries from the same position.
 */
export function drillAttempt(s: DrillState, move: string | MoveInput): DrillAttemptResult {
  const ply = s.session.ply;
  const result = attemptMove(s.session, move);
  if (result.outcome === 'wrong') {
    return {
      state: { ...s, session: result.session, failedPlies: withPly(s.failedPlies, ply) },
      outcome: result.outcome,
      san: result.san,
    };
  }
  if (result.session === s.session) {
    return { state: s, outcome: result.outcome, san: result.san };
  }
  return { state: { ...s, session: result.session }, outcome: result.outcome, san: result.san };
}

export interface DrillHintResult {
  state: DrillState;
  /** The correct SAN at the current ply, or `null` at the end of the line. */
  san: string | null;
}

/**
 * Reveals the move the line expects and marks the ply failed (README: the hint "also counts as
 * failed"). Idempotent within a ply: pressing hint twice at the same position costs one hint.
 */
export function drillHint(s: DrillState): DrillHintResult {
  const san = sessionExpectedSan(s.session);
  if (san === null) return { state: s, san: null };

  const session = revealNextMove(s.session);
  if (session === s.session) return { state: s, san };

  const ply = s.session.ply;
  return {
    state: {
      session,
      failedPlies: withPly(s.failedPlies, ply),
      hintedPlies: withPly(s.hintedPlies, ply),
    },
    san,
  };
}

/**
 * Plays the opponent's move from the line. A no-op unless it really is the opponent's turn, so
 * a late timer can never move for the user.
 */
export function drillAutoPlay(s: DrillState): DrillState {
  const session = autoPlay(s.session);
  return session === s.session ? s : { ...s, session };
}

/** The SAN currently revealed by a hint, or `null`. The only answer the UI may ever render. */
export function drillRevealedSan(s: DrillState): string | null {
  return s.session.revealed;
}

/** Squares of the revealed move, for hint highlights; `null` when no hint is showing. */
export function drillRevealedSquares(s: DrillState): PlySquares | null {
  if (s.session.revealed === null) return null;
  return sessionExpectedSquares(s.session);
}

/**
 * The refused move, for error feedback. Deliberately drops `RejectedMove.expected` — that
 * field is the answer, and the caller of this function renders into the DOM.
 */
export function drillRejected(s: DrillState): (PlySquares & { san: string }) | null {
  const rejected = s.session.rejected;
  if (rejected === null) return null;
  return { san: rejected.san, from: rejected.from, to: rejected.to };
}

/* -------------------------------- summary -------------------------------- */

/** End-of-line result (README §7 Phase 7: "brief result (moves correct / hints used)"). */
export interface DrillSummary {
  /** User moves scored so far — the total once the line is complete. */
  movesScored: number;
  /** User moves in the whole line. */
  totalMoves: number;
  /** Scored moves played with no wrong attempt and no hint. */
  movesCorrect: number;
  /** Scored moves that were got wrong or hinted. */
  movesFailed: number;
  /** Distinct plies where a hint was taken. */
  hintsUsed: number;
  /** Raw count of refused attempts, which may exceed `movesFailed`. */
  wrongAttempts: number;
  complete: boolean;
  /** Complete, and every user move produced unaided. */
  perfect: boolean;
}

/**
 * Scores the run so far. Only plies the user has actually got past are scored, so calling this
 * mid-line gives a partial (and monotonically growing) result.
 */
export function drillSummary(s: DrillState): DrillSummary {
  const totalMoves = drillUserPlyCount(s);
  let movesScored = 0;
  let movesFailed = 0;
  for (let ply = 0; ply < s.session.ply; ply++) {
    if (!userOwnsPly(s, ply)) continue;
    movesScored++;
    if (s.failedPlies.includes(ply)) movesFailed++;
  }
  const complete = isSessionComplete(s.session);
  return {
    movesScored,
    totalMoves,
    movesCorrect: movesScored - movesFailed,
    movesFailed,
    hintsUsed: s.hintedPlies.length,
    wrongAttempts: s.session.wrongAttempts,
    complete,
    perfect: complete && movesFailed === 0,
  };
}

/** One line of plain text for the end-of-line card. Contains no SAN and no line name. */
export function drillSummaryLabel(summary: DrillSummary): string {
  const moves = `${summary.movesCorrect} of ${summary.totalMoves} ${
    summary.totalMoves === 1 ? 'move' : 'moves'
  } correct`;
  const hints = `${summary.hintsUsed} ${summary.hintsUsed === 1 ? 'hint' : 'hints'}`;
  return `${moves} · ${hints}`;
}
