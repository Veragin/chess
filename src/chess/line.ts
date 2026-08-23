/**
 * Following a **linear** repertoire line: the shared logic behind Phase 6 (interactive line
 * play) and Phase 7 (drill).
 *
 * Deliberately DOM-free and React-free — no `localStorage`, no timers, no components. The
 * screens wire a renderer and a `setTimeout` to the pure transitions below, which is what
 * keeps "unit tests only" (README §1) viable for both phases.
 *
 * Two things this module exists to get right:
 *
 *  1. **Who moves.** A line is a start position plus one ordered SAN sequence "starting from
 *     the side to move in startFen" (README §5), and `userColor` is the side the *user* trains
 *     as. Both are free, so the user may move first (`startFen` side to move === `userColor`)
 *     or second. Every "is it my turn" question goes through `isUserTurnAt`; nothing in the UI
 *     may assume White moves first or that the user is White.
 *  2. **Exactly one correct move per ply** (README §1: linear only, no variation tree). A move
 *     that matches advances; a legal alternative is *rejected* and the position does not
 *     change. Matching compares SAN **as chess.js normalises it**, so `Ng1f3`, `g1f3` and a
 *     stray `+`/`#` suffix can never cause a false negative.
 *
 * A stored line whose moves do not all replay is reported as `{ ok: false }` by `resolveLine`
 * rather than throwing: storage validates on import, but a hand-edited `localStorage` payload
 * must still land in a clean "this line is broken" screen.
 *
 * Indexing convention, used everywhere: **`ply` is 0-based and counts moves already played**,
 * so it is simultaneously "the number of plies behind us" and "the index of the move expected
 * next". `ply === totalPlies(line)` therefore means the line is complete.
 */

import { createGame, type Color, type MoveInput } from './game';
import { plyColor } from './history';
import type { Orientation, Square } from './position';

/**
 * The parts of a stored `Line` this module needs. `storage/schema.ts`'s `Line` is structurally
 * assignable to it, so callers pass their `Line` straight in; tests can use a literal.
 */
export interface LineSpec {
  startFen: string;
  /** SAN moves in order, starting from the side to move in `startFen`. */
  moves: string[];
  /** Side the user trains as. */
  userColor: Color;
}

/** From/to squares of one ply, for the Board's `lastMove`/`highlights` props. */
export interface PlySquares {
  from: Square;
  to: Square;
}

/** A line whose start position is legal and whose every move replays. */
export interface ResolvedLine {
  ok: true;
  /** `startFen` normalised through chess.js, so it compares equal to replayed FENs. */
  startFen: string;
  /** Side to move in `startFen` — NOT necessarily White. */
  startColor: Color;
  /** The line's trained-as colour, as stored. */
  userColor: Color;
  /** One entry per ply, SAN as chess.js normalises it. */
  sans: string[];
  /** `fens[i]` is the position **before** ply `i`; length is `sans.length + 1`. */
  fens: string[];
  /** `squares[i]` is the from/to of ply `i`; parallel to `sans`. */
  squares: PlySquares[];
}

/** A stored line we refuse to run, with enough detail to tell the user where it breaks. */
export interface BrokenLine {
  ok: false;
  reason: string;
  /** 0-based ply of the first unplayable move; `null` when `startFen` itself is illegal. */
  failedAtPly: number | null;
}

export type LineModel = ResolvedLine | BrokenLine;

/* ------------------------------------------------------------------------------------- *
 * Replay
 * ------------------------------------------------------------------------------------- */

interface ReplayedLine {
  /** Normalised start FEN, or `null` when it is not a position chess.js accepts. */
  startFen: string | null;
  sans: string[];
  fens: string[];
  squares: PlySquares[];
  failedAtPly: number | null;
  reason: string | null;
}

function movesOf(spec: LineSpec): string[] {
  return Array.isArray(spec.moves) ? spec.moves : [];
}

function colorOf(value: unknown): Color {
  return value === 'b' ? 'b' : 'w';
}

/** Side to move in a FEN, read off field 2. Defaults to White for a malformed string. */
function fenSideToMove(fen: string): Color {
  return colorOf(typeof fen === 'string' ? fen.trim().split(/\s+/)[1] : undefined);
}

/**
 * Single replay pass: normalises the start FEN and walks the SAN list, collecting the position
 * before each ply and the squares each ply moves between. Stops at the first illegal move and
 * reports where, keeping everything that did replay.
 */
