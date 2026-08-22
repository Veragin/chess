import { describe, expect, it } from 'vitest';
import { START_FEN } from './position';
import {
  attemptMove,
  autoPlay,
  canStepBack,
  clearRejection,
  colorAtPly,
  createSession,
  expectedSanAt,
  fenAtPly,
  isComplete,
  isSessionComplete,
  isSessionUserTurn,
  isUserTurnAt,
  lineProgress,
  matchesLine,
  normaliseSan,
  orientationFor,
  pendingAutoMove,
  resolveLine,
  restartSession,
  revealNextMove,
  sessionExpectedSan,
  sessionFen,
  sessionLastMove,
  sessionOrientation,
  sessionPlayedSans,
  sessionProgress,
  sessionSideToMove,
  squaresAtPly,
  startColorOf,
  stepBackSession,
  stepBackTargetPly,
  stepBackToUserTurn,
  stepForwardSession,
  switchSides,
  totalPlies,
  type LineSession,
  type LineSpec,
  type ResolvedLine,
} from './line';

/**
 * FEN after 1.e4 — a line whose start position has BLACK to move. chess.js 1.4.0 follows the
 * modern convention of only recording an en-passant target when a capture is actually
 * available, hence `-` rather than `e3`.
 */
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

/** Ruy Lopez, 5 plies (odd), White to move first. */
const RUY: LineSpec = {
  startFen: START_FEN,
  moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'],
  userColor: 'w',
};

/** Italian, 11 plies — README's "move 4 of 11" example. */
const ITALIAN: LineSpec = {
  startFen: START_FEN,
  moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6', 'O-O'],
  userColor: 'w',
};

/** 4 plies (even). */
const FOUR_PLIES: LineSpec = {
  startFen: START_FEN,
  moves: ['d4', 'd5', 'c4', 'e6'],
  userColor: 'w',
};

/** Sicilian from Black's side, starting from a position where BLACK moves first. */
const SICILIAN_BLACK: LineSpec = {
  startFen: AFTER_E4,
  moves: ['c5', 'Nf3', 'd6', 'd4'],
  userColor: 'b',
};

function resolved(spec: LineSpec): ResolvedLine {
  const model = resolveLine(spec);
  if (!model.ok) throw new Error(`expected a resolvable line: ${model.reason}`);
  return model;
}

function session(spec: LineSpec, userColor?: 'w' | 'b'): LineSession {
  return createSession(resolved(spec), userColor);
}

/** Plays `count` plies, letting the user's moves come from the line itself. */
function play(s: LineSession, count: number): LineSession {
  let cur = s;
  for (let i = 0; i < count; i++) {
    if (isSessionUserTurn(cur)) {
      const expected = sessionExpectedSan(cur);
      expect(expected).not.toBeNull();
      const result = attemptMove(cur, expected as string);
      expect(result.outcome).toBe('advanced');
      cur = result.session;
    } else {
      const before = cur.ply;
      cur = autoPlay(cur);
      expect(cur.ply).toBe(before + 1);
    }
  }
  return cur;
}

/* ------------------------------------------------------------------ resolveLine */

describe('resolveLine', () => {
  it('normalises the start FEN and every SAN, and indexes positions per ply', () => {
    const line = resolved(RUY);
    expect(line.startFen).toBe(START_FEN);
    expect(line.startColor).toBe('w');
    expect(line.userColor).toBe('w');
    expect(line.sans).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
    // fens[i] is the position BEFORE ply i, so there is one more FEN than there are moves.
    expect(line.fens).toHaveLength(line.sans.length + 1);
    expect(line.fens[0]).toBe(START_FEN);
    expect(line.squares).toHaveLength(line.sans.length);
    expect(line.squares[0]).toEqual({ from: 'e2', to: 'e4' });
    expect(line.squares[4]).toEqual({ from: 'f1', to: 'b5' });
  });

  it('normalises alternative SAN spellings written into storage', () => {
    const line = resolved({
      startFen: START_FEN,
      // long algebraic, a bare UCI-ish pair, and a stray check suffix
      moves: ['e2e4', 'e7e5', 'Ng1f3', 'Nb8c6', 'Bf1b5+'],
      userColor: 'w',
    });
    expect(line.sans).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
  });

  it('reads Black to move from a custom start position', () => {
    const line = resolved(SICILIAN_BLACK);
    expect(line.startColor).toBe('b');
    expect(line.userColor).toBe('b');
  });

  it('reports a broken line rather than throwing', () => {
    const model = resolveLine({
      startFen: START_FEN,
      moves: ['e4', 'e5', 'Nf3', 'Qh5'],
      userColor: 'w',
    });
    expect(model.ok).toBe(false);
    if (model.ok) throw new Error('unreachable');
    expect(model.failedAtPly).toBe(3);
    expect(model.reason).toContain('Qh5');
  });

  it('reports an illegal start position rather than throwing', () => {
    const model = resolveLine({ startFen: 'not a fen at all', moves: [], userColor: 'w' });
    expect(model.ok).toBe(false);
    if (model.ok) throw new Error('unreachable');
    expect(model.failedAtPly).toBeNull();
    expect(model.reason.length).toBeGreaterThan(0);
  });

  it('accepts an empty move list', () => {
    const line = resolved({ startFen: START_FEN, moves: [], userColor: 'b' });
    expect(line.sans).toEqual([]);
    expect(line.fens).toEqual([START_FEN]);
  });

  it('survives junk in place of the moves array', () => {
    const model = resolveLine({
      startFen: START_FEN,
      moves: [null as unknown as string],
      userColor: 'w',
    });
    expect(model.ok).toBe(false);
  });
});

