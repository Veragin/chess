import { describe, expect, it } from 'vitest';
import {
  createDrill,
  drillAttempt,
  drillAutoPlay,
  drillFen,
  drillHint,
  drillOrientation,
  drillPendingAutoMove,
  drillPhase,
  drillRejected,
  drillRevealedSan,
  drillRevealedSquares,
  drillSummary,
  drillSummaryLabel,
  drillUserColor,
  drillUserMoveNumber,
  drillUserPlyCount,
  emptyCycle,
  pickNextLine,
  pickNextLineId,
  remainingInCycle,
  type DrillCycle,
  type DrillPhase,
  type DrillState,
  type RandomInt,
} from './drill';
import { resolveLine, type LineSpec, type ResolvedLine } from './line';
import { START_FEN } from './position';

/* ------------------------------------------------------------------------------------- *
 * Fixtures
 * ------------------------------------------------------------------------------------- */

/** Ruy Lopez, 5 plies, White to move in `startFen` — the user (White) moves FIRST. */
const RUY: LineSpec = {
  startFen: START_FEN,
  moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'],
  userColor: 'w',
};

/** Same moves trained as Black — the user moves SECOND, so the app opens with `e4`. */
const RUY_AS_BLACK: LineSpec = { ...RUY, userColor: 'b' };

/**
 * A line whose start position already has Black to move (after 1.e4), trained as White: the
 * user still moves second, but via the start FEN rather than via `userColor`. Both paths have
 * to work — nothing may assume White moves first (see `line.ts`).
 */
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const FROM_BLACKS_TURN: LineSpec = {
  startFen: AFTER_E4,
  moves: ['e5', 'Nf3', 'Nc6'],
  userColor: 'w',
};

/** The line's own move at `ply`, asserted to exist — `noUncheckedIndexedAccess` is on. */
function sanAt(line: ResolvedLine, ply: number): string {
  const san = line.sans[ply];
  if (san === undefined) throw new Error(`no ply ${ply} in this line`);
  return san;
}

function resolved(spec: LineSpec): ResolvedLine {
  const model = resolveLine(spec);
  if (!model.ok) throw new Error(`fixture does not replay: ${model.reason}`);
  return model;
}

/**
 * Deterministic `RandomInt`: a 32-bit LCG, so a seeded run is reproducible and the cycle tests
 * assert real behaviour rather than a stubbed constant. `Math.random` never runs in these tests.
 */
function seededRandomInt(seed: number): RandomInt {
  let state = (seed >>> 0) || 1;
  const step = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  // Neighbouring seeds otherwise produce neighbouring first outputs; a few steps decorrelate.
  for (let i = 0; i < 8; i++) step();
  return (n) => {
    // Uses the high bits: an LCG's low bits have a short period and would bias small `n`.
    return n <= 0 ? 0 : Math.floor((step() / 0x100000000) * n);
  };
}

/** Draws `count` ids in sequence, threading the cycle through. */
function draw(
  ids: readonly string[],
  count: number,
  rand: RandomInt,
  start: DrillCycle = emptyCycle(),
): { ids: (string | null)[]; cycle: DrillCycle; reshuffles: number } {
  let cycle = start;
  let reshuffles = 0;
  const out: (string | null)[] = [];
  for (let i = 0; i < count; i++) {
    const pick = pickNextLineId(ids, cycle, rand);
    if (pick.reshuffled) reshuffles++;
    cycle = pick.cycle;
    out.push(pick.id);
  }
  return { ids: out, cycle, reshuffles };
}

/**
 * Drives a run to the end by always playing the line's own move, auto-playing the opponent's,
 * and recording the phase before every step. Returns the phase trace and the final state.
 */
function runCleanly(line: ResolvedLine): { phases: DrillPhase[]; state: DrillState } {
  let state = createDrill(line);
  const phases: DrillPhase[] = [drillPhase(state)];
  // Bounded so a logic bug fails the test instead of hanging it.
  for (let guard = 0; guard < 200 && drillPhase(state) !== 'complete'; guard++) {
    if (drillPhase(state) === 'auto-reply') {
      state = drillAutoPlay(state);
    } else {
      const result = drillAttempt(state, sanAt(line, state.session.ply));
      expect(result.outcome).toBe('advanced');
      state = result.state;
    }
    phases.push(drillPhase(state));
  }
  return { phases, state };
}

/* ------------------------------------------------------------------------------------- *
 * 1. The cycle — uniform random, no repeats within a cycle (README §7 Phase 7)
 * ------------------------------------------------------------------------------------- */

