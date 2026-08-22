/**
 * Blind-chess session state: plain data plus pure transitions (README §9 — keep the logic out
 * of the component so "unit tests only" stays viable).
 *
 * Deliberately DOM-free and React-free. It knows nothing about `SpeechRecognition`,
 * `speechSynthesis`, the wake lock or `localStorage`; the component wires those to it.
 *
 * Two invariants this module exists to guarantee:
 *
 *  1. **A failed input never moves a piece.** `applySpoken` returns the *same* session object
 *     for `ambiguous` / `unrecognised`, so there is no code path where a misheard phrase can
 *     touch the position (README §7 Phase 8).
 *  2. **Reveal is presentation only.** `setRevealed` copies `startFen`/`moves`/`fen` verbatim;
 *     toggling it can never alter game state (README §8.12's sibling rule for `hidePieces`).
 *
 * The spoken echo is *returned* rather than performed, so the component can `speak()` it
 * **before** committing the new state — the ordering the spec asks for ("echo of what was
 * understood before applying it").
 */

import { createGame, type Game, type GameStatus, type LegalMove } from '../../chess/game';
import { START_FEN } from '../../chess/position';
import { resolveSpokenMove, type ResolveOutcome } from '../../speech/grammar';
import type { BlindGameRecord } from '../../storage/blindGame';

/** How the last input attempt ended. Drives the tone (and the wording) of the status line. */
export type FeedbackKind = 'idle' | 'move' | 'ambiguous' | 'unrecognised' | 'error' | 'info';

export interface Feedback {
  kind: FeedbackKind;
  message: string;
  /** Candidate SANs, only for `ambiguous` — shown so the speaker knows how to narrow it. */
  candidates?: string[];
}

export interface BlindSession {
  /** Position the game started from. */
  startFen: string;
  /** SAN moves played so far, oldest first. */
  moves: string[];
  /** Position after `moves` — cached so the component never recomputes it while rendering. */
  fen: string;
  /** Whether the pieces are currently revealed. Presentation only. */
  revealed: boolean;
  feedback: Feedback;
}

const IDLE: Feedback = { kind: 'idle', message: '' };

function fenOf(startFen: string, moves: string[]): string {
  // Callers only ever build `moves` from legal moves, so this cannot fail in practice; a
  // defensive fallback keeps a corrupt input from throwing into the UI.
  try {
    const game = createGame(startFen);
    for (const san of moves) {
      if (game.move(san) === null) return game.fen();
    }
    return game.fen();
  } catch {
    return startFen;
  }
}

/** A fresh game from `startFen` (the standard start position by default). */
export function newSession(startFen: string = START_FEN): BlindSession {
  const fen = fenOf(startFen, []);
  return { startFen: fen, moves: [], fen, revealed: false, feedback: IDLE };
}

/**
 * Rebuilds a session from a persisted record. Returns `null` if the record does not replay —
 * `storage/blindGame.ts` validates before offering, so this is belt-and-braces.
 */
export function sessionFromRecord(rec: BlindGameRecord): BlindSession | null {
  let game: Game;
  try {
    game = createGame(rec.startFen);
  } catch {
    return null;
  }
  const moves: string[] = [];
  for (const san of rec.moves) {
    const applied = game.move(san);
    if (applied === null) return null;
    moves.push(applied.san);
  }
  return {
    startFen: fenOf(rec.startFen, []),
    moves,
    fen: game.fen(),
    revealed: rec.revealed,
    feedback:
      moves.length === 0
        ? IDLE
        : { kind: 'info', message: `Resumed after ${describePlyCount(moves.length)}.` },
  };
}

/** The record to persist. Called after every move (README §2.3). */
export function toRecord(s: BlindSession, now: number = Date.now()): BlindGameRecord {
  return { startFen: s.startFen, moves: [...s.moves], revealed: s.revealed, updatedAt: now };
}

/** Legal moves in the current position — the candidate set the grammar filters. */
export function legalMovesOf(s: BlindSession): LegalMove[] {
  try {
    return createGame(s.fen).legalMoves();
  } catch {
    return [];
  }
}

export function statusOf(s: BlindSession): GameStatus | null {
  try {
    return createGame(s.fen).status();
  } catch {
    return null;
  }
}

export interface SpokenResult {
  /** The next session. **Identical reference** to the input when nothing was applied. */
  session: BlindSession;
  outcome: ResolveOutcome;
  /**
   * What to say out loud: the echo of the understood move on success, the failure announcement
   * otherwise. Speak this *before* rendering `session` (the spec's ordering).
   */
  utterance: string;
}

/**
 * Resolves transcript alternatives against the legal move list and, only on an unambiguous
 * single match, applies the move.
 *
 * The same entry point serves speech and the typed fallback (`applySpoken(s, [typed])`), so
 * both inputs behave identically — including their failure messages.
 */
