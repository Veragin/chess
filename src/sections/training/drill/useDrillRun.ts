/**
 * React wiring for one drill run. Every decision lives in the pure `chess/drill.ts` /
 * `chess/line.ts`; this hook owns only what needs React — the state cell and the auto-play
 * timer — plus one thing specific to Phase 7: **keeping the answers out of the component tree.**
 *
 * ## Why the state is not in `useState`
 *
 * README §8.11 asks for nothing "in the DOM or React devtools tree that a curious user would
 * read". A `DrillState` contains the whole `ResolvedLine` — every remaining move — so holding
 * it in `useState` would put the answer in the devtools Hooks panel of whichever component
 * calls this hook, which is exactly the casual leak the rule is about.
 *
 * So React holds an **opaque handle** (a bare `{}`) and the `DrillState` lives in a
 * module-level `WeakMap` keyed by that handle. Devtools shows `{}`; the run itself is not
 * reachable from the tree. A `WeakMap` (rather than an id-keyed `Map`) means there is nothing
 * to clean up on unmount and nothing to get wrong under StrictMode's double-invoked
 * initialisers — a discarded handle is simply collected with its state.
 *
 * What the component gets instead is a `DrillView`: position, phase, feedback and progress,
 * derived per render. The only upcoming move it can ever contain is `hint`, and that is
 * populated strictly after the user asks for it. In particular the view drops
 * `RejectedMove.expected` (see `drillRejected`) — the wrong-move notice must not print the
 * right answer.
 *
 * This is not secrecy against a determined user: `localStorage` holds the whole repertoire in
 * clear, so anyone willing to open the Application tab (or set a breakpoint) has everything.
 * The goal is that nothing is *casually* readable.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createDrill,
  drillAttempt,
  drillAutoPlay,
  drillFen,
  drillHint,
  drillLastMove,
  drillOrientation,
  drillPhase,
  drillPly,
  drillRejected,
  drillRevealedSan,
  drillRevealedSquares,
  drillSummary,
  drillUserColor,
  drillUserMoveNumber,
  type DrillPhase,
  type DrillState,
  type DrillSummary,
} from '../../../chess/drill';
import type { Color, MoveInput } from '../../../chess/game';
import type { PlySquares } from '../../../chess/line';
import type { Orientation, Square } from '../../../chess/position';
import { loadDrillLine } from './pool';

/** Long enough that the opponent's move reads as a reply, short enough not to feel like waiting. */
export const DRILL_AUTO_PLAY_DELAY_MS = 450;

/** A move the screen is allowed to mark on the board. */
export interface DrillMoveMark {
  san: string;
  from: Square;
  to: Square;
}

/**
 * Everything the drill screen may know about the run. Notably absent: the line's id, name,
 * notes, total ply count, and every move that has not been played or explicitly revealed.
 */
export interface DrillView {
  phase: DrillPhase;
  /** Position on the board. */
  fen: string;
  /** Start position seen from `userColor` (README §7 Phase 7). */
  orientation: Orientation;
  userColor: Color;
  lastMove: PlySquares | null;
  /** Non-null only after the user asks for a hint; cleared when the position changes. */
  hint: DrillMoveMark | null;
  /** The refused move, for the error flash. Carries no hint of what was expected. */
  wrong: DrillMoveMark | null;
  /** 1-based index of the user's current move. No total — that would narrow down the line. */
  moveNumber: number;
  /** Plies played. Drives the auto-play timer; safe to expose (it is a count, not a move). */
  ply: number;
  /** Only rendered once `phase === 'complete'`. */
  summary: DrillSummary;
  canHint: boolean;
}

export type DrillRun =
  | { status: 'ready'; view: DrillView }
  /** The served line was deleted after the pool was built. */
  | { status: 'missing' }
  /** The served line no longer replays. */
  | { status: 'broken' };

