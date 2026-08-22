import { describe, expect, it } from 'vitest';
import { drillPath, editLinePath, linesPath, newLinePath, playLinePath } from './folderNav';

describe('folder URLs', () => {
  it('spells the root as no parameter at all, so each folder has one URL', () => {
    expect(linesPath('')).toBe('/training');
    expect(linesPath('   ')).toBe('/training');
    expect(linesPath('//')).toBe('/training');
    expect(drillPath('')).toBe('/training/drill');
    expect(newLinePath('')).toBe('/training/new');
  });

  it('carries the folder as a query parameter', () => {
    expect(linesPath('White')).toBe('/training?folder=White');
    expect(drillPath('White')).toBe('/training/drill?folder=White');
    expect(newLinePath('White')).toBe('/training/new?folder=White');
    expect(editLinePath('abc', 'White')).toBe('/training/abc/edit?folder=White');
    expect(playLinePath('abc', 'White')).toBe('/training/abc/play?folder=White');
  });

  it('normalises before encoding, so one folder never gets two URLs', () => {
    expect(linesPath(' Black / Sicilian ')).toBe(linesPath('Black/Sicilian'));
  });

  it('encodes separators and anything else that would break the URL', () => {
    expect(linesPath('Black/Sicilian')).toBe('/training?folder=Black%2FSicilian');
    expect(linesPath('Caro-Kann & co')).toBe('/training?folder=Caro-Kann%20%26%20co');
    expect(decodeURIComponent(linesPath('a?b#c').split('folder=')[1] as string)).toBe('a?b#c');
  });
});
