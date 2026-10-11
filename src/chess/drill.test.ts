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
  drillPly,
  drillRejected,
  drillRevealedSan,
  drillRevealedSquares,
  drillSummary,
  drillSummaryLabel,
  drillUserColor,
  drillUserMoveNumber,
  drillUserPlyCount,
  drillBranchLabel,
  drillItemKey,
  drillRevealedComment,
  emptyCycle,
  markServed,
  parseDrillItemKey,
  pickNextBranch,
  pickNextLine,
  pickNextLineId,
  remainingBranches,
  remainingInCycle,
  servedBranchesOf,
  type DrillCycle,
  type DrillItem,
  type DrillPoolEntry,
  type DrillPhase,
  type DrillState,
  type RandomInt,
} from './drill';
import { branchSpec, resolveLine, type LineSpec, type ResolvedLine } from './line';
import { START_FEN } from './position';
import type { MoveTree } from './tree';

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
): { ids: (string | null)[]; cycle: DrillCycle; exhaustions: number } {
  let cycle = start;
  let exhaustions = 0;
  const out: (string | null)[] = [];
  for (let i = 0; i < count; i++) {
    const pick = pickNextLineId(ids, cycle, rand);
    if (pick.exhausted) exhaustions++;
    cycle = pick.cycle;
    out.push(pick.id);
  }
  return { ids: out, cycle, exhaustions };
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
 * 1. The cycle — uniform random, every line at most once, then the drill is over
 * ------------------------------------------------------------------------------------- */

describe('drill cycle', () => {
  const POOL = ['a', 'b', 'c', 'd', 'e'];

  it('serves every line exactly once, in a random order', () => {
    for (const seed of [1, 7, 42, 1234, 99991]) {
      const { ids } = draw(POOL, POOL.length, seededRandomInt(seed));
      expect(new Set(ids).size).toBe(POOL.length);
      expect([...ids].sort()).toEqual([...POOL].sort());
    }
  });

  it('never repeats a line: once the pool is spent, every further draw is null', () => {
    const { ids, exhaustions } = draw(POOL, POOL.length + 3, seededRandomInt(5));
    expect(ids.slice(0, POOL.length)).not.toContain(null);
    // No second pass — the drill is over, and stays over.
    expect(ids.slice(POOL.length)).toEqual([null, null, null]);
    expect(exhaustions).toBe(3);
  });

  it('keeps the served list when it runs out, so the caller can report what was drilled', () => {
    const { cycle } = draw(POOL, POOL.length + 1, seededRandomInt(8));
    expect([...cycle.served].sort()).toEqual([...POOL].sort());
  });

  it('starts over only when the caller asks, with every line in play again', () => {
    const rand = seededRandomInt(13);
    draw(POOL, POOL.length + 2, rand);
    // A restart is `emptyCycle()`, not something a draw does by itself.
    const again = draw(POOL, POOL.length, rand, emptyCycle());
    expect([...again.ids].sort()).toEqual([...POOL].sort());
    expect(again.exhaustions).toBe(0);
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

  it('serves the single line of a one-line pool once, then is done', () => {
    const rand = seededRandomInt(3);
    const { ids, exhaustions } = draw(['only'], 3, rand);
    expect(ids).toEqual(['only', null, null]);
    expect(exhaustions).toBe(2);
  });

  it('returns null for an empty store and leaves the cycle empty', () => {
    const pick = pickNextLineId([], emptyCycle(), seededRandomInt(1));
    expect(pick.id).toBeNull();
    expect(pick.cycle.served).toEqual([]);
    expect(pick.exhausted).toBe(true);
  });

  it('never serves a line deleted mid-cycle, and does not let it hold the drill open', () => {
    const rand = seededRandomInt(11);
    // Serve two of three, then delete the one that is left.
    let cycle = emptyCycle();
    const served: (string | null)[] = [];
    for (let i = 0; i < 2; i++) {
      const pick = pickNextLineId(['a', 'b', 'c'], cycle, rand);
      cycle = pick.cycle;
      served.push(pick.id);
    }
    const [survivor] = ['a', 'b', 'c'].filter((id) => !served.includes(id));
    if (survivor === undefined) throw new Error('expected exactly one unserved line');

    // Every line the store still holds has been served, so the drill is over rather than stuck
    // waiting for a line that no longer exists.
    const shrunk = ['a', 'b', 'c'].filter((id) => id !== survivor);
    const next = pickNextLineId(shrunk, cycle, rand);
    expect(next.exhausted).toBe(true);
    expect(next.id).toBeNull();
    // The pruned cycle reports only lines that still exist.
    expect([...next.cycle.served].sort()).toEqual([...shrunk].sort());
  });

  it('lets a line added mid-cycle join the current cycle', () => {
    const rand = seededRandomInt(21);
    const first = pickNextLineId(['a', 'b'], emptyCycle(), rand);
    const cycle = first.cycle;
    expect(remainingInCycle(['a', 'b', 'c'], cycle).sort()).toEqual(
      ['a', 'b', 'c'].filter((id) => id !== first.id).sort(),
    );
    const rest = draw(['a', 'b', 'c'], 2, rand, cycle);
    expect(rest.exhaustions).toBe(0);
    expect(new Set([first.id, ...rest.ids]).size).toBe(3);
  });

  it('ignores duplicate ids in the pool', () => {
    const { ids, exhaustions } = draw(['a', 'a', 'b'], 2, seededRandomInt(9));
    expect(new Set(ids)).toEqual(new Set(['a', 'b']));
    expect(exhaustions).toBe(0);
  });

  it('picks whole records via pickNextLine', () => {
    const items = [{ id: 'x' }, { id: 'y' }];
    const rand = seededRandomInt(4);
    const one = pickNextLine(items, emptyCycle(), rand);
    const two = pickNextLine(items, one.cycle, rand);
    expect(one.item).not.toBeNull();
    expect(two.item).not.toBeNull();
    expect(one.item).not.toBe(two.item);
    expect(pickNextLine(items, two.cycle, rand)).toMatchObject({ item: null, exhausted: true });
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
      branch: 0,
      branchCount: 1,
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
      branch: 0,
      branchCount: 1,
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
      branch: 0,
      branchCount: 1,
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

/* ------------------------------------------------------------------------------------- *
 * 5. Branches — the cycle over branches (D5), switching on another repertoire move (D6),
 *    and the hint's comment
 * ------------------------------------------------------------------------------------- */

/**
 * White repertoire as a tree. Branches, in `branchesOf` order:
 *   0: e4 e5 Nf3 Nc6 Bb5     ("Develop" on Nf3)
 *   1: e4 e5 Bc4 Nf6 d3
 *   2: e4 e5 Bc4 Bc5 c3
 *   3: e4 e5 Nc3
 *   4: e4 c5 Nf3 d6
 *   5: e4 c5 c3
 */
const TREE: MoveTree = [
  {
    san: 'e4',
    next: [
      {
        san: 'e5',
        next: [
          {
            san: 'Nf3',
            comment: 'Develop',
            next: [{ san: 'Nc6', next: [{ san: 'Bb5', next: [] }] }],
          },
          {
            san: 'Bc4',
            next: [
              { san: 'Nf6', next: [{ san: 'd3', next: [] }] },
              { san: 'Bc5', next: [{ san: 'c3', next: [] }] },
            ],
          },
          { san: 'Nc3', next: [] },
        ],
      },
      {
        san: 'c5',
        next: [
          { san: 'Nf3', next: [{ san: 'd6', next: [] }] },
          { san: 'c3', next: [] },
        ],
      },
    ],
  },
];

function branchLine(branch: number): ResolvedLine {
  const spec = branchSpec({ startFen: START_FEN, tree: TREE, userColor: 'w' }, branch);
  if (spec === null) throw new Error(`no branch ${branch}`);
  return resolved(spec);
}

/** Drills branch `branch` of TREE up to the user's move at ply 2 (after 1.e4 e5 / 1.e4 c5). */
function atSecondMove(branch: number, served: number[] = []): DrillState {
  let state = createDrill(branchLine(branch), { tree: TREE, branch, served });
  state = drillAttempt(state, 'e4').state;
  state = drillAutoPlay(state);
  expect(drillPhase(state)).toBe('awaiting-user');
  return state;
}

/** Draws until exhausted (bounded), threading the cycle and passing the last line as current. */
function drawBranches(pool: DrillPoolEntry[], rand: RandomInt): DrillItem[] {
  let cycle = emptyCycle();
  let current: string | null = null;
  const out: DrillItem[] = [];
  for (let guard = 0; guard < 100; guard++) {
    const pick = pickNextBranch(pool, cycle, current, rand);
    cycle = pick.cycle;
    if (pick.item === null) {
      expect(pick.exhausted).toBe(true);
      return out;
    }
    out.push(pick.item);
    current = pick.item.lineId;
  }
  throw new Error('never exhausted');
}

describe('drill branch cycle', () => {
  const POOL: DrillPoolEntry[] = [
    { id: 'a', branches: 3 },
    { id: 'b', branches: 2 },
    { id: 'c', branches: 1 },
  ];

  it('keys a branch as lineId#branch and parses it back', () => {
    expect(drillItemKey({ lineId: 'abc', branch: 2 })).toBe('abc#2');
    expect(parseDrillItemKey('abc#2')).toEqual({ lineId: 'abc', branch: 2 });
    expect(parseDrillItemKey('abc')).toBeNull();
    expect(parseDrillItemKey('#1')).toBeNull();
    expect(parseDrillItemKey('abc#x')).toBeNull();
    expect(parseDrillItemKey('abc#-1')).toBeNull();
  });

  it('serves every branch of a line before moving on to another line', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const items = drawBranches(POOL, seededRandomInt(seed));
      const lines = items.map((item) => item.lineId);
      // Each line's branches come in one contiguous run.
      const runs = lines.filter((id, i) => i === 0 || lines[i - 1] !== id);
      expect(runs.sort()).toEqual(['a', 'b', 'c']);
    }
  });

  it('exhausts after every branch of every line came up exactly once', () => {
    const items = drawBranches(POOL, seededRandomInt(7));
    expect(items.map(drillItemKey).sort()).toEqual(['a#0', 'a#1', 'a#2', 'b#0', 'b#1', 'c#0']);
  });

  it('serves every branch of a single-line pool, then is done', () => {
    const items = drawBranches([{ id: 'only', branches: 4 }], seededRandomInt(3));
    expect(items.map((item) => item.branch).sort()).toEqual([0, 1, 2, 3]);
    expect(new Set(items.map((item) => item.lineId))).toEqual(new Set(['only']));
  });

  it('picks the branch with the injected index, and clamps a bad one', () => {
    expect(pickNextBranch(POOL, { served: ['a#0'] }, 'a', () => 1).item).toEqual({
      lineId: 'a',
      branch: 2,
    });
    expect(pickNextBranch(POOL, emptyCycle(), null, () => 99).item).toEqual({
      lineId: 'c',
      branch: 0,
    });
    expect(pickNextBranch(POOL, emptyCycle(), null, () => Number.NaN).item).toEqual({
      lineId: 'a',
      branch: 0,
    });
  });

  it('moves to a random other line when the current one is spent', () => {
    const cycle: DrillCycle = { served: ['b#0', 'b#1'] };
    const pick = pickNextBranch(POOL, cycle, 'b', () => 0);
    expect(pick.item).toEqual({ lineId: 'a', branch: 0 });
    expect(pick.cycle.served).toEqual(['b#0', 'b#1', 'a#0']);
  });

  it('returns exhausted for an empty pool', () => {
    expect(pickNextBranch([], emptyCycle(), null, () => 0)).toEqual({
      item: null,
      cycle: emptyCycle(),
      exhausted: true,
    });
  });

  it('prunes served keys of deleted lines and removed branches', () => {
    const cycle: DrillCycle = { served: ['gone#0', 'a#2', 'a#0', 'junk'] };
    // Line `a` lost its third branch; `gone` was deleted.
    const pool: DrillPoolEntry[] = [{ id: 'a', branches: 2 }];
    const pick = pickNextBranch(pool, cycle, 'a', () => 0);
    expect(pick.item).toEqual({ lineId: 'a', branch: 1 });
    expect(pick.cycle.served).toEqual(['a#0', 'a#1']);
    expect(pickNextBranch(pool, pick.cycle, 'a', () => 0)).toMatchObject({
      item: null,
      exhausted: true,
    });
  });

  it('treats a bogus branch count as one branch and ignores duplicate ids', () => {
    const pool: DrillPoolEntry[] = [
      { id: 'a', branches: 0 },
      { id: 'a', branches: 5 },
      { id: 'b', branches: Number.NaN },
    ];
    expect(remainingBranches(pool, emptyCycle()).map(drillItemKey)).toEqual(['a#0', 'b#0']);
  });

  it('reports what is left, and which branches of a line are spent', () => {
    const cycle = markServed(markServed(emptyCycle(), { lineId: 'a', branch: 2 }), {
      lineId: 'b',
      branch: 0,
    });
    expect(markServed(cycle, { lineId: 'a', branch: 2 })).toBe(cycle);
    expect(remainingBranches(POOL, cycle).map(drillItemKey)).toEqual(['a#0', 'a#1', 'b#1', 'c#0']);
    expect(servedBranchesOf(cycle, 'a')).toEqual([2]);
    expect(servedBranchesOf(cycle, 'c')).toEqual([]);
  });
});

describe('drill branch switching (D6)', () => {
  it('accepts another repertoire move and switches to an unserved branch through it', () => {
    const state = atSecondMove(0, [0, 1]);
    const result = drillAttempt(state, 'Bc4');
    expect(result.outcome).toBe('branched');
    expect(result.san).toBe('Bc4');
    // Branch 1 (Bc4 Nf6) is served, so the run takes branch 2 (Bc4 Bc5).
    expect(result.state.branch).toBe(2);
    expect(result.state.servedBranches).toEqual([0, 1, 2]);
    expect(drillPly(result.state)).toBe(3);
    expect(drillRejected(result.state)).toBeNull();
    expect(drillPendingAutoMove(result.state)).toBe('Bc5');

    let after = drillAutoPlay(result.state);
    after = drillAttempt(after, 'c3').state;
    expect(drillPhase(after)).toBe('complete');
    const summary = drillSummary(after);
    expect(summary).toMatchObject({ branch: 2, branchCount: 6, perfect: true, totalMoves: 3 });
    expect(drillBranchLabel(summary)).toBe('Branch 3 of 6');
  });

  it('takes the first branch through the move when only that one is unserved, or all are served', () => {
    expect(drillAttempt(atSecondMove(0, [0]), 'Bc4').state.branch).toBe(1);
    expect(drillAttempt(atSecondMove(0, [0, 1, 2]), 'Bc4').state.branch).toBe(1);
    expect(drillAttempt(atSecondMove(0, [0, 2]), 'Bc4').state.branch).toBe(1);
    expect(drillAttempt(atSecondMove(0, [0]), 'Nc3').state.branch).toBe(3);
  });

  it('keeps earlier failures and counters across the switch', () => {
    let state = atSecondMove(0);
    const wrong = drillAttempt(state, 'd4');
    expect(wrong.outcome).toBe('wrong');
    state = drillAttempt(wrong.state, 'Nc3').state;
    expect(state.branch).toBe(3);
    expect(drillPhase(state)).toBe('complete');
    expect(drillSummary(state)).toMatchObject({
      movesScored: 2,
      movesFailed: 1,
      wrongAttempts: 1,
      branch: 3,
    });
  });

  it('accepts the alternative after a hint, still charging the hint', () => {
    let state = drillHint(atSecondMove(0)).state;
    expect(drillRevealedSan(state)).toBe('Nf3');
    const result = drillAttempt(state, 'Bc4');
    expect(result.outcome).toBe('branched');
    state = result.state;
    expect(drillRevealedSan(state)).toBeNull();
    expect(drillSummary(state)).toMatchObject({ hintsUsed: 1, movesFailed: 1 });
  });

  it('still refuses a move that is not in the repertoire', () => {
    const state = atSecondMove(0);
    const result = drillAttempt(state, 'd4');
    expect(result.outcome).toBe('wrong');
    expect(result.state.branch).toBe(0);
    expect(drillRejected(result.state)).toMatchObject({ san: 'd4' });
  });

  it('does not switch to a move from another part of the tree', () => {
    // 2.c3 exists only after 1...c5; after 1...e5 it is just wrong.
    expect(drillAttempt(atSecondMove(0), 'c3').outcome).toBe('wrong');
  });

  it('never switches without a tree (a bare linear line)', () => {
    let state = createDrill(branchLine(0));
    state = drillAutoPlay(drillAttempt(state, 'e4').state);
    expect(drillAttempt(state, 'Bc4').outcome).toBe('wrong');
    expect(drillSummary(state)).toMatchObject({ branch: 0, branchCount: 1 });
    expect(drillBranchLabel(drillSummary(state))).toBeNull();
  });

  it('starts on the requested branch and counts it as served', () => {
    const state = createDrill(branchLine(4), { tree: TREE, branch: 4, served: [5, 99] });
    expect(state).toMatchObject({ branch: 4, branchCount: 6, servedBranches: [4, 5] });
  });
});

describe('drill hint comment', () => {
  it('carries the comment of the revealed move', () => {
    const state = atSecondMove(0);
    const hint = drillHint(state);
    expect(hint).toMatchObject({ san: 'Nf3', comment: 'Develop' });
    expect(drillRevealedComment(hint.state)).toBe('Develop');
    // Pressing again at the same ply still reports it.
    expect(drillHint(hint.state).comment).toBe('Develop');
  });

  it('is null for a move with no comment, and while no hint is showing', () => {
    const start = createDrill(branchLine(0), { tree: TREE, branch: 0 });
    expect(drillRevealedComment(start)).toBeNull();
    const hint = drillHint(start);
    expect(hint).toMatchObject({ san: 'e4', comment: null });
    expect(drillRevealedComment(hint.state)).toBeNull();
    // The comment is there before the hint — but it is only surfaced through one.
    expect(drillRevealedComment(atSecondMove(0))).toBeNull();
  });

  it('is null at the end of the line', () => {
    const { state } = runCleanly(resolved(RUY));
    expect(drillHint(state).comment).toBeNull();
  });
});
