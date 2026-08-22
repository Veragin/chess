/**
 * React wiring for a `LineSession` (Phase 6). Every decision lives in the pure
 * `src/chess/line.ts`; this hook only owns what genuinely needs React: the state cell, the
 * board rotation override, and the auto-play timer.
 *
 * Auto-play rules the timer has to respect (README §7 Phase 6):
 *  - short delay (a few hundred ms) so the opponent's reply reads as a reply, not a jump;
 *  - never fires after unmount — the effect clears its own timeout;
 *  - never double-fires. Two independent guards: the effect is keyed on the ply it was armed
 *    for (so a fast click that changes the ply cancels it and re-arms), and the update runs
 *    through `autoPlay`, which is a no-op unless it really is the opponent's turn.
 *
 * The caller mounts this per line (see `LinePlay`'s `key`), so there is no "new line arrived"
 * effect to get wrong.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MoveInput } from '../../../chess/game';
import {
  attemptMove,
  autoPlay,
  canStepBack,
  createSession,
  isSessionUserTurn,
  jumpToPly,
  orientationFor,
  pendingAutoMove,
  restartSession,
  revealNextMove,
  sessionExpectedSan,
  sessionFen,
  sessionLastMove,
  sessionPlayedSans,
  sessionProgress,
  stepBackToUserTurn,
  switchSides,
  type LineProgress,
  type LineSession,
  type PlySquares,
  type ResolvedLine,
} from '../../../chess/line';
import { flipOrientation, type Orientation } from '../../../chess/position';

/** Long enough to read as a reply, short enough not to feel like waiting. */
export const AUTO_PLAY_DELAY_MS = 450;

export interface LinePlayController {
  session: LineSession;
  /** Position on the board. */
  fen: string;
  orientation: Orientation;
  progress: LineProgress;
  lastMove: PlySquares | null;
  playedSans: string[];
  /** True while the app owes the board an auto-played opponent move. */
  autoPlaying: boolean;
  userTurn: boolean;
  complete: boolean;
  /** The move the line expects next, or null at the end. */
  expectedSan: string | null;
  canStepBack: boolean;
  attempt: (move: MoveInput) => void;
  restart: () => void;
  stepBack: () => void;
  reveal: () => void;
  /** Replays the same line from the other colour — resets to the start, never writes. */
  flipSides: () => void;
  jump: (ply: number) => void;
  /** Board rotation only; does not change which side is being trained (README §8.12). */
  rotate: () => void;
}

export function useLineSession(line: ResolvedLine): LinePlayController {
  const [session, setSession] = useState<LineSession>(() => createSession(line));
  /**
   * Orientation follows the side being trained. A manual rotate stores an override here, and
   * switching sides drops it so the board re-orients for the new colour.
   */
  const [rotated, setRotated] = useState<Orientation | null>(null);

  const auto = pendingAutoMove(session);

  useEffect(() => {
    if (auto === null) return;
    const timer = setTimeout(() => {
      // `autoPlay` re-checks the turn, so a stale timer can never move for the user.
      setSession((current) => autoPlay(current));
    }, AUTO_PLAY_DELAY_MS);
    return () => clearTimeout(timer);
    // Keyed on the ply (and side) the timer was armed for: revealing a move or flashing an
    // error must not restart the countdown, but advancing or switching sides must.
  }, [auto, session.ply, session.userColor]);

  const attempt = useCallback((move: MoveInput) => {
    setSession((current) => attemptMove(current, move).session);
  }, []);

  const restart = useCallback(() => {
    setSession(restartSession);
  }, []);

  const stepBack = useCallback(() => {
    setSession(stepBackToUserTurn);
  }, []);

  const reveal = useCallback(() => {
    setSession(revealNextMove);
  }, []);

  const flipSides = useCallback(() => {
    setSession(switchSides);
    setRotated(null);
  }, []);

  const jump = useCallback((ply: number) => {
    setSession((current) => jumpToPly(current, ply));
  }, []);

  const rotate = useCallback(() => {
    setRotated((previous) => flipOrientation(previous ?? orientationFor(session.userColor)));
  }, [session.userColor]);

  const progress = useMemo(() => sessionProgress(session), [session]);
  const playedSans = useMemo(() => sessionPlayedSans(session), [session]);

  return {
    session,
    fen: sessionFen(session),
    orientation: rotated ?? orientationFor(session.userColor),
    progress,
    lastMove: sessionLastMove(session),
    playedSans,
    autoPlaying: auto !== null,
    userTurn: isSessionUserTurn(session),
    complete: progress.complete,
    expectedSan: sessionExpectedSan(session),
    canStepBack: canStepBack(session),
    attempt,
    restart,
    stepBack,
    reveal,
    flipSides,
    jump,
    rotate,
  };
}