export interface DrillRunController {
  run: DrillRun;
  /** The user's move, straight from the Board. */
  attempt: (move: MoveInput) => void;
  /** Reveals the expected move and counts it as failed. */
  hint: () => void;
}

/* ------------------------------------------------------------------------------------- *
 * The opaque handle
 * ------------------------------------------------------------------------------------- */

/** React state is one of these — structurally empty, so devtools shows `{}`. */
type RunHandle = Record<string, never>;

interface RunEntry {
  state: DrillState | null;
  failure: 'missing' | 'broken' | null;
}

const entries = new WeakMap<RunHandle, RunEntry>();

function handleFor(entry: RunEntry): RunHandle {
  const handle: RunHandle = {};
  entries.set(handle, entry);
  return handle;
}

function openRun(lineId: string): RunHandle {
  const loaded = loadDrillLine(lineId);
  return loaded.status === 'ready'
    ? handleFor({ state: createDrill(loaded.line), failure: null })
    : handleFor({ state: null, failure: loaded.status });
}

/**
 * Applies a transition. Returns the same handle when the transition was a no-op, so React skips
 * the re-render, and never resurrects a handle whose entry has been collected.
 */
function step(handle: RunHandle, fn: (s: DrillState) => DrillState): RunHandle {
  const entry = entries.get(handle);
  if (entry === undefined || entry.state === null) return handle;
  const next = fn(entry.state);
  return next === entry.state ? handle : handleFor({ state: next, failure: null });
}

function viewOf(state: DrillState): DrillView {
  const revealedSan = drillRevealedSan(state);
  const revealedSquares = drillRevealedSquares(state);
  const rejected = drillRejected(state);
  const phase = drillPhase(state);
  return {
    phase,
    fen: drillFen(state),
    orientation: drillOrientation(state),
    userColor: drillUserColor(state),
    lastMove: drillLastMove(state),
    hint:
      revealedSan === null || revealedSquares === null
        ? null
        : { san: revealedSan, from: revealedSquares.from, to: revealedSquares.to },
    wrong: rejected,
    moveNumber: drillUserMoveNumber(state),
    ply: drillPly(state),
    summary: drillSummary(state),
    canHint: phase === 'awaiting-user' && revealedSan === null,
  };
}

function runOf(handle: RunHandle): DrillRun {
  const entry = entries.get(handle);
  if (entry === undefined) return { status: 'missing' };
  if (entry.state === null) return { status: entry.failure ?? 'missing' };
  return { status: 'ready', view: viewOf(entry.state) };
}

/* ------------------------------------------------------------------------------------- *
 * The hook
 * ------------------------------------------------------------------------------------- */

/**
 * Opens `lineId` and drives it to the end of the line. Mount one per run (the caller keys on
 * the line id plus a run counter, so serving the same line twice really restarts it) — there is
 * no "new line arrived" effect to get wrong.
 */
export function useDrillRun(lineId: string): DrillRunController {
  const [handle, setHandle] = useState<RunHandle>(() => openRun(lineId));

  const run = useMemo(() => runOf(handle), [handle]);
  const phase = run.status === 'ready' ? run.view.phase : null;
  const ply = run.status === 'ready' ? run.view.ply : -1;

  // Auto-reply. Two guards against a stray move: the effect is keyed on the ply it was armed
  // for (so anything that changes the position cancels and re-arms it), and `drillAutoPlay` is
  // itself a no-op unless it really is the opponent's turn.
  useEffect(() => {
    if (phase !== 'auto-reply') return;
    const timer = setTimeout(() => {
      setHandle((current) => step(current, drillAutoPlay));
    }, DRILL_AUTO_PLAY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [phase, ply]);

  const attempt = useCallback((move: MoveInput) => {
    setHandle((current) => step(current, (state) => drillAttempt(state, move).state));
  }, []);

  const hint = useCallback(() => {
    setHandle((current) => step(current, (state) => drillHint(state).state));
  }, []);

  return { run, attempt, hint };
}