function replayLine(spec: LineSpec): ReplayedLine {
  const raw = typeof spec.startFen === 'string' ? spec.startFen.trim() : '';
  let game;
  try {
    game = createGame(raw);
  } catch (err) {
    return {
      startFen: null,
      sans: [],
      fens: [],
      squares: [],
      failedAtPly: null,
      reason: `Start position is not a legal FEN: ${err instanceof Error ? err.message : 'invalid'}`,
    };
  }

  const startFen = game.fen();
  const sans: string[] = [];
  const fens: string[] = [startFen];
  const squares: PlySquares[] = [];
  const moves = movesOf(spec);

  for (let i = 0; i < moves.length; i++) {
    const san = moves[i];
    const applied = typeof san === 'string' ? game.move(san) : null;
    if (applied === null) {
      return {
        startFen,
        sans,
        fens,
        squares,
        failedAtPly: i,
        reason: `Move ${i + 1} ("${typeof san === 'string' ? san : String(san)}") cannot be played from this position.`,
      };
    }
    sans.push(applied.san);
    squares.push({ from: applied.from, to: applied.to });
    fens.push(game.fen());
  }

  return { startFen, sans, fens, squares, failedAtPly: null, reason: null };
}

/**
 * Resolves a stored line once, up front. Callers that render should do this a single time and
 * hand the `ResolvedLine` around (the spec-level helpers below each replay, which is fine for
 * a one-off question but wasteful per render).
 */
export function resolveLine(spec: LineSpec): LineModel {
  const replayed = replayLine(spec);
  if (replayed.startFen === null || replayed.failedAtPly !== null) {
    return {
      ok: false,
      reason: replayed.reason ?? 'This line cannot be replayed.',
      failedAtPly: replayed.failedAtPly,
    };
  }
  return {
    ok: true,
    startFen: replayed.startFen,
    startColor: fenSideToMove(replayed.startFen),
    userColor: colorOf(spec.userColor),
    sans: replayed.sans,
    fens: replayed.fens,
    squares: replayed.squares,
  };
}

/* ------------------------------------------------------------------------------------- *
 * Line-level queries (a `LineSpec`, plus a ply)
 * ------------------------------------------------------------------------------------- */

function isPly(ply: number): boolean {
  return Number.isInteger(ply) && ply >= 0;
}

/** Number of plies (half-moves) in the line — the "11" in "move 4 of 11". */
export function totalPlies(line: LineSpec): number {
  return movesOf(line).length;
}

/** Side to move in the line's start position. */
export function startColorOf(line: LineSpec): Color {
  const normalised = replayLine(line).startFen;
  return fenSideToMove(normalised ?? (typeof line.startFen === 'string' ? line.startFen : ''));
}

/** Side that plays ply `ply`, whether or not that ply exists. */
export function colorAtPly(line: LineSpec, ply: number): Color {
  return plyColor(startColorOf(line), isPly(ply) ? ply : 0);
}

/**
 * Whether the *user* plays ply `ply`. Pure arithmetic over the start side to move and
 * `userColor`: it does not consider whether the line has ended, so check `isComplete` first
 * when that matters.
 */
export function isUserTurnAt(line: LineSpec, ply: number): boolean {
  return colorAtPly(line, ply) === colorOf(line.userColor);
}

/**
 * The line's move at `ply`, normalised by chess.js, or `null` past the end (and for any ply at
 * or beyond the break in a broken line).
 */
export function expectedSanAt(line: LineSpec, ply: number): string | null {
  if (!isPly(ply)) return null;
  return replayLine(line).sans[ply] ?? null;
}

/**
 * The position **before** the move at `ply`. `fenAtPly(line, 0)` is the (normalised) start
 * position and `fenAtPly(line, totalPlies(line))` is the final position; `null` past that.
 */
export function fenAtPly(line: LineSpec, ply: number): string | null {
  if (!isPly(ply)) return null;
  return replayLine(line).fens[ply] ?? null;
}

/** Squares the move at `ply` travels between, or `null` when there is no such ply. */
export function squaresAtPly(line: LineSpec, ply: number): PlySquares | null {
  if (!isPly(ply)) return null;
  return replayLine(line).squares[ply] ?? null;
}

/** True once every ply has been played. An empty line is complete at ply 0. */
export function isComplete(line: LineSpec, ply: number): boolean {
  return isPly(ply) ? ply >= totalPlies(line) : false;
}