/* ------------------------------------------------- expectedSanAt / fenAtPly bounds */

describe('expectedSanAt / fenAtPly / squaresAtPly', () => {
  it('returns the move at each ply and null past the end', () => {
    expect(expectedSanAt(RUY, 0)).toBe('e4');
    expect(expectedSanAt(RUY, 4)).toBe('Bb5');
    expect(expectedSanAt(RUY, 5)).toBeNull();
    expect(expectedSanAt(RUY, 99)).toBeNull();
    expect(expectedSanAt(RUY, -1)).toBeNull();
  });

  it('returns the position BEFORE the move at each ply, including the final position', () => {
    expect(fenAtPly(RUY, 0)).toBe(START_FEN);
    // ply 1 is Black's reply to 1.e4
    expect(fenAtPly(RUY, 1)).toBe(AFTER_E4);
    const final = fenAtPly(RUY, 5);
    expect(final).not.toBeNull();
    expect((final as string).split(' ')[1]).toBe('b'); // after 3.Bb5 it is Black to move
    expect(fenAtPly(RUY, 6)).toBeNull();
    expect(fenAtPly(RUY, -1)).toBeNull();
  });

  it('returns move squares per ply', () => {
    expect(squaresAtPly(RUY, 2)).toEqual({ from: 'g1', to: 'f3' });
    expect(squaresAtPly(RUY, 5)).toBeNull();
  });

  it('stops at the break in a broken line instead of guessing', () => {
    const broken: LineSpec = {
      startFen: START_FEN,
      moves: ['e4', 'e5', 'Nf3', 'Qh5'],
      userColor: 'w',
    };
    expect(expectedSanAt(broken, 2)).toBe('Nf3');
    expect(expectedSanAt(broken, 3)).toBeNull();
    expect(fenAtPly(broken, 3)).not.toBeNull(); // the position it breaks in is still known
    expect(fenAtPly(broken, 4)).toBeNull();
    // totalPlies still counts what is stored, so the UI can say "4 moves, broken at move 4".
    expect(totalPlies(broken)).toBe(4);
  });
});

/* ------------------------------------------------------------------- who moves when */

describe('isUserTurnAt', () => {
  it('is true at ply 0 when the start side to move IS the user colour', () => {
    const line: LineSpec = { startFen: START_FEN, moves: ['e4', 'e5'], userColor: 'w' };
    expect(startColorOf(line)).toBe('w');
    expect(isUserTurnAt(line, 0)).toBe(true);
    expect(isUserTurnAt(line, 1)).toBe(false);
    expect(isUserTurnAt(line, 2)).toBe(true);
  });

  it('is false at ply 0 when the user is Black and White starts (user moves second)', () => {
    const line: LineSpec = { startFen: START_FEN, moves: ['e4', 'e5'], userColor: 'b' };
    expect(isUserTurnAt(line, 0)).toBe(false);
    expect(isUserTurnAt(line, 1)).toBe(true);
    expect(isUserTurnAt(line, 2)).toBe(false);
  });

  it('is true at ply 0 when Black starts and the user is Black', () => {
    expect(startColorOf(SICILIAN_BLACK)).toBe('b');
    expect(isUserTurnAt(SICILIAN_BLACK, 0)).toBe(true);
    expect(isUserTurnAt(SICILIAN_BLACK, 1)).toBe(false);
  });

  it('is false at ply 0 when Black starts and the user is White (user moves second)', () => {
    const line: LineSpec = { ...SICILIAN_BLACK, userColor: 'w' };
    expect(isUserTurnAt(line, 0)).toBe(false);
    expect(isUserTurnAt(line, 1)).toBe(true);
    expect(isUserTurnAt(line, 2)).toBe(false);
  });

  it('alternates colours from the start side to move', () => {
    expect(colorAtPly(RUY, 0)).toBe('w');
    expect(colorAtPly(RUY, 1)).toBe('b');
    expect(colorAtPly(SICILIAN_BLACK, 0)).toBe('b');
    expect(colorAtPly(SICILIAN_BLACK, 1)).toBe('w');
  });

  it('falls back to White for an unparseable start position instead of throwing', () => {
    expect(startColorOf({ startFen: 'junk', moves: [], userColor: 'w' })).toBe('w');
  });
});

