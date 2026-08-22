import { describe, expect, it } from 'vitest';
import {
  WIN_PROB_MAX,
  WIN_PROB_MIN,
  formatScore,
  parseUciLine,
  winProbability,
} from './uci';
import type { UciEvent } from './uci';

/** Narrows to an `info` event, failing the test with a readable message otherwise. */
function info(event: UciEvent) {
  if (event.kind !== 'info') throw new Error(`expected an info event, got '${event.kind}'`);
  return event;
}

// A real line, copied from `stockfish-18-lite-single` output.
const REAL_INFO =
  'info depth 20 seldepth 28 multipv 1 score cp 34 nodes 1795236 nps 986393 hashfull 419 ' +
  'tbhits 0 time 1820 pv e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6';

describe('parseUciLine — handshake and bestmove', () => {
  it('recognises uciok and readyok', () => {
    expect(parseUciLine('uciok', 'w')).toEqual({ kind: 'uciok' });
    expect(parseUciLine('  readyok  ', 'w')).toEqual({ kind: 'readyok' });
  });

  it('parses bestmove with and without a ponder move', () => {
    expect(parseUciLine('bestmove e2e4 ponder e7e5', 'w')).toEqual({
      kind: 'bestmove',
      move: 'e2e4',
      ponder: 'e7e5',
    });
    expect(parseUciLine('bestmove g1f3', 'b')).toEqual({ kind: 'bestmove', move: 'g1f3' });
    expect(parseUciLine('bestmove (none)', 'w')).toEqual({ kind: 'bestmove', move: '(none)' });
  });

  it('does not confuse engine banners with events', () => {
    const event = parseUciLine('Stockfish 18 by the Stockfish developers', 'w');
    expect(event.kind).toBe('other');
  });
});

describe('parseUciLine — a representative info line', () => {
  it('extracts every EngineLine field', () => {
    const { line, nps } = info(parseUciLine(REAL_INFO, 'w'));
    expect(line).toEqual({
      multipv: 1,
      depth: 20,
      cp: 34,
      mate: null,
      pv: ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3', 'a7a6'],
    });
    expect(nps).toBe(986393);
  });

  it('keeps seldepth out of depth', () => {
    const { line } = info(parseUciLine('info depth 7 seldepth 19 score cp 12 pv e2e4', 'w'));
    expect(line.depth).toBe(7);
  });

  it('reads multipv slots 2 and 3', () => {
    const second = info(
      parseUciLine('info depth 18 multipv 2 score cp -12 pv d2d4 g8f6', 'w'),
    ).line;
    const third = info(parseUciLine('info depth 18 multipv 3 score cp -40 pv c2c4', 'w')).line;
    expect([second.multipv, third.multipv]).toEqual([2, 3]);
    expect([second.cp, third.cp]).toEqual([-12, -40]);
  });

  it('keeps the score of lowerbound / upperbound reports and still reads the pv', () => {
    const lower = info(
      parseUciLine('info depth 14 multipv 1 score cp 88 lowerbound nps 900 pv e2e4', 'w'),
    );
    expect(lower.line.cp).toBe(88);
    expect(lower.line.pv).toEqual(['e2e4']);
    expect(lower.nps).toBe(900);

    const upper = info(parseUciLine('info depth 14 score cp -50 upperbound pv d2d4', 'w'));
    expect(upper.line.cp).toBe(-50);
    expect(upper.line.pv).toEqual(['d2d4']);
  });

  it('keeps promotion moves in the pv and drops non-move tokens', () => {
    const { line } = info(parseUciLine('info depth 5 score cp 10 pv a7a8q b1c3 zzz', 'w'));
    expect(line.pv).toEqual(['a7a8q', 'b1c3']);
  });

  it('ignores info lines that carry no score', () => {
    expect(parseUciLine('info depth 1 seldepth 1 currmove e2e4 currmovenumber 1', 'w').kind).toBe(
      'other',
    );
    expect(parseUciLine('info string NNUE evaluation using nn-9067e33176e8.nnue', 'w').kind).toBe(
      'other',
    );
    expect(parseUciLine('info nodes 12000 nps 60000 time 200 hashfull 0', 'w').kind).toBe('other');
  });
});

