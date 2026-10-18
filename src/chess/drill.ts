/**
 * Drill (README §7 Phase 7): repertoire recall, one line at a time, with nothing on screen but
 * the board.
 *
 * Two independent pieces of pure logic live here, both DOM-free and React-free so they can be
 * unit tested (README §1 "Testing"):
 *
 *  1. **The cycle** — which line to serve next: uniformly at random from the pool, excluding
 *     every line already served in this drill. That is a bag drawn *without replacement*, not
 *     independent random draws, and explicitly **not** spaced repetition (README §1 non-goals).
 *     The bag is never refilled mid-drill: each line comes up exactly once, and when the bag is
 *     empty the drill is over. Randomness is injected (`RandomInt`) so tests are deterministic.
 *     Since lines are move trees the unit is a **branch** (`DrillItem`, `pickNextBranch`): a
 *     random line, then its unserved branches one after another, then the next random line.
 *  2. **The state machine** — `awaiting-user → auto-reply → complete`, built on the shared
 *     `LineSession` in `./line.ts`. Line following (who moves, what matches, auto-play) is
 *     *not* reimplemented here; this module only adds what drill needs on top: per-ply
 *     bookkeeping of whether the user actually knew the move, which is what the end-of-line
 *     summary reports — and, given the line's tree, accepting the user's *other* repertoire
 *     moves by switching branch (implementation plan D6).
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
  branchSpec,
  createSession,
  normaliseSan,
  resolveLine,
  isSessionComplete,
  isSessionUserTurn,
  pendingAutoMove,
  revealNextMove,
  sessionExpectedComment,
  sessionExpectedThreats,
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
import type { ThreatMark } from './threats';
import { branchesOf, childrenAt, type MoveTree } from './tree';

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

/** Outcome of one draw. `id` is `null` exactly when there was nothing left to serve. */
export interface DrillPick {
  id: string | null;
  /** Cycle to carry into the next draw. Pruned to the ids that still exist. */
  cycle: DrillCycle;
  /**
   * True when the draw came up empty: the pool holds no lines, or every line in it has already
   * been served. The caller decides what that means — drill ends the run and offers a restart.
   */
  exhausted: boolean;
}

/**
 * Draws the next line id: uniformly at random from the ids not yet served this cycle.
 *
 * One pass, and one pass only. A line is served **at most once per cycle**, and once every line
 * has been served the draw returns `id: null` with `exhausted: true` rather than starting a new
 * pass — a drill is over when the pool has run out. Starting again is `emptyCycle()`, which the
 * caller does explicitly (a fresh run), never as a side effect of a draw.
 */
export function pickNextLineId(
  ids: readonly string[],
  cycle: DrillCycle,
  rand: RandomInt = defaultRandomInt,
): DrillPick {
  const pool = normaliseIds(ids);
  if (pool.length === 0) return { id: null, cycle: emptyCycle(), exhausted: true };

  // Drop served ids that no longer exist, so a deleted line cannot hold the cycle open.
  const inPool = new Set(pool);
  const served = cycle.served.filter((id) => inPool.has(id));
  const servedSet = new Set(served);
  const candidates = pool.filter((id) => !servedSet.has(id));

  if (candidates.length === 0) return { id: null, cycle: { served }, exhausted: true };

  const raw = rand(candidates.length);
  const index = Number.isInteger(raw) ? Math.min(Math.max(raw, 0), candidates.length - 1) : 0;
  const id = candidates[index];
  // Unreachable: `index` is clamped into a non-empty `candidates`. Belt and braces rather than a `!`.
  if (id === undefined) return { id: null, cycle: { served }, exhausted: true };

  return { id, cycle: { served: [...served, id] }, exhausted: false };
}

/**
 * `pickNextLineId` over objects that carry an id, for callers holding records rather than bare
 * ids. Generic so this module needs no dependency on `storage/schema`.
 */
export function pickNextLine<T extends { id: string }>(
  items: readonly T[],
  cycle: DrillCycle,
  rand: RandomInt = defaultRandomInt,
): { item: T | null; cycle: DrillCycle; exhausted: boolean } {
  const pick = pickNextLineId(
    items.map((item) => item.id),
    cycle,
    rand,
  );
  const item = pick.id === null ? null : (items.find((c) => c.id === pick.id) ?? null);
  return { item, cycle: pick.cycle, exhausted: pick.exhausted };
}

/* ------------------------------ branch cycle ------------------------------ */

