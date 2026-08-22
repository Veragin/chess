import { describe, expect, it } from 'vitest';
import { START_FEN } from '../../../chess/position';
import type { Line } from '../../../storage/schema';
import {
  colorLabel,
  describeLine,
  exportFileName,
  filterLines,
  folderCountLabel,
  formatTimestamp,
  isStandardStart,
  lineCountLabel,
  moveCountLabel,
  normaliseQuery,
  startPositionLabel,
  subfolderCountLabel,
} from './lineFormat';

function line(partial: Partial<Line>): Line {
  return {
    id: 'x',
    name: 'Line',
    startFen: START_FEN,
    moves: ['e4'],
    userColor: 'w',
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

describe('normaliseQuery', () => {
  it('lowercases, trims and collapses whitespace', () => {
    expect(normaliseQuery('  Ruy   LOPEZ ')).toBe('ruy lopez');
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(normaliseQuery('   ')).toBe('');
  });
});

describe('filterLines', () => {
  const lines = [
    line({ id: 'a', name: 'Najdorf main line' }),
    line({ id: 'b', name: 'French Winawer' }),
    line({ id: 'c', name: 'najdorf sideline' }),
  ];

  it('returns every line for an empty query', () => {
    expect(filterLines(lines, '   ').map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('matches case-insensitively on a substring of the name, preserving order', () => {
    expect(filterLines(lines, 'NAJ').map((l) => l.id)).toEqual(['a', 'c']);
  });

  it('collapses whitespace in the query so "main   line" still matches', () => {
    expect(filterLines(lines, ' main   line ').map((l) => l.id)).toEqual(['a']);
  });

  it('returns nothing when no name matches', () => {
    expect(filterLines(lines, 'sicilian')).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const copy = [...lines];
    filterLines(lines, '');
    expect(lines).toEqual(copy);
  });

  it('ignores notes — only the name is searched', () => {
    const withNotes = [line({ id: 'a', name: 'Alpha', notes: 'beta gamma' })];
    expect(filterLines(withNotes, 'beta')).toEqual([]);
  });
});

describe('isStandardStart / startPositionLabel', () => {
  it('recognises the standard start position', () => {
    expect(isStandardStart(START_FEN)).toBe(true);
    expect(startPositionLabel(START_FEN)).toBe('Standard start position');
  });

  it('ignores the halfmove/fullmove clocks', () => {
    expect(isStandardStart('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 3 7')).toBe(true);
  });

  it('treats a different position as custom and shows its FEN', () => {
    const fen = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
    expect(isStandardStart(fen)).toBe(false);
    expect(startPositionLabel(` ${fen} `)).toBe(fen);
  });
});

describe('labels', () => {
  it('names the trained-as colour', () => {
    expect(colorLabel('w')).toBe('White');
    expect(colorLabel('b')).toBe('Black');
  });

  it('pluralises the move count and handles zero', () => {
    expect(moveCountLabel(0)).toBe('no moves');
    expect(moveCountLabel(1)).toBe('1 move');
    expect(moveCountLabel(11)).toBe('11 moves');
    expect(moveCountLabel(-2)).toBe('no moves');
  });

  it('summarises a line for a screen reader', () => {
    expect(describeLine(line({ name: 'Najdorf', moves: ['e4', 'c5'], userColor: 'b' }))).toBe(
      'Najdorf, 2 moves, trained as Black',
    );
  });

  it('falls back to "Untitled line" for a blank name', () => {
    expect(describeLine(line({ name: '  ' }))).toContain('Untitled line');
  });
});

describe('formatTimestamp', () => {
  it('formats a timestamp as a sortable local date and time', () => {
    const ms = new Date(2026, 7, 22, 14, 5).getTime();
    expect(formatTimestamp(ms)).toBe('2026-08-22 14:05');
  });

  it('reports a missing timestamp rather than 1970', () => {
    expect(formatTimestamp(0)).toBe('never');
    expect(formatTimestamp(Number.NaN)).toBe('never');
  });
});

describe('exportFileName', () => {
  it('dates the export file', () => {
    expect(exportFileName(new Date(2026, 0, 9, 3, 4).getTime())).toBe('chess-lines-2026-01-09.json');
  });
});

describe('folder labels', () => {
  it('counts lines and subfolders in words', () => {
    expect(lineCountLabel(0)).toBe('no lines');
    expect(lineCountLabel(1)).toBe('1 line');
    expect(lineCountLabel(12)).toBe('12 lines');
    expect(subfolderCountLabel(0)).toBe('no subfolders');
    expect(subfolderCountLabel(1)).toBe('1 subfolder');
    expect(subfolderCountLabel(3)).toBe('3 subfolders');
  });

  it('mentions the subtree only when it holds more than this folder does', () => {
    expect(folderCountLabel(3, 3)).toBe('3 lines');
    expect(folderCountLabel(0, 0)).toBe('no lines');
    expect(folderCountLabel(3, 7)).toBe('3 lines · 7 including subfolders');
    expect(folderCountLabel(0, 4)).toBe('no lines · 4 including subfolders');
  });
});
