import { describe, expect, it } from 'vitest';
import type { Line } from '../../../storage/schema';
import { START_FEN } from '../../../chess/position';
import { favouriteToggleLabel, folderPersonalStatus } from './personalStatus';

function makeLine(id: string): Line {
  return {
    id,
    name: id,
    startFen: START_FEN,
    tree: [],
    userColor: 'w',
    createdAt: 1_000,
    updatedAt: 2_000,
  };
}

describe('folderPersonalStatus', () => {
  const lines = [makeLine('a'), makeLine('b'), makeLine('c')];

  it('is none for an empty folder, even with personal ids around', () => {
    expect(folderPersonalStatus([], new Set())).toBe('none');
    expect(folderPersonalStatus([], new Set(['a']))).toBe('none');
  });

  it('is none when no line is personal', () => {
    expect(folderPersonalStatus(lines, new Set())).toBe('none');
    expect(folderPersonalStatus(lines, new Set(['elsewhere']))).toBe('none');
  });

  it('is some when only part of the folder is personal', () => {
    expect(folderPersonalStatus(lines, new Set(['a']))).toBe('some');
    expect(folderPersonalStatus(lines, new Set(['a', 'c', 'elsewhere']))).toBe('some');
  });

  it('is all when every line is personal, ignoring ids from other folders', () => {
    expect(folderPersonalStatus(lines, new Set(['a', 'b', 'c']))).toBe('all');
    expect(folderPersonalStatus(lines, new Set(['a', 'b', 'c', 'elsewhere']))).toBe('all');
  });
});

describe('favouriteToggleLabel', () => {
  it('says what pressing the star does', () => {
    expect(favouriteToggleLabel(false)).toBe('Add to favourites');
    expect(favouriteToggleLabel(true)).toBe('Remove from favourites');
  });
});
