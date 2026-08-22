import { describe, expect, it } from 'vitest';
import { START_FEN } from '../../chess/position';
import {
  applySpoken,
  clearFeedback,
  describePlyCount,
  hasProgress,
  legalMovesOf,
  moveNumberText,
  newSession,
  resultText,
  sessionFromRecord,
  setRevealed,
  toRecord,
  turnText,
  undoLast,
  type BlindSession,
} from './session';

/** Plays a list of spoken phrases in order, asserting each one resolves. */
function play(session: BlindSession, ...phrases: string[]): BlindSession {
  let current = session;
  for (const phrase of phrases) {
    const result = applySpoken(current, [phrase]);
    expect(result.outcome.status, `"${phrase}" should resolve`).toBe('resolved');
    current = result.session;
  }
  return current;
}

describe('newSession', () => {
  it('starts from the standard position with nothing played and pieces hidden', () => {
    const s = newSession();
    expect(s.startFen).toBe(START_FEN);
    expect(s.fen).toBe(START_FEN);
    expect(s.moves).toEqual([]);
    expect(s.revealed).toBe(false);
    expect(s.feedback.kind).toBe('idle');
    expect(hasProgress(s)).toBe(false);
  });

  it('accepts a custom start position', () => {
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 4 3';
    const s = newSession(fen);
    expect(s.fen).toBe(fen);
    expect(turnText(s)).toBe('White to move');
  });
});

