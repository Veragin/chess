import { describe, expect, it } from 'vitest';
import { fenAfter } from './game';
import { START_FEN } from './position';
import { normaliseThreats, threatFen, threatMarks, threatSan } from './threats';

const after = (moves: string[]): string => fenAfter(START_FEN, moves) as string;

describe('threatFen', () => {
  it('hands the turn back and clears en passant', () => {
    expect(threatFen(after(['e4']))).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1');
  });

  it('is null when the side to move is in check', () => {
    expect(threatFen(after(['e4', 'f5', 'Qh5+']))).toBeNull();
  });
});

describe('threatSan', () => {
  it("is the threatening side's SAN of a move played after its turn is handed back", () => {
    const fen = after(['e4', 'e5', 'Bc4', 'Nc6']);
    expect(threatSan(after(['e4', 'e5', 'Bc4']), { from: 'd1', to: 'h5' })).toBe('Qh5');
    expect(threatSan(fen, { from: 'd8', to: 'h4' })).toBe('Qh4');
    expect(threatSan(fen, { from: 'd1', to: 'd5' })).toBeNull();
  });
});

describe('threatMarks', () => {
  const fen = after(['e4', 'e5', 'Bc4']);

  it("places SAN threats of the side that just moved, of the side to move, and coordinates", () => {
    expect(threatMarks(fen, ['Bxf7+', 'Nf6', 'g1f3'])).toEqual([
      { move: 'Bxf7+', from: 'c4', to: 'f7' },
      { move: 'Nf6', from: 'g8', to: 'f6' },
      { move: 'g1f3', from: 'g1', to: 'f3' },
    ]);
  });

  it('skips what makes no sense and repeats of the same squares', () => {
    expect(threatMarks(fen, ['Qxd8', '', 'c4f7', 'Bxf7+'])).toEqual([
      { move: 'c4f7', from: 'c4', to: 'f7' },
    ]);
    expect(threatMarks(fen, undefined)).toEqual([]);
  });
});

describe('normaliseThreats', () => {
  it('trims, drops blanks and repeats, and is undefined when nothing is left', () => {
    expect(normaliseThreats([' Qh5 ', '', 'Qh5', 'Bxf7+'])).toEqual(['Qh5', 'Bxf7+']);
    expect(normaliseThreats(['  '])).toBeUndefined();
    expect(normaliseThreats(undefined)).toBeUndefined();
  });
});