/**
 * The drill unit since lines became trees (implementation plan D5): one **branch** of one line.
 * `branch` indexes `branchesOf(line.tree)` (0 = main line). A cycle over branches stores
 * `drillItemKey`s in `DrillCycle.served`, so the cycle itself stays plain strings.
 */
export interface DrillItem {
  lineId: string;
  branch: number;
}

/** One line of a branch pool: its id and how many branches it has (`countBranches`, ≥ 1). */
export interface DrillPoolEntry {
  id: string;
  branches: number;
}

/** `lineId#branch` — the key a served branch is recorded under. */
export function drillItemKey(item: DrillItem): string {
  return `${item.lineId}#${item.branch}`;
}

/** Inverse of `drillItemKey`; `null` for anything that is not one. */
export function parseDrillItemKey(key: string): DrillItem | null {
  const hash = key.lastIndexOf('#');
  if (hash <= 0) return null;
  const branch = Number(key.slice(hash + 1));
  if (!Number.isInteger(branch) || branch < 0 || key.slice(hash + 1) !== String(branch))
    return null;
  return { lineId: key.slice(0, hash), branch };
}

/** Unique, non-empty ids with a sane branch count (anything odd counts as one branch). */
function normalisePool(pool: readonly DrillPoolEntry[]): DrillPoolEntry[] {
  const seen = new Set<string>();
  const out: DrillPoolEntry[] = [];
  for (const entry of pool) {
    const id: unknown = entry?.id;
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    const raw = entry.branches;
    const branches = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
    out.push({ id, branches });
  }
  return out;
}

/** Served keys that still name a branch of the pool, in order, without duplicates. */
function prunedServed(pool: readonly DrillPoolEntry[], cycle: DrillCycle): string[] {
  const sizes = new Map(pool.map((entry) => [entry.id, entry.branches]));
  const seen = new Set<string>();
  return cycle.served.filter((key) => {
    const item = parseDrillItemKey(key);
    if (item === null || seen.has(key)) return false;
    const branches = sizes.get(item.lineId);
    if (branches === undefined || item.branch >= branches) return false;
    seen.add(key);
    return true;
  });
}

function unservedOf(entry: DrillPoolEntry, served: ReadonlySet<string>): number[] {
  const out: number[] = [];
  for (let branch = 0; branch < entry.branches; branch++) {
    if (!served.has(drillItemKey({ lineId: entry.id, branch }))) out.push(branch);
  }
  return out;
}

/** `rand(n)` clamped into `[0, n)`, so a misbehaving source can never index out of range. */
function choose<T>(items: readonly T[], rand: RandomInt): T | undefined {
  if (items.length === 0) return undefined;
  const raw = rand(items.length);
  const index = Number.isInteger(raw) ? Math.min(Math.max(raw, 0), items.length - 1) : 0;
  return items[index];
}

/** Every branch of the pool not yet served in `cycle`, line by line, branches in order. */
export function remainingBranches(pool: readonly DrillPoolEntry[], cycle: DrillCycle): DrillItem[] {
  const entries = normalisePool(pool);
  const served = new Set(prunedServed(entries, cycle));
  return entries.flatMap((entry) =>
    unservedOf(entry, served).map((branch) => ({ lineId: entry.id, branch })),
  );
}