describe('drill cycle', () => {
  const POOL = ['a', 'b', 'c', 'd', 'e'];

  it('never repeats a line before all have been served', () => {
    // Several seeds, several full cycles each: every window of `POOL.length` draws that starts
    // on a cycle boundary must be a permutation of the whole set.
    for (const seed of [1, 7, 42, 1234, 99991]) {
      const { ids } = draw(POOL, POOL.length * 4, seededRandomInt(seed));
      for (let start = 0; start < ids.length; start += POOL.length) {
        const cycleIds = ids.slice(start, start + POOL.length);
        expect(new Set(cycleIds).size).toBe(POOL.length);
        expect([...cycleIds].sort()).toEqual([...POOL].sort());
      }
    }
  });

  it('reshuffles exactly once per completed pass', () => {
    const { reshuffles } = draw(POOL, POOL.length * 3, seededRandomInt(5));
    // The first draw of passes 2 and 3 reshuffles; the very first draw does not.
    expect(reshuffles).toBe(2);
  });

  it('uses the injected index to choose, rather than always taking the first candidate', () => {
    // Guards against "always take candidates[0]", which would also pass the permutation test.
    for (let index = 0; index < POOL.length; index++) {
      expect(pickNextLineId(POOL, emptyCycle(), () => index).id).toBe(POOL[index]);
    }
    // Candidates keep pool order minus what has been served, so index 0 is the first survivor.
    expect(pickNextLineId(POOL, { served: ['a', 'b'] }, () => 0).id).toBe('c');
    expect(pickNextLineId(POOL, { served: ['a', 'b'] }, () => 2).id).toBe('e');
  });

  it('clamps an out-of-range or non-integer index instead of returning undefined', () => {
    expect(pickNextLineId(POOL, emptyCycle(), () => 99).id).toBe('e');
    expect(pickNextLineId(POOL, emptyCycle(), () => -1).id).toBe('a');
    expect(pickNextLineId(POOL, emptyCycle(), () => 1.7).id).toBe('a');
    expect(pickNextLineId(POOL, emptyCycle(), () => Number.NaN).id).toBe('a');
  });

  it('spreads draws over the pool across many seeds', () => {
    const firsts = new Set<string | null | undefined>();
    for (let seed = 1; seed <= 40; seed++) {
      firsts.add(draw(POOL, 1, seededRandomInt(seed)).ids[0]);
    }
    expect(firsts.size).toBe(POOL.length);
  });

  it('tracks what is left in the current cycle', () => {
    expect(remainingInCycle(POOL, emptyCycle()).sort()).toEqual([...POOL].sort());
    expect(remainingInCycle(POOL, { served: ['a', 'c'] }).sort()).toEqual(['b', 'd', 'e']);
    expect(remainingInCycle(POOL, { served: POOL })).toEqual([]);
  });

  it('serves the single line of a one-line store over and over', () => {
    const rand = seededRandomInt(3);
    const { ids, reshuffles } = draw(['only'], 4, rand);
    expect(ids).toEqual(['only', 'only', 'only', 'only']);
    expect(reshuffles).toBe(3);
  });

  it('returns null for an empty store and leaves the cycle empty', () => {
    const pick = pickNextLineId([], emptyCycle(), seededRandomInt(1));
    expect(pick.id).toBeNull();
    expect(pick.cycle.served).toEqual([]);
    expect(pick.reshuffled).toBe(false);
  });

  it('never serves a line deleted mid-cycle, and does not let it block the reshuffle', () => {
    const rand = seededRandomInt(11);
    // Serve two of three, then delete one of the two that are left.
    let cycle = emptyCycle();
    const served: (string | null)[] = [];
    for (let i = 0; i < 2; i++) {
      const pick = pickNextLineId(['a', 'b', 'c'], cycle, rand);
      cycle = pick.cycle;
      served.push(pick.id);
    }
    const [survivor] = ['a', 'b', 'c'].filter((id) => !served.includes(id));
    if (survivor === undefined) throw new Error('expected exactly one unserved line');

    // The store now loses the remaining unserved line: every survivor has been served, so the
    // next draw must reshuffle and must only ever return an id that still exists.
    const shrunk = ['a', 'b', 'c'].filter((id) => id !== survivor);
    const next = pickNextLineId(shrunk, cycle, rand);
    expect(next.reshuffled).toBe(true);
    expect(shrunk).toContain(next.id);

    // And a line deleted while still unserved is simply never handed out.
    const after = draw(shrunk, 20, rand, next.cycle);
    expect(after.ids).not.toContain(survivor);
  });

  it('lets a line added mid-cycle join the current cycle', () => {
    const rand = seededRandomInt(21);
    const first = pickNextLineId(['a', 'b'], emptyCycle(), rand);
    const cycle = first.cycle;
    expect(remainingInCycle(['a', 'b', 'c'], cycle).sort()).toEqual(
      ['a', 'b', 'c'].filter((id) => id !== first.id).sort(),
    );
    const rest = draw(['a', 'b', 'c'], 2, rand, cycle);
    expect(rest.reshuffles).toBe(0);
    expect(new Set([first.id, ...rest.ids]).size).toBe(3);
  });

  it('ignores duplicate ids in the pool', () => {
    const { ids, reshuffles } = draw(['a', 'a', 'b'], 2, seededRandomInt(9));
    expect(new Set(ids)).toEqual(new Set(['a', 'b']));
    expect(reshuffles).toBe(0);
  });

  it('picks whole records via pickNextLine', () => {
    const items = [{ id: 'x' }, { id: 'y' }];
    const rand = seededRandomInt(4);
    const one = pickNextLine(items, emptyCycle(), rand);
    const two = pickNextLine(items, one.cycle, rand);
    expect(one.item).not.toBeNull();
    expect(two.item).not.toBeNull();
    expect(one.item).not.toBe(two.item);
    expect(pickNextLine([], emptyCycle(), rand).item).toBeNull();
  });
});