describe('parseUciLine — White-perspective sign normalisation (README §8.1)', () => {
  const line = 'info depth 18 multipv 1 score cp 120 pv e2e4';

  it('leaves a White-to-move score untouched', () => {
    expect(info(parseUciLine(line, 'w')).line.cp).toBe(120);
  });

  it('negates a Black-to-move score', () => {
    // "+120 for the side to move" with Black to move means White is 120 cp DOWN.
    expect(info(parseUciLine(line, 'b')).line.cp).toBe(-120);
  });

  it('negates a losing Black-to-move score into a White advantage', () => {
    const raw = 'info depth 18 multipv 1 score cp -250 pv e7e5';
    expect(info(parseUciLine(raw, 'w')).line.cp).toBe(-250);
    expect(info(parseUciLine(raw, 'b')).line.cp).toBe(250);
  });

  it('normalises a zero score without producing -0', () => {
    const { line: zero } = info(parseUciLine('info depth 9 score cp 0 pv e2e4', 'b'));
    expect(zero.cp).toBe(0);
    expect(Object.is(zero.cp, -0)).toBe(false);
  });

  it('is symmetric: flipping the side to move flips the sign of every score', () => {
    for (const cp of [-900, -75, -1, 0, 1, 75, 900]) {
      const raw = `info depth 12 score cp ${cp} pv e2e4`;
      const white = info(parseUciLine(raw, 'w')).line.cp ?? 0;
      const black = info(parseUciLine(raw, 'b')).line.cp ?? 0;
      expect(black).toBe(cp === 0 ? 0 : -white);
    }
  });
});

describe('parseUciLine — mate scores', () => {
  it('parses a positive mate for White to move', () => {
    const { line } = info(parseUciLine('info depth 30 multipv 1 score mate 5 pv d1h5', 'w'));
    expect(line.mate).toBe(5);
    expect(line.cp).toBeNull();
  });

  it('flips a positive mate for Black to move (Black mates ⇒ negative for White)', () => {
    const { line } = info(parseUciLine('info depth 30 multipv 1 score mate 3 pv d8h4', 'b'));
    expect(line.mate).toBe(-3);
  });

  it('parses a negative mate (getting mated) for both sides to move', () => {
    // White to move and getting mated in 2 ⇒ White-negative.
    expect(info(parseUciLine('info depth 20 score mate -2 pv e1e2', 'w')).line.mate).toBe(-2);
    // Black to move and getting mated in 2 ⇒ White mates ⇒ White-positive.
    expect(info(parseUciLine('info depth 20 score mate -2 pv e8e7', 'b')).line.mate).toBe(2);
  });

  it('never reports both cp and mate', () => {
    const mated = info(parseUciLine('info depth 20 score mate -1 pv e1e2', 'w')).line;
    expect(mated.cp).toBeNull();
    const cp = info(parseUciLine('info depth 20 score cp 5 pv e1e2', 'w')).line;
    expect(cp.mate).toBeNull();
  });

  it('normalises mate 0 without producing -0', () => {
    const { line } = info(parseUciLine('info depth 1 score mate 0', 'b'));
    expect(line.mate).toBe(0);
    expect(Object.is(line.mate, -0)).toBe(false);
  });
});

describe('parseUciLine — malformed input is ignored, never thrown', () => {
  const junk = [
    '',
    '   ',
    '\n',
    'info',
    'info depth',
    'info depth score cp',
    'info score',
    'info score cp',
    'info score cp abc pv e2e4',
    'info score mate pv e2e4',
    'info depth twenty score cp 30 pv e2e4',
    'info multipv score cp 10 pv e2e4',
    'bestmove',
    'best move e2e4',
    'uciok extra tokens',
    '}{!@#$%^&*',
    'info depth 20 score cp 30 pv',
    'infodepth 20 score cp 30',
  ];

  it('returns "other" (or a still-valid event) and never throws', () => {
    for (const raw of junk) {
      expect(() => parseUciLine(raw, 'w')).not.toThrow();
      expect(() => parseUciLine(raw, 'b')).not.toThrow();
    }
  });

  it('treats an unparseable score as no score at all', () => {
    expect(parseUciLine('info score cp abc pv e2e4', 'w').kind).toBe('other');
    expect(parseUciLine('info score mate pv e2e4', 'w').kind).toBe('other');
  });

  it('survives a truncated line that ends mid-key', () => {
    const { line } = info(parseUciLine('info depth 20 score cp 30 pv', 'w'));
    expect(line.pv).toEqual([]);
    expect(line.cp).toBe(30);
  });

  it('recovers depth even when an earlier value is garbage', () => {
    const { line } = info(parseUciLine('info depth twenty score cp 30 pv e2e4', 'w'));
    expect(line.depth).toBe(0);
    expect(line.cp).toBe(30);
  });

  it('tolerates non-string input', () => {
    // Deliberately breaking the type contract: worker messages come from outside TypeScript.
    const raw = undefined as unknown as string;
    expect(() => parseUciLine(raw, 'w')).not.toThrow();
    expect(parseUciLine(raw, 'w').kind).toBe('other');
  });
});