describe('applySpoken — success', () => {
  it('plays "e four" as e4 and flips the turn', () => {
    const before = newSession();
    const { session, outcome, utterance } = applySpoken(before, ['e four']);
    expect(outcome.status).toBe('resolved');
    expect(session.moves).toEqual(['e4']);
    expect(turnText(before)).toBe('White to move');
    expect(turnText(session)).toBe('Black to move');
    expect(utterance).toBe('e4');
    expect(session.feedback.kind).toBe('move');
    expect(session.feedback.message).toContain('e4');
  });

  it('echoes a piece move in words', () => {
    const s = play(newSession(), 'e four', 'e five');
    const { session, utterance } = applySpoken(s, ['knight f3']);
    expect(session.moves).toEqual(['e4', 'e5', 'Nf3']);
    expect(utterance).toBe('knight f3');
  });

  it('plays a capture spoken as "bishop takes c6"', () => {
    const s = play(
      newSession(),
      'e four',
      'e five',
      'knight f3',
      'knight c6',
      'bishop b five',
      'a six',
    );
    const { session, utterance } = applySpoken(s, ['bishop takes c6']);
    expect(session.moves[session.moves.length - 1]).toBe('Bxc6');
    expect(utterance).toBe('bishop takes c6');
  });

  it('castles short', () => {
    const s = play(
      newSession(),
      'e four',
      'e five',
      'knight f3',
      'knight c6',
      'bishop c four',
      'bishop c five',
    );
    const { session, utterance } = applySpoken(s, ['castles short']);
    expect(session.moves[session.moves.length - 1]).toBe('O-O');
    expect(utterance).toBe('castles short');
  });

  it('never mutates the session it was given', () => {
    const before = newSession();
    const snapshot = JSON.stringify(before);
    applySpoken(before, ['e four']);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('keeps the reveal state across a move', () => {
    const revealed = setRevealed(newSession(), true);
    const { session } = applySpoken(revealed, ['e four']);
    expect(session.revealed).toBe(true);
  });

  it('reports the full-move number as the players would count it', () => {
    let s = newSession();
    expect(moveNumberText(s)).toBe('Move 1');
    s = play(s, 'e four');
    expect(moveNumberText(s)).toBe('Move 1');
    s = play(s, 'e five');
    expect(moveNumberText(s)).toBe('Move 2');
  });
});

describe('applySpoken — failure never changes the position', () => {
  it('returns the very same session object for garbage input', () => {
    const before = play(newSession(), 'e four');
    const { session, outcome } = applySpoken(before, ['banana milkshake']);
    expect(outcome.status).toBe('unrecognised');
    expect(session.moves).toEqual(before.moves);
    expect(session.fen).toBe(before.fen);
    expect(session.feedback.kind).toBe('unrecognised');
  });

  it('rejects a legal-sounding but illegal move', () => {
    const before = newSession();
    const { session, outcome, utterance } = applySpoken(before, ['knight e5']);
    expect(outcome.status).toBe('unrecognised');
    expect(session.fen).toBe(before.fen);
    expect(utterance).toBe("didn't catch that");
  });

  it('surfaces the candidates of an ambiguous phrase without moving', () => {
    // The classic Rad1/Rhd1 case: both rooks reach d1, so "rook d1" cannot be resolved.
    const fen = 'r6r/4kppp/8/8/8/8/4KPPP/R6R w - - 0 1';
    const before = newSession(fen);
    const { session, outcome } = applySpoken(before, ['rook d1']);
    expect(outcome.status).toBe('ambiguous');
    if (outcome.status === 'ambiguous') {
      expect(outcome.candidates.sort()).toEqual(['Rad1', 'Rhd1']);
    }
    expect(session.fen).toBe(before.fen);
    expect(session.feedback.kind).toBe('ambiguous');
    expect(session.feedback.candidates).toEqual(['Rad1', 'Rhd1']);
  });

  it('resolves the same phrase once the origin file is named', () => {
    const fen = 'r6r/4kppp/8/8/8/8/4KPPP/R6R w - - 0 1';
    const { session, outcome } = applySpoken(newSession(fen), ['rook a d1']);
    expect(outcome.status).toBe('resolved');
    expect(session.moves).toEqual(['Rad1']);
  });

  it('falls through to a later alternative when the first is unusable', () => {
    const { session, outcome } = applySpoken(newSession(), ['banana', 'night f3']);
    expect(outcome.status).toBe('resolved');
    expect(session.moves).toEqual(['Nf3']);
  });

  it('refuses input once the game is over', () => {
    // 1.f3 e5 2.g4 Qh4# — fool's mate.
    const mated = play(newSession(), 'pawn f three', 'e five', 'pawn g four', 'queen h four');
    expect(resultText(mated)).toBe('Checkmate — Black wins');
    const { session, outcome } = applySpoken(mated, ['e four']);
    expect(outcome.status).toBe('unrecognised');
    expect(session.moves).toEqual(mated.moves);
    expect(session.feedback.message).toMatch(/game is over/i);
  });

  it('treats an empty transcript as unrecognised', () => {
    const before = newSession();
    const { session, outcome } = applySpoken(before, ['', '   ']);
    expect(outcome.status).toBe('unrecognised');
    expect(session.fen).toBe(before.fen);
  });
});

describe('typed fallback shares the spoken path exactly', () => {
  it('produces the same result for the same text', () => {
    const s = newSession();
    const spoken = applySpoken(s, ['knight f3']);
    const typed = applySpoken(s, ['Nf3']);
    expect(typed.session.moves).toEqual(spoken.session.moves);
    expect(typed.outcome.status).toBe('resolved');
    expect(typed.utterance).toBe('knight f3');
  });

  it('reports a typed illegal move the same way a misheard one is reported', () => {
    const { session, outcome } = applySpoken(newSession(), ['Qh5']);
    expect(outcome.status).toBe('unrecognised');
    expect(session.moves).toEqual([]);
    expect(session.feedback.kind).toBe('unrecognised');
  });
});

describe('setRevealed is side-effect free (README Phase 8)', () => {
  it('changes only the reveal flag', () => {
    const before = play(newSession(), 'e four', 'e five', 'knight f3');
    const shown = setRevealed(before, true);
    const hidden = setRevealed(shown, false);

    expect(shown.revealed).toBe(true);
    expect(hidden.revealed).toBe(false);
    for (const s of [shown, hidden]) {
      expect(s.startFen).toBe(before.startFen);
      expect(s.moves).toEqual(before.moves);
      expect(s.fen).toBe(before.fen);
      expect(s.feedback).toEqual(before.feedback);
    }
  });

  it('is a no-op when the flag already matches', () => {
    const s = newSession();
    expect(setRevealed(s, false)).toBe(s);
  });

  it('round-trips through storage without disturbing the position', () => {
    const before = play(newSession(), 'e four', 'e five');
    const record = toRecord(setRevealed(before, true), 123);
    const restored = sessionFromRecord(record);
    expect(restored?.fen).toBe(before.fen);
    expect(restored?.revealed).toBe(true);
  });
});

describe('undoLast', () => {
  it('takes back the last move and restores the previous position', () => {
    const s = play(newSession(), 'e four', 'e five');
    const oneBack = undoLast(s);
    expect(oneBack.moves).toEqual(['e4']);
    expect(oneBack.fen).toBe(play(newSession(), 'e four').fen);
    expect(oneBack.feedback.message).toContain('e5');
  });

  it('is safe at the start of a game', () => {
    const s = newSession();
    const undone = undoLast(s);
    expect(undone.moves).toEqual([]);
    expect(undone.fen).toBe(s.fen);
    expect(undone.feedback.kind).toBe('info');
  });

  it('lets a misheard-but-legal move be replaced', () => {
    const s = play(newSession(), 'e four');
    const fixed = play(undoLast(s), 'd four');
    expect(fixed.moves).toEqual(['d4']);
  });

  it('preserves the reveal state', () => {
    const s = setRevealed(play(newSession(), 'e four'), true);
    expect(undoLast(s).revealed).toBe(true);
  });
});

describe('records', () => {
  it('round-trips a session', () => {
    const s = play(newSession(), 'e four', 'e five', 'knight f3');
    const restored = sessionFromRecord(toRecord(s, 5));
    expect(restored).not.toBeNull();
    expect(restored?.moves).toEqual(['e4', 'e5', 'Nf3']);
    expect(restored?.fen).toBe(s.fen);
  });

  it('round-trips a custom start position', () => {
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 4 3';
    const s = play(newSession(fen), 'bishop c four');
    const restored = sessionFromRecord(toRecord(s, 5));
    expect(restored?.startFen).toBe(fen);
    expect(restored?.fen).toBe(s.fen);
  });

  it('mentions the resume in the feedback line, but not for an empty game', () => {
    const resumed = sessionFromRecord(toRecord(play(newSession(), 'e four'), 1));
    expect(resumed?.feedback.message).toContain('1 move');
    expect(sessionFromRecord(toRecord(newSession(), 1))?.feedback.kind).toBe('idle');
  });

  it('returns null for a record whose moves do not replay', () => {
    expect(
      sessionFromRecord({ startFen: START_FEN, moves: ['e4', 'e4'], revealed: false, updatedAt: 0 }),
    ).toBeNull();
  });

  it('returns null for an unparseable start position', () => {
    expect(
      sessionFromRecord({ startFen: 'nope', moves: [], revealed: false, updatedAt: 0 }),
    ).toBeNull();
  });

  it('copies the move array so later mutation cannot reach the session', () => {
    const s = play(newSession(), 'e four');
    const rec = toRecord(s, 1);
    rec.moves.push('e5');
    expect(s.moves).toEqual(['e4']);
  });
});

describe('status text', () => {
  it('announces check', () => {
    const s = play(newSession(), 'e four', 'f five', 'queen h five');
    expect(turnText(s)).toBe('Black to move — check');
  });

  it('detects checkmate, naming the winner', () => {
    const s = play(newSession(), 'pawn f three', 'e five', 'pawn g four', 'queen h four');
    expect(resultText(s)).toBe('Checkmate — Black wins');
    expect(turnText(s)).toBe('Checkmate — Black wins');
  });

  it('detects stalemate', () => {
    const s = newSession('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(resultText(s)).toBe('Draw — stalemate');
  });

  it('detects insufficient material', () => {
    const s = newSession('8/8/4k3/8/8/4K3/8/8 w - - 0 1');
    expect(resultText(s)).toBe('Draw — insufficient material');
  });

  it('reports no result while the game is live', () => {
    expect(resultText(newSession())).toBeNull();
  });
});

describe('misc helpers', () => {
  it('lists the legal moves of the current position', () => {
    expect(legalMovesOf(newSession())).toHaveLength(20);
    expect(legalMovesOf(play(newSession(), 'e four'))).toHaveLength(20);
  });

  it('pluralises the ply count', () => {
    expect(describePlyCount(1)).toBe('1 move');
    expect(describePlyCount(0)).toBe('0 moves');
    expect(describePlyCount(12)).toBe('12 moves');
  });

  it('clears feedback without touching the position', () => {
    const s = play(newSession(), 'e four');
    const cleared = clearFeedback(s);
    expect(cleared.feedback.kind).toBe('idle');
    expect(cleared.fen).toBe(s.fen);
    expect(clearFeedback(cleared)).toBe(cleared);
  });

  it('knows when a game has progress worth confirming before discarding', () => {
    expect(hasProgress(newSession())).toBe(false);
    expect(hasProgress(play(newSession(), 'e four'))).toBe(true);
  });
});