export function applySpoken(s: BlindSession, alternatives: string[]): SpokenResult {
  const status = statusOf(s);
  if (status !== null && status.isGameOver) {
    return {
      session: withFeedback(s, {
        kind: 'error',
        message: 'The game is over — start a new game to keep playing.',
      }),
      outcome: { status: 'unrecognised' },
      utterance: 'the game is over',
    };
  }

  const legal = legalMovesOf(s);
  const outcome = resolveSpokenMove(alternatives, legal);
  const heard = firstNonEmpty(alternatives);

  if (outcome.status === 'resolved') {
    const moves = [...s.moves, outcome.san];
    const next: BlindSession = {
      startFen: s.startFen,
      moves,
      fen: fenOf(s.startFen, moves),
      revealed: s.revealed,
      feedback: { kind: 'move', message: `${outcome.san} — ${outcome.spoken}` },
    };
    return { session: next, outcome, utterance: outcome.spoken };
  }

  if (outcome.status === 'ambiguous') {
    // Position untouched: `s` is returned with only the feedback swapped.
    return {
      session: withFeedback(s, {
        kind: 'ambiguous',
        message: `That could be more than one move${heard === null ? '' : ` — heard "${heard}"`}. Say it again with the starting square.`,
        candidates: outcome.candidates,
      }),
      outcome,
      utterance: 'which one',
    };
  }

  return {
    session: withFeedback(s, {
      kind: 'unrecognised',
      message:
        heard === null
          ? "Didn't catch that. Try again."
          : `Didn't catch a legal move in "${heard}". Try again.`,
    }),
    outcome,
    utterance: "didn't catch that",
  };
}

/** Reveal/hide the pieces. Game state is copied through untouched, by construction. */
export function setRevealed(s: BlindSession, revealed: boolean): BlindSession {
  if (s.revealed === revealed) return s;
  return {
    startFen: s.startFen,
    moves: s.moves,
    fen: s.fen,
    revealed,
    feedback: s.feedback,
  };
}

/** Takes back the last move — the escape hatch for a misheard-but-legal move. */
export function undoLast(s: BlindSession): BlindSession {
  if (s.moves.length === 0) {
    return withFeedback(s, { kind: 'info', message: 'Nothing to take back.' });
  }
  const undone = s.moves[s.moves.length - 1] as string;
  const moves = s.moves.slice(0, -1);
  return {
    startFen: s.startFen,
    moves,
    fen: fenOf(s.startFen, moves),
    revealed: s.revealed,
    feedback: { kind: 'info', message: `Took back ${undone}.` },
  };
}

export function withFeedback(s: BlindSession, feedback: Feedback): BlindSession {
  return {
    startFen: s.startFen,
    moves: s.moves,
    fen: s.fen,
    revealed: s.revealed,
    feedback,
  };
}

export function clearFeedback(s: BlindSession): BlindSession {
  return s.feedback.kind === 'idle' ? s : withFeedback(s, IDLE);
}

/** True when discarding this session would lose something the players care about. */
export function hasProgress(s: BlindSession): boolean {
  return s.moves.length > 0;
}

// ---------------------------------------------------------------------------------------
// Display helpers (pure, so they are covered by the unit tests rather than by eyeballing)
// ---------------------------------------------------------------------------------------

/** "White to move" / "Black to move (check)", or the result once the game is over. */
export function turnText(s: BlindSession): string {
  const status = statusOf(s);
  if (status === null) return '';
  const over = resultText(s);
  if (over !== null) return over;
  const side = status.turn === 'w' ? 'White' : 'Black';
  return status.inCheck ? `${side} to move — check` : `${side} to move`;
}

/** The game-end description, or `null` while the game is live. */
export function resultText(s: BlindSession): string | null {
  const status = statusOf(s);
  if (status === null || !status.isGameOver) return null;
  if (status.isCheckmate) {
    // The side to move is the one that has been mated.
    return status.turn === 'w' ? 'Checkmate — Black wins' : 'Checkmate — White wins';
  }
  if (status.isStalemate) return 'Draw — stalemate';
  if (status.isInsufficientMaterial) return 'Draw — insufficient material';
  if (status.isThreefoldRepetition) return 'Draw — threefold repetition';
  return 'Draw';
}

/** "Move 4" — the full-move number the side to move is about to play. */
export function moveNumberText(s: BlindSession): string {
  return `Move ${fullMoveNumber(s)}`;
}

export function fullMoveNumber(s: BlindSession): number {
  const field = s.fen.trim().split(/\s+/)[5];
  const n = field === undefined ? NaN : Number.parseInt(field, 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** "12 moves" / "1 move" — half-moves, which is what the players have actually spoken. */
export function describePlyCount(plies: number): string {
  return plies === 1 ? '1 move' : `${plies} moves`;
}

function firstNonEmpty(alternatives: string[]): string | null {
  for (const alternative of alternatives) {
    if (typeof alternative === 'string' && alternative.trim().length > 0) {
      return alternative.trim();
    }
  }
  return null;
}