/* ------------------------------------------------------------------------------------- *
 * 2. Hints
 * ------------------------------------------------------------------------------------- */

describe('drill hint', () => {
  it('returns the correct SAN at each ply of the line', () => {
    const line = resolved(RUY);
    let state = createDrill(line);
    for (let ply = 0; ply < line.sans.length; ply++) {
      const hint = drillHint(state);
      expect(hint.san).toBe(line.sans[ply]);
      expect(drillRevealedSan(hint.state)).toBe(line.sans[ply]);
      expect(drillRevealedSquares(hint.state)).toEqual(line.squares[ply]);
      // Step to the next ply however the ply is owned, so hints are checked on both sides.
      state =
        drillPhase(hint.state) === 'auto-reply'
          ? drillAutoPlay(hint.state)
          : drillAttempt(hint.state, sanAt(line, ply)).state;
    }
    expect(drillPhase(state)).toBe('complete');
    expect(drillHint(state).san).toBeNull();
  });

  it('counts a hint as failed and clears the reveal once the position changes', () => {
    const line = resolved(RUY);
    const hinted = drillHint(createDrill(line));
    expect(hinted.san).toBe('e4');
    expect(drillSummary(hinted.state).hintsUsed).toBe(1);

    const after = drillAttempt(hinted.state, 'e4');
    expect(after.outcome).toBe('advanced');
    expect(drillRevealedSan(after.state)).toBeNull();
    const summary = drillSummary(after.state);
    expect(summary.movesScored).toBe(1);
    expect(summary.movesCorrect).toBe(0);
    expect(summary.movesFailed).toBe(1);
    expect(summary.hintsUsed).toBe(1);
  });

  it('charges one hint however many times it is pressed at the same ply', () => {
    let state = createDrill(resolved(RUY));
    for (let i = 0; i < 4; i++) state = drillHint(state).state;
    expect(drillSummary(state).hintsUsed).toBe(1);
  });

  it('is a no-op at the end of the line', () => {
    const { state } = runCleanly(resolved(RUY));
    const hint = drillHint(state);
    expect(hint.san).toBeNull();
    expect(hint.state).toBe(state);
    expect(drillSummary(hint.state).hintsUsed).toBe(0);
  });
});

/* ------------------------------------------------------------------------------------- *
 * 3. The state machine
 * ------------------------------------------------------------------------------------- */