/* ----------------------------------------------------------- the matching predicate */

describe('matchesLine', () => {
  it('accepts the expected SAN and rejects a legal alternative', () => {
    expect(matchesLine(RUY, 0, 'e4')).toBe(true);
    // d4 is perfectly legal at ply 0 — and not this line.
    expect(matchesLine(RUY, 0, 'd4')).toBe(false);
    expect(matchesLine(RUY, 2, 'Nf3')).toBe(true);
    expect(matchesLine(RUY, 2, 'Nc3')).toBe(false);
    expect(matchesLine(RUY, 2, 'Bc4')).toBe(false);
  });

  it('accepts the expected move however it is spelled', () => {
    expect(matchesLine(RUY, 2, 'Ng1f3')).toBe(true);
    expect(matchesLine(RUY, 2, 'g1f3')).toBe(true);
    expect(matchesLine(RUY, 2, { from: 'g1', to: 'f3' })).toBe(true);
    expect(matchesLine(RUY, 4, 'Bb5+')).toBe(true); // stray check suffix is normalised away
  });

  it('rejects an illegal move and anything past the end of the line', () => {
    expect(matchesLine(RUY, 0, 'e5')).toBe(false);
    expect(matchesLine(RUY, 0, 'nonsense')).toBe(false);
    expect(matchesLine(RUY, 5, 'a3')).toBe(false);
    expect(matchesLine(RUY, -1, 'e4')).toBe(false);
  });

  it('normaliseSan reports null for an illegal move', () => {
    expect(normaliseSan(START_FEN, 'Ng1f3')).toBe('Nf3');
    expect(normaliseSan(START_FEN, 'Nf6')).toBeNull();
    expect(normaliseSan('junk', 'e4')).toBeNull();
  });
});

/* ------------------------------------------------------------------------- progress */

describe('progress', () => {
  it('matches README’s "move 4 of 11" display', () => {
    expect(lineProgress(ITALIAN, 3).label).toBe('Move 4 of 11');
    expect(lineProgress(ITALIAN, 3).current).toBe(4);
    expect(lineProgress(ITALIAN, 3).total).toBe(11);
    expect(lineProgress(ITALIAN, 0).label).toBe('Move 1 of 11');
  });

  it('counts an odd number of plies', () => {
    expect(totalPlies(RUY)).toBe(5);
    expect(lineProgress(RUY, 4).label).toBe('Move 5 of 5');
    expect(lineProgress(RUY, 4).complete).toBe(false);
    expect(lineProgress(RUY, 5).complete).toBe(true);
    expect(lineProgress(RUY, 5).label).toBe('Line complete — 5 moves');
    expect(lineProgress(RUY, 5).current).toBe(5);
  });

  it('counts an even number of plies', () => {
    expect(totalPlies(FOUR_PLIES)).toBe(4);
    expect(lineProgress(FOUR_PLIES, 2).label).toBe('Move 3 of 4');
    expect(lineProgress(FOUR_PLIES, 4).label).toBe('Line complete — 4 moves');
    expect(isComplete(FOUR_PLIES, 3)).toBe(false);
    expect(isComplete(FOUR_PLIES, 4)).toBe(true);
  });

  it('clamps a ply beyond the end and handles an empty line', () => {
    expect(lineProgress(RUY, 99).played).toBe(5);
    expect(lineProgress(RUY, -3).played).toBe(0);
    const empty: LineSpec = { startFen: START_FEN, moves: [], userColor: 'w' };
    expect(lineProgress(empty, 0)).toMatchObject({
      total: 0,
      current: 0,
      complete: true,
      label: 'No moves in this line',
    });
    expect(isComplete(empty, 0)).toBe(true);
  });

  it('pluralises a single-move line', () => {
    const one: LineSpec = { startFen: START_FEN, moves: ['e4'], userColor: 'w' };
    expect(lineProgress(one, 1).label).toBe('Line complete — 1 move');
  });
});