describe('winProbability', () => {
  it('is 0.5 at a dead-level score and when there is no score', () => {
    expect(winProbability(0, null)).toBeCloseTo(0.5, 10);
    expect(winProbability(null, null)).toBe(0.5);
  });

  it('matches the specified sigmoid', () => {
    expect(winProbability(400, null)).toBeCloseTo(10 / 11, 10);
    expect(winProbability(-400, null)).toBeCloseTo(1 / 11, 10);
  });

  it('is monotonically increasing in cp', () => {
    const samples = [-5000, -1200, -400, -100, -25, 0, 25, 100, 400, 1200, 5000];
    const probs = samples.map((cp) => winProbability(cp, null));
    for (let i = 1; i < probs.length; i += 1) {
      expect(probs[i]!).toBeGreaterThanOrEqual(probs[i - 1]!);
    }
    // Strictly increasing inside the clamped band.
    expect(winProbability(100, null)).toBeGreaterThan(winProbability(25, null));
  });

  it('clamps so the bar never empties or fills completely', () => {
    for (const cp of [-100000, -10000, -3000, 3000, 10000, 100000]) {
      const p = winProbability(cp, null);
      expect(p).toBeGreaterThanOrEqual(WIN_PROB_MIN);
      expect(p).toBeLessThanOrEqual(WIN_PROB_MAX);
    }
    expect(winProbability(-100000, null)).toBe(WIN_PROB_MIN);
    expect(winProbability(100000, null)).toBe(WIN_PROB_MAX);
  });

  it('pins mate to the clamp bounds and ignores cp when mate is present', () => {
    expect(winProbability(null, 3)).toBe(WIN_PROB_MAX);
    expect(winProbability(null, -3)).toBe(WIN_PROB_MIN);
    expect(winProbability(-2000, 1)).toBe(WIN_PROB_MAX);
  });

  it('does not produce NaN for non-finite input', () => {
    // Non-finite input is treated as "no score", not as an infinite advantage.
    expect(winProbability(Number.NaN, null)).toBe(0.5);
    expect(winProbability(Number.POSITIVE_INFINITY, null)).toBe(0.5);
    expect(winProbability(0, Number.NaN)).toBeCloseTo(0.5, 10);
  });
});

describe('formatScore', () => {
  it('formats centipawns as signed pawns with two decimals', () => {
    expect(formatScore(124, null)).toBe('+1.24');
    expect(formatScore(-31, null)).toBe('-0.31');
    expect(formatScore(0, null)).toBe('+0.00');
    expect(formatScore(1250, null)).toBe('+12.50');
    expect(formatScore(-5, null)).toBe('-0.05');
  });

  it('formats mate scores with a hash and keeps the sign', () => {
    expect(formatScore(null, 5)).toBe('#5');
    expect(formatScore(null, -3)).toBe('#-3');
    expect(formatScore(null, 1)).toBe('#1');
  });

  it('prefers mate over cp and has a placeholder for no score', () => {
    expect(formatScore(30, 2)).toBe('#2');
    expect(formatScore(null, null)).toBe('—');
  });

  it('round-trips a parsed line into a display string', () => {
    const { line } = info(parseUciLine(REAL_INFO, 'b'));
    expect(formatScore(line.cp, line.mate)).toBe('-0.34');
  });
});