describe('drill state machine', () => {
  it('runs awaiting-user → auto-reply → complete for a line where the user moves first', () => {
    const line = resolved(RUY); // plies: user, opp, user, opp, user
    const { phases, state } = runCleanly(line);
    expect(phases).toEqual([
      'awaiting-user',
      'auto-reply',
      'awaiting-user',
      'auto-reply',
      'awaiting-user',
      'complete',
    ]);
    expect(drillFen(state)).toBe(line.fens[line.fens.length - 1]);
    expect(drillUserColor(state)).toBe('w');
    expect(drillOrientation(state)).toBe('white');
  });

  it('opens in auto-reply when the user moves second (userColor black)', () => {
    const line = resolved(RUY_AS_BLACK); // plies: opp, user, opp, user, opp
    const start = createDrill(line);
    expect(drillPhase(start)).toBe('auto-reply');
    expect(drillPendingAutoMove(start)).toBe('e4');
    expect(drillOrientation(start)).toBe('black');

    const { phases, state } = runCleanly(line);
    expect(phases).toEqual([
      'auto-reply',
      'awaiting-user',
      'auto-reply',
      'awaiting-user',
      'auto-reply',
      'complete',
    ]);
    expect(drillUserPlyCount(state)).toBe(2);
    expect(drillSummary(state).movesCorrect).toBe(2);
  });

  it('opens in auto-reply when the start FEN gives the first move to the opponent', () => {
    const line = resolved(FROM_BLACKS_TURN); // black to move, user trains as white
    const start = createDrill(line);
    expect(drillPhase(start)).toBe('auto-reply');
    expect(drillPendingAutoMove(start)).toBe('e5');
    expect(drillOrientation(start)).toBe('white');

    const { phases } = runCleanly(line);
    expect(phases).toEqual(['auto-reply', 'awaiting-user', 'auto-reply', 'complete']);
  });

  it('will not auto-play on the user’s turn, and will not accept a move on the opponent’s', () => {
    const line = resolved(RUY);
    const start = createDrill(line);
    expect(drillPendingAutoMove(start)).toBeNull();
    expect(drillAutoPlay(start)).toBe(start);

    const afterUser = drillAttempt(start, 'e4').state;
    expect(drillPhase(afterUser)).toBe('auto-reply');
    const refused = drillAttempt(afterUser, 'e5');
    expect(refused.outcome).toBe('not-your-turn');
    expect(refused.state).toBe(afterUser);
  });

  it('reports the user move number without revealing the line length', () => {
    const line = resolved(RUY);
    let state = createDrill(line);
    expect(drillUserPlyCount(state)).toBe(3);
    expect(drillUserMoveNumber(state)).toBe(1);
    state = drillAttempt(state, 'e4').state;
    state = drillAutoPlay(state);
    expect(drillUserMoveNumber(state)).toBe(2);
    const { state: finished } = runCleanly(line);
    expect(drillUserMoveNumber(finished)).toBe(3);
  });

  it('refuses a move once the line is complete', () => {
    const { state } = runCleanly(resolved(RUY));
    const result = drillAttempt(state, 'a3');
    expect(result.outcome).toBe('finished');
    expect(result.state).toBe(state);
  });

  it('treats an empty line as immediately complete', () => {
    const line = resolved({ startFen: START_FEN, moves: [], userColor: 'w' });
    const state = createDrill(line);
    expect(drillPhase(state)).toBe('complete');
    const summary = drillSummary(state);
    expect(summary).toMatchObject({ totalMoves: 0, movesCorrect: 0, complete: true });
  });
});

/* ------------------------------------------------------------------------------------- *
 * 4. Wrong moves
 * ------------------------------------------------------------------------------------- */

describe('drill wrong moves', () => {
  it('keeps the position, counts the failure, and lets the user retry', () => {
    const line = resolved(RUY);
    const start = createDrill(line);
    const before = drillFen(start);

    const wrong = drillAttempt(start, 'd4'); // legal, but not this line
    expect(wrong.outcome).toBe('wrong');
    expect(wrong.san).toBe('d4');
    expect(drillFen(wrong.state)).toBe(before);
    expect(drillPhase(wrong.state)).toBe('awaiting-user');
    expect(drillSummary(wrong.state).wrongAttempts).toBe(1);
    // The refused move is exposed for the error flash, WITHOUT the expected move.
    expect(drillRejected(wrong.state)).toEqual({ san: 'd4', from: 'd2', to: 'd4' });
    expect(Object.keys(drillRejected(wrong.state) ?? {}).sort()).toEqual(['from', 'san', 'to']);

    const again = drillAttempt(wrong.state, 'c4');
    expect(again.outcome).toBe('wrong');
    expect(drillFen(again.state)).toBe(before);
    expect(drillSummary(again.state).wrongAttempts).toBe(2);

    const right = drillAttempt(again.state, 'e4');
    expect(right.outcome).toBe('advanced');
    expect(drillFen(right.state)).toBe(line.fens[1]);
    expect(drillRejected(right.state)).toBeNull();
    // Two wrong attempts at one ply still cost exactly one move.
    expect(drillSummary(right.state)).toMatchObject({
      movesScored: 1,
      movesCorrect: 0,
      movesFailed: 1,
      wrongAttempts: 2,
    });
  });

  it('rejects an illegal move without counting it as a failure', () => {
    const state = createDrill(resolved(RUY));
    const result = drillAttempt(state, 'e5');
    expect(result.outcome).toBe('illegal');
    expect(result.state).toBe(state);
    expect(drillSummary(result.state).wrongAttempts).toBe(0);
  });
});