/* ----------------------------------------------------------------- session, user = W */

describe('session with the user moving first', () => {
  it('starts at the line start with nothing to auto-play', () => {
    const s = session(RUY);
    expect(s.ply).toBe(0);
    expect(sessionFen(s)).toBe(START_FEN);
    expect(sessionLastMove(s)).toBeNull();
    expect(isSessionUserTurn(s)).toBe(true);
    expect(pendingAutoMove(s)).toBeNull();
    expect(sessionOrientation(s)).toBe('white');
    expect(sessionProgress(s).label).toBe('Move 1 of 5');
  });

  it('advances on the line move and queues the opponent reply', () => {
    const s = session(RUY);
    const result = attemptMove(s, { from: 'e2', to: 'e4' });
    expect(result.outcome).toBe('advanced');
    expect(result.san).toBe('e4');
    const next = result.session;
    expect(next.ply).toBe(1);
    expect(sessionLastMove(next)).toEqual({ from: 'e2', to: 'e4' });
    expect(isSessionUserTurn(next)).toBe(false);
    // auto-play picks the correct next move
    expect(pendingAutoMove(next)).toBe('e5');
    expect(sessionProgress(next).label).toBe('Move 2 of 5');
  });

  it('refuses a legal alternative without changing the position', () => {
    const s = session(RUY);
    const result = attemptMove(s, { from: 'd2', to: 'd4' });
    expect(result.outcome).toBe('wrong');
    expect(result.san).toBe('d4');
    expect(result.expected).toBe('e4');
    const next = result.session;
    expect(next.ply).toBe(0);
    expect(sessionFen(next)).toBe(sessionFen(s));
    expect(next.wrongAttempts).toBe(1);
    expect(next.rejected).toEqual({ san: 'd4', from: 'd2', to: 'd4', expected: 'e4' });
    // it is still the user's turn, so nothing is queued for auto-play
    expect(pendingAutoMove(next)).toBeNull();
    expect(clearRejection(next).rejected).toBeNull();
    expect(clearRejection(next).ply).toBe(0);
  });

  it('refuses an outright illegal move without touching the session', () => {
    const s = session(RUY);
    const result = attemptMove(s, { from: 'e2', to: 'e5' });
    expect(result.outcome).toBe('illegal');
    expect(result.session).toBe(s);
    expect(result.session.wrongAttempts).toBe(0);
  });

  it('refuses a user move while the opponent is to move', () => {
    const s = play(session(RUY), 1); // 1.e4 played, Black to reply from the line
    expect(isSessionUserTurn(s)).toBe(false);
    const result = attemptMove(s, 'e5');
    expect(result.outcome).toBe('not-your-turn');
    expect(result.session).toBe(s);
  });

  it('plays end-to-end and reaches the completed state', () => {
    const end = play(session(RUY), 5);
    expect(end.ply).toBe(5);
    expect(isSessionComplete(end)).toBe(true);
    expect(isSessionUserTurn(end)).toBe(false);
    expect(pendingAutoMove(end)).toBeNull();
    expect(sessionExpectedSan(end)).toBeNull();
    expect(sessionProgress(end).label).toBe('Line complete — 5 moves');
    expect(sessionPlayedSans(end)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
    expect(attemptMove(end, 'a3').outcome).toBe('finished');
  });
});

/* ----------------------------------------------------------------- session, user = B */

describe('session where the user moves second', () => {
  it('auto-plays White first, then hands the move to the user', () => {
    const s = session(RUY, 'b');
    expect(s.userColor).toBe('b');
    expect(sessionOrientation(s)).toBe('black');
    expect(isSessionUserTurn(s)).toBe(false);
    expect(pendingAutoMove(s)).toBe('e4');

    const afterAuto = autoPlay(s);
    expect(afterAuto.ply).toBe(1);
    expect(isSessionUserTurn(afterAuto)).toBe(true);
    expect(pendingAutoMove(afterAuto)).toBeNull();
    expect(sessionExpectedSan(afterAuto)).toBe('e5');

    const result = attemptMove(afterAuto, 'e5');
    expect(result.outcome).toBe('advanced');
    expect(result.session.ply).toBe(2);
  });

  it('rejects a legal alternative for the second mover too', () => {
    const s = autoPlay(session(RUY, 'b'));
    const result = attemptMove(s, 'c5');
    expect(result.outcome).toBe('wrong');
    expect(result.session.ply).toBe(1);
    expect(result.expected).toBe('e5');
  });

  it('plays a line whose start position has Black to move end-to-end', () => {
    const end = play(session(SICILIAN_BLACK), 4);
    expect(sessionSideToMove(session(SICILIAN_BLACK))).toBe('b');
    expect(end.ply).toBe(4);
    expect(isSessionComplete(end)).toBe(true);
    expect(sessionPlayedSans(end)).toEqual(['c5', 'Nf3', 'd6', 'd4']);
  });

  it('auto-plays the very last ply when the opponent has the final move', () => {
    // 4 plies from a Black-to-move start with the user as Black: plies 0 and 2 are the user's,
    // plies 1 and 3 are auto-played, so the line ends on an auto-play.
    let s = session(SICILIAN_BLACK);
    s = play(s, 3);
    expect(isSessionUserTurn(s)).toBe(false);
    expect(pendingAutoMove(s)).toBe('d4');
    s = autoPlay(s);
    expect(isSessionComplete(s)).toBe(true);
    // A late timer must not move again.
    expect(autoPlay(s)).toBe(s);
  });
});

/* --------------------------------------------------------------------- controls */

describe('controls', () => {
  it('restart returns to the start of the line and clears the run counters', () => {
    // Stop on a ply the user owns (ply 2 is White's, and the user is White) so the wrong move
    // below is actually judged rather than refused as "not your turn".
    let s = play(session(RUY), 2);
    s = revealNextMove(s);
    s = attemptMove(s, 'a3').session; // wrong: bumps wrongAttempts
    expect(s.ply).toBe(2);
    expect(s.hintsUsed).toBe(1);
    expect(s.wrongAttempts).toBe(1);

    const restarted = restartSession(s);
    expect(restarted.ply).toBe(0);
    expect(sessionFen(restarted)).toBe(START_FEN);
    expect(restarted.userColor).toBe('w');
    expect(restarted.revealed).toBeNull();
    expect(restarted.rejected).toBeNull();
    expect(restarted.hintsUsed).toBe(0);
    expect(restarted.wrongAttempts).toBe(0);
  });

  it('step back goes back exactly one ply and stops at the start', () => {
    const s = play(session(RUY), 3);
    const back = stepBackSession(s);
    expect(back.ply).toBe(2);
    expect(sessionFen(back)).toBe(fenAtPly(RUY, 2));
    expect(sessionLastMove(back)).toEqual({ from: 'e7', to: 'e5' });

    expect(stepBackSession(stepBackSession(stepBackSession(back))).ply).toBe(0);
    expect(stepBackSession(session(RUY)).ply).toBe(0);
  });

  it('step back clears a revealed move and an error flash', () => {
    let s = revealNextMove(session(RUY));
    s = attemptMove(s, 'd4').session;
    expect(s.rejected).not.toBeNull();
    const back = stepBackSession(s);
    expect(back.revealed).toBeNull();
    expect(back.rejected).toBeNull();
  });

  it('reveal next move surfaces the correct SAN and counts as a hint', () => {
    const s = session(RUY);
    const revealed = revealNextMove(s);
    expect(revealed.revealed).toBe('e4');
    expect(revealed.hintsUsed).toBe(1);
    // Revealing twice at the same ply is idempotent (no double-counting on a double click).
    expect(revealNextMove(revealed)).toBe(revealed);

    const later = revealNextMove(play(session(RUY), 2));
    expect(later.revealed).toBe('Nf3');

    // Nothing to reveal at the end of the line.
    const end = play(session(RUY), 5);
    expect(revealNextMove(end)).toBe(end);
  });

  it('advancing clears a revealed move', () => {
    const s = revealNextMove(session(RUY));
    const next = attemptMove(s, 'e4').session;
    expect(next.revealed).toBeNull();
  });

  it('"step back one move" lands on the user’s previous move, undoing the auto-reply with it', () => {
    // User is White, so plies 0/2/4 are theirs and 1/3 are auto-played.
    const s = play(session(RUY), 4);
    expect(s.ply).toBe(4);
    expect(canStepBack(s)).toBe(true);
    expect(stepBackTargetPly(s)).toBe(2);
    const back = stepBackToUserTurn(s);
    expect(back.ply).toBe(2);
    expect(isSessionUserTurn(back)).toBe(true);
    expect(sessionExpectedSan(back)).toBe('Nf3');
  });

  it('steps back out of the completed state onto the last user move', () => {
    const end = play(session(RUY), 5);
    expect(canStepBack(end)).toBe(true);
    const back = stepBackToUserTurn(end);
    expect(back.ply).toBe(4);
    expect(isSessionUserTurn(back)).toBe(true);
    expect(isSessionComplete(back)).toBe(false);
  });

  it('cannot step back from the first user move of the line, from either side', () => {
    const white = session(RUY);
    expect(canStepBack(white)).toBe(false);
    expect(stepBackToUserTurn(white)).toBe(white);

    // User is Black: the app auto-plays ply 0, so ply 1 is the first thing the user does and
    // stepping back to ply 0 would only be auto-played forward again.
    const black = autoPlay(session(RUY, 'b'));
    expect(black.ply).toBe(1);
    expect(isSessionUserTurn(black)).toBe(true);
    expect(canStepBack(black)).toBe(false);
    expect(stepBackToUserTurn(black)).toBe(black);

    const later = play(black, 2);
    expect(later.ply).toBe(3);
    expect(canStepBack(later)).toBe(true);
    expect(stepBackToUserTurn(later).ply).toBe(1);
  });

  it('step forward walks the line whoever owns the ply, and stops at the end', () => {
    let s = session(RUY);
    for (let i = 0; i < 5; i++) s = stepForwardSession(s);
    expect(s.ply).toBe(5);
    expect(stepForwardSession(s)).toBe(s);
  });
});

/* ------------------------------------------------------------------- switch sides */

describe('switchSides', () => {
  it('resets to the start of the line rather than leaving a half-played state', () => {
    let s = play(session(RUY), 2);
    s = revealNextMove(s);
    s = attemptMove(s, 'a3').session;
    expect(s.ply).toBe(2);
    expect(s.wrongAttempts).toBe(1);
    expect(s.hintsUsed).toBe(1);

    const switched = switchSides(s);
    expect(switched.userColor).toBe('b');
    expect(switched.ply).toBe(0);
    expect(sessionFen(switched)).toBe(START_FEN);
    expect(sessionLastMove(switched)).toBeNull();
    expect(switched.revealed).toBeNull();
    expect(switched.rejected).toBeNull();
    expect(switched.hintsUsed).toBe(0);
    expect(switched.wrongAttempts).toBe(0);
    expect(sessionProgress(switched).label).toBe('Move 1 of 5');
    // From the other side the app moves first.
    expect(isSessionUserTurn(switched)).toBe(false);
    expect(pendingAutoMove(switched)).toBe('e4');
    expect(sessionOrientation(switched)).toBe('black');
  });

  it('is its own inverse and never touches the stored line', () => {
    const s = play(session(RUY), 2);
    const back = switchSides(switchSides(s));
    expect(back.userColor).toBe(s.userColor);
    expect(back.ply).toBe(0);
    // The resolved line object is shared, not rewritten: userColor as stored is untouched.
    expect(back.line).toBe(s.line);
    expect(back.line.userColor).toBe('w');
    expect(RUY.userColor).toBe('w');
  });

  it('is playable end-to-end from the switched side', () => {
    const switched = switchSides(session(RUY));
    const end = play(switched, 5);
    expect(isSessionComplete(end)).toBe(true);
    expect(sessionPlayedSans(end)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
  });

  it('flips a Black-to-move line to White as well', () => {
    const switched = switchSides(session(SICILIAN_BLACK));
    expect(switched.userColor).toBe('w');
    expect(sessionOrientation(switched)).toBe('white');
    // Black starts the line, so with the user as White the app auto-plays ply 0.
    expect(isSessionUserTurn(switched)).toBe(false);
    expect(pendingAutoMove(switched)).toBe('c5');
    expect(isSessionComplete(play(switched, 4))).toBe(true);
  });
});

describe('orientationFor', () => {
  it('maps colours to board orientation', () => {
    expect(orientationFor('w')).toBe('white');
    expect(orientationFor('b')).toBe('black');
  });
});