/**
 * SAN of `move` as chess.js writes it, when played from `fen`; `null` if it is not legal there.
 * Accepts SAN in any accepted spelling (`Nf3`, `Ng1f3`, `g1f3`, a stray check suffix) as well
 * as the Board's `{ from, to, promotion }`.
 */
export function normaliseSan(fen: string, move: string | MoveInput): string | null {
  return probeMove(fen, move)?.san ?? null;
}

/** Plays `move` on a throwaway game and reports its SAN and squares, or `null` if illegal. */
function probeMove(fen: string, move: string | MoveInput): (PlySquares & { san: string }) | null {
  try {
    const applied = createGame(fen).move(move);
    return applied === null ? null : { san: applied.san, from: applied.from, to: applied.to };
  } catch {
    return null;
  }
}

/**
 * **The line-matching predicate.** True only for the one move the line expects at `ply`.
 *
 * Both sides of the comparison are normalised through chess.js, so a caller may pass whatever
 * spelling it has (`'Nf3'`, `'Ng1f3'`, `'Nf3+'`, `{ from: 'g1', to: 'f3' }`) and a legal
 * alternative is still rejected.
 */
export function matchesLine(line: LineSpec, ply: number, move: string | MoveInput): boolean {
  const expected = expectedSanAt(line, ply);
  if (expected === null) return false;
  const fen = fenAtPly(line, ply);
  if (fen === null) return false;
  return normaliseSan(fen, move) === expected;
}

/** Board orientation for a colour. Presentation only (README §8.12). */
export function orientationFor(color: Color): Orientation {
  return color === 'b' ? 'black' : 'white';
}

/* ------------------------------------------------------------------------------------- *
 * Progress
 * ------------------------------------------------------------------------------------- */

export interface LineProgress {
  /** 1-based number of the move expected next, clamped to `total`; 0 for an empty line. */
  current: number;
  total: number;
  /** Plies already played. */
  played: number;
  complete: boolean;
  /** README §7 Phase 6's display: `Move 4 of 11`. */
  label: string;
}

function progressOf(total: number, ply: number): LineProgress {
  const played = Math.min(Math.max(Number.isFinite(ply) ? Math.trunc(ply) : 0, 0), total);
  const complete = played >= total;
  const current = total === 0 ? 0 : complete ? total : played + 1;
  const label =
    total === 0
      ? 'No moves in this line'
      : complete
        ? `Line complete — ${total} ${total === 1 ? 'move' : 'moves'}`
        : `Move ${current} of ${total}`;
  return { current, total, played, complete, label };
}

/** Progress display for a line stopped at `ply`. */
export function lineProgress(line: LineSpec, ply: number): LineProgress {
  return progressOf(totalPlies(line), ply);
}

/* ------------------------------------------------------------------------------------- *
 * Session state — plain data plus pure transitions
 * ------------------------------------------------------------------------------------- */

/** A legal move the user played that was not the line's move. */
export interface RejectedMove {
  san: string;
  from: Square;
  to: Square;
  /** The move the line wanted instead. Never shown unless the user asks to reveal. */
  expected: string;
}

/**
 * One run through a line. Immutable: every transition returns a fresh object (or the same one
 * for a no-op), so a component can keep it in `useState` and compare by identity.
 *
 * `userColor` lives here rather than being read off `line` because **switch sides is a view of
 * the same stored line** — it flips this field and must never write to storage.
 */
export interface LineSession {
  line: ResolvedLine;
  /** Colour being played in this run. Starts as `line.userColor`; `switchSides` flips it. */
  userColor: Color;
  /** Plies played so far, i.e. the index of the move expected next. */
  ply: number;
  /** SAN surfaced by `revealNextMove`; cleared whenever the position changes. */
  revealed: string | null;
  /** The most recent refused attempt, for error feedback; cleared on any position change. */
  rejected: RejectedMove | null;
  /** Wrong attempts in this run (Phase 7 scores off this). */
  wrongAttempts: number;
  /** Reveals used in this run (Phase 7's "hints used"). */
  hintsUsed: number;
}

