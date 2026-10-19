import { describe, expect, it } from 'vitest';
import {
  drillLinePath,
  drillPath,
  editLinePath,
  explorePath,
  linesPath,
  newLineFromAnalyzePath,
  newLineFromExplorePath,
  newLinePath,
  parseLineSet,
  parseTrainedFor,
} from './folderNav';

describe('folder URLs', () => {
  it('spells the root as no parameter at all, so each folder has one URL', () => {
    expect(linesPath('')).toBe('/training');
    expect(linesPath('   ')).toBe('/training');
    expect(linesPath('//')).toBe('/training');
    expect(drillPath('')).toBe('/training/drill');
    expect(newLinePath('')).toBe('/training/new');
    expect(explorePath('')).toBe('/training/explore');
  });

  it('carries the folder as a query parameter', () => {
    expect(linesPath('White')).toBe('/training?folder=White');
    expect(drillPath('White')).toBe('/training/drill?folder=White');
    expect(newLinePath('White')).toBe('/training/new?folder=White');
    expect(editLinePath('abc', 'White')).toBe('/training/abc/edit?folder=White');
    expect(explorePath('White')).toBe('/training/explore?folder=White');
  });

  it('marks the explore hand-off in the URL, with or without a folder', () => {
    // The moves live in `state/newLine.ts`; only the intent travels in the URL.
    expect(newLineFromExplorePath('')).toBe('/training/new?from=explore');
    expect(newLineFromExplorePath('Black/Sicilian')).toBe(
      '/training/new?folder=Black%2FSicilian&from=explore',
    );
  });

  it('marks the analyse hand-off with its own intent', () => {
    // Analysis has no folder scope, so it always hands over at the root.
    expect(newLineFromAnalyzePath('')).toBe('/training/new?from=analyze');
    expect(newLineFromAnalyzePath('Black/Sicilian')).toBe(
      '/training/new?folder=Black%2FSicilian&from=analyze',
    );
  });

  it('drills one line off the drill screen, keeping the folder for the way back', () => {
    expect(drillLinePath('abc', '')).toBe('/training/drill?line=abc');
    expect(drillLinePath('abc', 'White')).toBe('/training/drill?line=abc&folder=White');
    expect(drillLinePath('a b&c', 'Black/Sicilian')).toBe(
      '/training/drill?line=a%20b%26c&folder=Black%2FSicilian',
    );
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

describe('line set URLs', () => {
  it('spells Database as no parameter, matching the default', () => {
    expect(linesPath('', 'database')).toBe('/training');
    expect(linesPath('White', 'database')).toBe(linesPath('White'));
    expect(drillPath('White', 'database')).toBe(drillPath('White'));
    expect(drillLinePath('abc', 'White', 'database')).toBe(drillLinePath('abc', 'White'));
    expect(explorePath('', 'database')).toBe(explorePath(''));
    expect(editLinePath('abc', '', 'database')).toBe('/training/abc/edit');
    expect(newLinePath('', 'database')).toBe(newLinePath(''));
    expect(newLineFromExplorePath('White', 'database')).toBe(newLineFromExplorePath('White'));
    expect(newLineFromAnalyzePath('', 'database')).toBe(newLineFromAnalyzePath(''));
  });

  it('adds set=personal at the root', () => {
    expect(linesPath('', 'personal')).toBe('/training?set=personal');
    expect(drillPath('', 'personal')).toBe('/training/drill?set=personal');
    expect(newLinePath('', 'personal')).toBe('/training/new?set=personal');
    expect(explorePath('', 'personal')).toBe('/training/explore?set=personal');
    expect(editLinePath('abc', '', 'personal')).toBe('/training/abc/edit?set=personal');
    expect(drillLinePath('abc', '', 'personal')).toBe('/training/drill?line=abc&set=personal');
    expect(newLineFromExplorePath('', 'personal')).toBe(
      '/training/new?from=explore&set=personal',
    );
    expect(newLineFromAnalyzePath('', 'personal')).toBe(
      '/training/new?from=analyze&set=personal',
    );
  });

  it('puts set=personal after the folder and the other parameters', () => {
    const folder = 'Black/Sicilian';
    expect(linesPath(folder, 'personal')).toBe('/training?folder=Black%2FSicilian&set=personal');
    expect(drillPath(folder, 'personal')).toBe(
      '/training/drill?folder=Black%2FSicilian&set=personal',
    );
    expect(newLinePath(folder, 'personal')).toBe(
      '/training/new?folder=Black%2FSicilian&set=personal',
    );
    expect(explorePath(folder, 'personal')).toBe(
      '/training/explore?folder=Black%2FSicilian&set=personal',
    );
    expect(editLinePath('abc', folder, 'personal')).toBe(
      '/training/abc/edit?folder=Black%2FSicilian&set=personal',
    );
    expect(drillLinePath('a b&c', folder, 'personal')).toBe(
      '/training/drill?line=a%20b%26c&folder=Black%2FSicilian&set=personal',
    );
    expect(newLineFromExplorePath(folder, 'personal')).toBe(
      '/training/new?folder=Black%2FSicilian&from=explore&set=personal',
    );
    expect(newLineFromAnalyzePath(folder, 'personal')).toBe(
      '/training/new?folder=Black%2FSicilian&from=analyze&set=personal',
    );
  });

  it('round-trips folder and set through URLSearchParams', () => {
    const path = drillLinePath('a b&c', 'Caro-Kann & co', 'personal');
    const params = new URLSearchParams(path.split('?')[1]);
    expect(params.get('line')).toBe('a b&c');
    expect(params.get('folder')).toBe('Caro-Kann & co');
    expect(parseLineSet(params)).toBe('personal');
  });
});

describe('parseLineSet', () => {
  it('reads set=personal', () => {
    expect(parseLineSet(new URLSearchParams('set=personal'))).toBe('personal');
    expect(parseLineSet(new URLSearchParams('folder=White&set=personal'))).toBe('personal');
  });

  it('treats an absent or unknown set as Database', () => {
    expect(parseLineSet(new URLSearchParams(''))).toBe('database');
    expect(parseLineSet(new URLSearchParams('folder=White'))).toBe('database');
    expect(parseLineSet(new URLSearchParams('set=database'))).toBe('database');
    expect(parseLineSet(new URLSearchParams('set=Personal'))).toBe('database');
    expect(parseLineSet(new URLSearchParams('set='))).toBe('database');
  });
});

describe('side filter', () => {
  it('writes ?side= last on drill URLs, and nothing for both', () => {
    expect(drillPath('', 'database', 'both')).toBe('/training/drill');
    expect(drillPath('', 'database', 'w')).toBe('/training/drill?side=w');
    expect(drillPath('Black/Sicilian', 'personal', 'b')).toBe(
      '/training/drill?folder=Black%2FSicilian&set=personal&side=b',
    );
  });

  it('reads w and b, anything else as both', () => {
    expect(parseTrainedFor(new URLSearchParams('side=w'))).toBe('w');
    expect(parseTrainedFor(new URLSearchParams('folder=X&side=b'))).toBe('b');
    expect(parseTrainedFor(new URLSearchParams(''))).toBe('both');
    expect(parseTrainedFor(new URLSearchParams('side=W'))).toBe('both');
  });
});