/** Branch indices of `lineId` already served in `cycle`, ascending. */
export function servedBranchesOf(cycle: DrillCycle, lineId: string): number[] {
  const out = new Set<number>();
  for (const key of cycle.served) {
    const item = parseDrillItemKey(key);
    if (item !== null && item.lineId === lineId) out.add(item.branch);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Records `item` as served (no-op when it already is). Used when a run switches branch mid-line
 * (D6): the branch actually played is spent too.
 */
export function markServed(cycle: DrillCycle, item: DrillItem): DrillCycle {
  const key = drillItemKey(item);
  return cycle.served.includes(key) ? cycle : { served: [...cycle.served, key] };
}

/** Outcome of one branch draw. `item` is `null` exactly when nothing was left to serve. */
export interface DrillBranchPick {
  item: DrillItem | null;
  /** Cycle to carry into the next draw, pruned to branches that still exist. */
  cycle: DrillCycle;
  exhausted: boolean;
}

/**
 * Draws the next branch (implementation plan D5):
 *
 *  1. if `current` (the line just drilled) still has unserved branches → a random one of them;
 *  2. else a random line among those with unserved branches → a random unserved branch of it;
 *  3. else `exhausted`.
 *
 * Same guarantees as `pickNextLineId`: a branch is served at most once per cycle, served keys of
 * vanished lines (or of branches an edit removed) are pruned and cannot hold the drill open, and
 * the cycle is never refilled by a draw.
 */
export function pickNextBranch(
  pool: readonly DrillPoolEntry[],
  cycle: DrillCycle,
  current?: string | null,
  rand: RandomInt = defaultRandomInt,
): DrillBranchPick {
  const entries = normalisePool(pool);
  if (entries.length === 0) return { item: null, cycle: emptyCycle(), exhausted: true };

  const served = prunedServed(entries, cycle);
  const servedSet = new Set(served);

  const currentEntry =
    current === undefined || current === null
      ? undefined
      : entries.find((entry) => entry.id === current);
  const sameLine = currentEntry === undefined ? [] : unservedOf(currentEntry, servedSet);

  let item: DrillItem | null = null;
  if (currentEntry !== undefined && sameLine.length > 0) {
    const branch = choose(sameLine, rand);
    if (branch !== undefined) item = { lineId: currentEntry.id, branch };
  } else {
    const open = entries.filter((entry) => unservedOf(entry, servedSet).length > 0);
    const entry = choose(open, rand);
    const branch = entry === undefined ? undefined : choose(unservedOf(entry, servedSet), rand);
    if (entry !== undefined && branch !== undefined) item = { lineId: entry.id, branch };
  }

  if (item === null) return { item: null, cycle: { served }, exhausted: true };
  return {
    item,
    cycle: { served: [...served, drillItemKey(item)] },
    exhausted: false,
  };
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
  /**
   * The whole move tree of the stored line, when the run knows it — needed to accept another
   * repertoire move of the user's (D6). `null` for a bare linear line: no switching then.
   */
  readonly tree: MoveTree | null;
  /** Index (into `branchesOf(tree)`) of the branch being played; 0 without a tree. */
  readonly branch: number;
  /** `branchesOf(tree).length`; 1 without a tree. */
  readonly branchCount: number;
  /**
   * Branches of this line already served in the drill cycle, current one included. A D6 switch
   * prefers a branch outside this list, and adds the one it switches to.
   */
  readonly servedBranches: readonly number[];
}

/** Where `createDrill`'s line sits inside its stored tree. All optional. */
export interface DrillTreeContext {
  /** The stored line's tree; `line` must be branch `branch` of it. */
  tree?: MoveTree;
  branch?: number;
  /** Branches of this line already served this cycle (the current one is added regardless). */
  served?: readonly number[];
}

/**
 * Starts a run at the beginning of `line`, played as the line's stored `userColor`. Pass the
 * stored tree (and which branch `line` is) to let the run accept the user's other repertoire
 * moves (implementation plan D6).
 */
export function createDrill(line: ResolvedLine, context: DrillTreeContext = {}): DrillState {
  const tree = context.tree ?? null;
  const branchCount = tree === null ? 1 : branchesOf(tree).length;
  const raw = context.branch ?? 0;
  const branch = Number.isInteger(raw) && raw >= 0 && raw < branchCount ? raw : 0;
  const served = new Set(
    (context.served ?? []).filter((b) => Number.isInteger(b) && b >= 0 && b < branchCount),
  );
  served.add(branch);
  return {
    session: createSession(line),
    failedPlies: [],
    hintedPlies: [],
    tree,
    branch,
    branchCount,
    servedBranches: [...served].sort((a, b) => a - b),
  };
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

/**
 * `line.ts`'s outcomes plus `branched`: the move was not this branch's, but it is another
 * repertoire move at this node, so the run moved onto a branch through it (D6). The UI treats
 * it like `advanced`.
 */
export type DrillAttemptOutcome = AttemptOutcome | 'branched';

export interface DrillAttemptResult {
  state: DrillState;
  /** `advanced` | `branched` | `wrong` | `illegal` | `not-your-turn` | `finished`. */
  outcome: DrillAttemptOutcome;
  /** Normalised SAN of what the user played, when it was legal. Never the expected move. */
  san: string | null;
}

/**
 * D6: the branch to switch to when the user plays `san` at the current ply instead of this
 * branch's move — a branch through the sibling node with that SAN, preferring one not yet
 * served (first in tree order, so the transition stays deterministic and pure). `null` when
 * `san` is not a repertoire move here, or the run has no tree.
 */
function alternativeBranch(s: DrillState, san: string): number | null {
  if (s.tree === null) return null;
  const branches = branchesOf(s.tree);
  const path = branches[s.branch];
  const ply = s.session.ply;
  if (path === undefined || path.length <= ply) return null;
  const prefix = path.slice(0, ply);
  const fen = sessionFen(s.session);
  const child = childrenAt(s.tree, prefix).findIndex(
    (node, i) => i !== path[ply] && normaliseSan(fen, node.san) === san,
  );
  if (child < 0) return null;

  const through: number[] = [];
  branches.forEach((branch, index) => {
    if (
      branch.length > ply &&
      branch[ply] === child &&
      prefix.every((step, i) => branch[i] === step)
    ) {
      through.push(index);
    }
  });
  return through.find((index) => !s.servedBranches.includes(index)) ?? through[0] ?? null;
}

/**
 * Re-roots the run onto branch `branch` after the user played its move at the current ply:
 * same position history (the branches share every earlier move), one ply further, counters and
 * failed plies kept.
 */
function switchBranch(s: DrillState, branch: number): DrillState | null {
  if (s.tree === null) return null;
  const spec = branchSpec(
    {
      startFen: s.session.line.startFen,
      tree: s.tree,
      userColor: s.session.line.userColor,
    },
    branch,
  );
  const model = spec === null ? null : resolveLine(spec);
  if (model === null || !model.ok || model.sans.length <= s.session.ply) return null;
  const session: LineSession = {
    ...s.session,
    line: model,
    ply: s.session.ply + 1,
    revealed: null,
    rejected: null,
  };
  return {
    ...s,
    session,
    branch,
    servedBranches: s.servedBranches.includes(branch)
      ? s.servedBranches
      : [...s.servedBranches, branch].sort((a, b) => a - b),
  };
}

/**
 * The user's move. Matching the line advances the run. Another repertoire move at this node
 * (a sibling in the tree) is accepted too: the run switches to a branch through it and reports
 * `branched` (D6). Any other legal move is refused with the position untouched and the ply
 * marked failed, so the user retries from the same position.
 */
export function drillAttempt(s: DrillState, move: string | MoveInput): DrillAttemptResult {
  const ply = s.session.ply;
  const result = attemptMove(s.session, move);
  if (result.outcome === 'wrong' && result.san !== null) {
    const branch = alternativeBranch(s, result.san);
    const switched = branch === null ? null : switchBranch(s, branch);
    if (switched !== null) return { state: switched, outcome: 'branched', san: result.san };
  }
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
  /** The line's comment on that move, or `null` when it has none. */
  comment: string | null;
}

/**
 * Reveals the move the line expects and marks the ply failed (README: the hint "also counts as
 * failed"). Idempotent within a ply: pressing hint twice at the same position costs one hint.
 */
export function drillHint(s: DrillState): DrillHintResult {
  const san = sessionExpectedSan(s.session);
  if (san === null) return { state: s, san: null, comment: null };
  const comment = sessionExpectedComment(s.session);

  const session = revealNextMove(s.session);
  if (session === s.session) return { state: s, san, comment };

  const ply = s.session.ply;
  return {
    state: {
      ...s,
      session,
      failedPlies: withPly(s.failedPlies, ply),
      hintedPlies: withPly(s.hintedPlies, ply),
    },
    san,
    comment,
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

/**
 * The line's comment on the revealed move, or `null` (no hint showing, or no comment). Rendered
 * with the hint only — it describes the answer.
 */
export function drillRevealedComment(s: DrillState): string | null {
  if (s.session.revealed === null) return null;
  return sessionExpectedComment(s.session);
}

/**
 * Threats of the position after the revealed move (see `threats.ts`); empty when no hint is
 * showing. Like the comment, they describe the answer, so they wait for the hint.
 */
export function drillRevealedThreats(s: DrillState): ThreatMark[] {
  if (s.session.revealed === null) return [];
  return sessionExpectedThreats(s.session);
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
  /** 0-based index of the branch played (after any D6 switch); 0 for a linear line. */
  branch: number;
  /** Branches in the line; 1 for a linear line. */
  branchCount: number;
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
    branch: s.branch,
    branchCount: s.branchCount,
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

/** `Branch 2 of 5`, or `null` for a line with a single branch (nothing worth saying). */
export function drillBranchLabel(summary: DrillSummary): string | null {
  if (summary.branchCount <= 1) return null;
  return `Branch ${summary.branch + 1} of ${summary.branchCount}`;
}