/* ------------------------------------------------------------------------------------- *
 * 5. The summary
 * ------------------------------------------------------------------------------------- */

describe('drill summary', () => {
  it('is perfect for a clean run', () => {
    const { state } = runCleanly(resolved(RUY));
    expect(drillSummary(state)).toEqual({
      movesScored: 3,
      totalMoves: 3,
      movesCorrect: 3,
      movesFailed: 0,
      hintsUsed: 0,
      wrongAttempts: 0,
      complete: true,
      perfect: true,
    });
    expect(drillSummaryLabel(drillSummary(state))).toBe('3 of 3 moves correct · 0 hints');
  });

  it('counts a run with wrong moves', () => {
    const line = resolved(RUY);
    let state = createDrill(line);
    // Ply 0: two wrong attempts then right. Ply 2: right first time. Ply 4: one wrong then right.
    state = drillAttempt(state, 'd4').state;
    state = drillAttempt(state, 'Nf3').state;
    state = drillAttempt(state, 'e4').state;
    state = drillAutoPlay(state);
    state = drillAttempt(state, 'Nf3').state;
    state = drillAutoPlay(state);
    state = drillAttempt(state, 'Bc4').state;
    state = drillAttempt(state, 'Bb5').state;

    expect(drillPhase(state)).toBe('complete');
    expect(drillSummary(state)).toEqual({
      movesScored: 3,
      totalMoves: 3,
      movesCorrect: 1,
      movesFailed: 2,
      hintsUsed: 0,
      wrongAttempts: 3,
      complete: true,
      perfect: false,
    });
    expect(drillSummaryLabel(drillSummary(state))).toBe('1 of 3 moves correct · 0 hints');
  });

  it('counts a run with hints', () => {
    const line = resolved(RUY);
    let state = createDrill(line);
    state = drillHint(state).state; // ply 0 given away
    state = drillAttempt(state, 'e4').state;
    state = drillAutoPlay(state);
    state = drillAttempt(state, 'Nf3').state; // ply 2 unaided
    state = drillAutoPlay(state);
    state = drillHint(state).state; // ply 4 given away
    state = drillAttempt(state, 'Bb5').state;

    expect(drillPhase(state)).toBe('complete');
    expect(drillSummary(state)).toEqual({
      movesScored: 3,
      totalMoves: 3,
      movesCorrect: 1,
      movesFailed: 2,
      hintsUsed: 2,
      wrongAttempts: 0,
      complete: true,
      perfect: false,
    });
    expect(drillSummaryLabel(drillSummary(state))).toBe('1 of 3 moves correct · 2 hints');
  });

  it('does not double-charge a ply that was both hinted and got wrong', () => {
    const line = resolved(RUY);
    let state = createDrill(line);
    state = drillAttempt(state, 'd4').state; // wrong
    state = drillHint(state).state; // then hinted — same ply
    state = drillAttempt(state, 'e4').state;
    expect(drillSummary(state)).toMatchObject({
      movesScored: 1,
      movesCorrect: 0,
      movesFailed: 1,
      hintsUsed: 1,
      wrongAttempts: 1,
    });
  });

  it('grows monotonically mid-line and only scores plies already played', () => {
    const line = resolved(RUY);
    let state = createDrill(line);
    expect(drillSummary(state)).toMatchObject({ movesScored: 0, complete: false, perfect: false });
    state = drillAttempt(state, 'e4').state;
    expect(drillSummary(state)).toMatchObject({ movesScored: 1, movesCorrect: 1, totalMoves: 3 });
    state = drillAutoPlay(state);
    // The auto-played opponent ply is not the user's, so it is not scored.
    expect(drillSummary(state)).toMatchObject({ movesScored: 1, movesCorrect: 1 });
  });

  it('pluralises the label for a one-move line and a single hint', () => {
    const line = resolved({ startFen: START_FEN, moves: ['e4'], userColor: 'w' });
    let state = createDrill(line);
    state = drillHint(state).state;
    state = drillAttempt(state, 'e4').state;
    expect(drillSummaryLabel(drillSummary(state))).toBe('0 of 1 move correct · 1 hint');
  });
});