/** How `attemptMove` ended. */
export type AttemptOutcome =
  /** Matched the line; `session.ply` advanced. */
  | 'advanced'
  /** A legal move, but not the line's move. The position did not change. */
  | 'wrong'
  /** Not a legal move in this position at all (the Board normally filters these out). */
  | 'illegal'
  /** It is the opponent's turn — the app auto-plays that ply, the user does not. */
  | 'not-your-turn'
  /** The line has already ended. */
  | 'finished';

export interface AttemptResult {
  outcome: AttemptOutcome;
  /** Always a usable session: unchanged for no-ops, advanced or flagged otherwise. */
  session: LineSession;
  /** Normalised SAN of the attempt, when it was legal. */
  san: string | null;
  /** What the line expected at the attempted ply, when there was a ply to play. */
  expected: string | null;
}

/**
 * Starts a run at the beginning of the line. `userColor` defaults to the line's stored colour;
 * pass it explicitly to open the line from the other side without touching storage.
 */
export function createSession(line: ResolvedLine, userColor?: Color): LineSession {
  return {
    line,
    userColor: colorOf(userColor ?? line.userColor),
    ply: 0,
    revealed: null,
    rejected: null,
    wrongAttempts: 0,
    hintsUsed: 0,
  };
}

/** Number of plies in the session's line. */
export function sessionTotalPlies(s: LineSession): number {
  return s.line.sans.length;
}

/** Position on the board right now. */
export function sessionFen(s: LineSession): string {
  return s.line.fens[s.ply] ?? s.line.startFen;
}

/** From/to of the move just played, for the Board's `lastMove` prop; `null` at the start. */
export function sessionLastMove(s: LineSession): PlySquares | null {
  return s.ply > 0 ? (s.line.squares[s.ply - 1] ?? null) : null;
}

/** The line's move at the current ply, or `null` at the end of the line. */
export function sessionExpectedSan(s: LineSession): string | null {
  return s.line.sans[s.ply] ?? null;
}

/** Squares of the move at the current ply, or `null` at the end of the line. */
export function sessionExpectedSquares(s: LineSession): PlySquares | null {
  return s.line.squares[s.ply] ?? null;
}

export function isSessionComplete(s: LineSession): boolean {
  return s.ply >= sessionTotalPlies(s);
}

/** Side to move in the current position. */
export function sessionSideToMove(s: LineSession): Color {
  return plyColor(s.line.startColor, s.ply);
}

/** True when the user owns the move at the current ply (and the line has not ended). */
export function isSessionUserTurn(s: LineSession): boolean {
  return !isSessionComplete(s) && sessionSideToMove(s) === s.userColor;
}

/**
 * The SAN the app should auto-play right now, or `null` when there is nothing to auto-play
 * (the user's turn, or the line has ended). The drill screen runs its delay timer off exactly
 * this value.
 */
export function pendingAutoMove(s: LineSession): string | null {
  if (isSessionComplete(s) || isSessionUserTurn(s)) return null;
  return sessionExpectedSan(s);
}

/** Board orientation for the colour currently being trained. */
export function sessionOrientation(s: LineSession): Orientation {
  return orientationFor(s.userColor);
}

/** SAN of the plies played so far, oldest first. */
export function sessionPlayedSans(s: LineSession): string[] {
  return s.line.sans.slice(0, s.ply);
}

export function sessionProgress(s: LineSession): LineProgress {
  return progressOf(sessionTotalPlies(s), s.ply);
}

/** Moves to `ply`, clearing everything that belongs to the position we are leaving. */
function at(s: LineSession, ply: number): LineSession {
  const clamped = Math.min(Math.max(ply, 0), sessionTotalPlies(s));
  return { ...s, ply: clamped, revealed: null, rejected: null };
}

/**
 * Jumps to an arbitrary ply, clamped to the line. Clears the revealed move and any error, and
 * leaves the run counters alone. Auto-play settles the position afterwards if the ply landed on
 * belongs to the opponent.
 */
export function jumpToPly(s: LineSession, ply: number): LineSession {
  return at(s, Number.isFinite(ply) ? Math.trunc(ply) : 0);
}

/** Back to the start of the line, same side, counters reset — a fresh run. */
export function restartSession(s: LineSession): LineSession {
  return { ...s, ply: 0, revealed: null, rejected: null, wrongAttempts: 0, hintsUsed: 0 };
}

/**
 * Replays the **same stored line** from the other colour's point of view.
 *
 * README §7 Phase 6 requires this to reset to the start of the line rather than leaving a
 * half-played state: mid-line, the side to move would frequently be the colour we just
 * switched *away* from, so keeping `ply` would strand the run in a position neither the user
 * nor the auto-player owns. It also never touches storage — `userColor` here is session state.
 */
export function switchSides(s: LineSession): LineSession {
  return {
    ...s,
    userColor: s.userColor === 'w' ? 'b' : 'w',
    ply: 0,
    revealed: null,
    rejected: null,
    wrongAttempts: 0,
    hintsUsed: 0,
  };
}

/** Steps back one ply. No-op at the start of the line. */
export function stepBackSession(s: LineSession): LineSession {
  return s.ply === 0 ? at(s, 0) : at(s, s.ply - 1);
}

/** Whether the side being trained owns ply `ply`. */
function userOwnsPly(s: LineSession, ply: number): boolean {
  return plyColor(s.line.startColor, ply) === s.userColor;
}

/** Where a run left at `ply` settles once every pending auto-play has run. */
function settledPly(s: LineSession, ply: number): number {
  const total = sessionTotalPlies(s);
  let p = Math.min(Math.max(ply, 0), total);
  while (p < total && !userOwnsPly(s, p)) p += 1;
  return p;
}

/**
 * The ply "step back one move" lands on: the most recent earlier ply the **user** owns.
 *
 * Stepping back a single ply is not enough, because landing on an opponent ply would simply be
 * auto-played again — the step back would undo itself. Going back to the user's own previous
 * move takes the auto-played reply with it, which is what "let me try that again" means.
 */
export function stepBackTargetPly(s: LineSession): number {
  let p = Math.min(s.ply, sessionTotalPlies(s)) - 1;
  if (p <= 0) return 0;
  while (p > 0 && !userOwnsPly(s, p)) p -= 1;
  return p;
}

/** False when stepping back would settle on the position we are already in. */
export function canStepBack(s: LineSession): boolean {
  return settledPly(s, stepBackTargetPly(s)) < settledPly(s, s.ply);
}

/** "Step back one move": back to the user's previous move (README §7 Phase 6). */
export function stepBackToUserTurn(s: LineSession): LineSession {
  return canStepBack(s) ? at(s, stepBackTargetPly(s)) : s;
}

/** Steps forward one ply along the line, whoever owns it. No-op at the end. */
export function stepForwardSession(s: LineSession): LineSession {
  return isSessionComplete(s) ? s : at(s, s.ply + 1);
}

/**
 * Plays the opponent's move from the line. No-op when it is the user's turn or the line has
 * ended, so a late timer can never move for the user.
 */
export function autoPlay(s: LineSession): LineSession {
  if (pendingAutoMove(s) === null) return s;
  return at(s, s.ply + 1);
}

/** Reveals the move expected next, and counts it as a hint. No-op at the end of the line. */
export function revealNextMove(s: LineSession): LineSession {
  const san = sessionExpectedSan(s);
  if (san === null) return s;
  if (s.revealed === san) return s;
  return { ...s, revealed: san, rejected: null, hintsUsed: s.hintsUsed + 1 };
}

/**
 * The user's move. Matching the line advances (and clears any error); a legal alternative is
 * refused with the position untouched (README §7 Phase 6 — "guided practice, not free
 * analysis").
 */
export function attemptMove(s: LineSession, move: string | MoveInput): AttemptResult {
  const expected = sessionExpectedSan(s);
  if (expected === null) {
    return { outcome: 'finished', session: s, san: null, expected: null };
  }
  if (!isSessionUserTurn(s)) {
    return { outcome: 'not-your-turn', session: s, san: null, expected };
  }

  const probe = probeMove(sessionFen(s), move);
  if (probe === null) {
    return { outcome: 'illegal', session: s, san: null, expected };
  }
  if (probe.san === expected) {
    return { outcome: 'advanced', session: at(s, s.ply + 1), san: probe.san, expected };
  }

  const rejected: RejectedMove = {
    san: probe.san,
    from: probe.from,
    to: probe.to,
    expected,
  };
  return {
    outcome: 'wrong',
    session: { ...s, revealed: null, rejected, wrongAttempts: s.wrongAttempts + 1 },
    san: probe.san,
    expected,
  };
}

/** Clears the wrong-move feedback without changing the position (e.g. when a flash expires). */
export function clearRejection(s: LineSession): LineSession {
  return s.rejected === null ? s : { ...s, rejected: null };
}
