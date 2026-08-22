import { describe, expect, it } from 'vitest';
import { START_FEN } from '../chess/position';
import {
  allFolderPaths,
  childFolders,
  folderCrumbs,
  folderLabel,
  folderName,
  folderRenameError,
  isWithinFolder,
  joinFolder,
  lineFolder,
  linesInFolder,
  linesUnderFolder,
  parentFolder,
  renameFolderPath,
  ROOT_FOLDER_LABEL,
} from './folders';
import { normaliseFolderPath, type Line } from './schema';

function line(name: string, folder?: string): Line {
  const base: Line = {
    id: `id-${name}`,
    name,
    startFen: START_FEN,
    moves: ['e4'],
    userColor: 'w',
    createdAt: 1,
    updatedAt: 1,
  };
  return folder === undefined ? base : { ...base, folder };
}

/** Two sibling trees plus a root line, which is the shape every list case below needs. */
const REPERTOIRE: Line[] = [
  line('Scandi'), // root
  line('Italian', 'White'),
  line('Najdorf', 'Black/Sicilian'),
  line('Dragon', 'Black/Sicilian'),
  line('Deep', 'Black/Sicilian/Najdorf/Poisoned pawn'),
  line('Caro', 'Black/Caro-Kann'),
];

describe('normaliseFolderPath', () => {
  it('trims segments, collapses whitespace and drops empty ones', () => {
    expect(normaliseFolderPath('  Black /  Sicilian  ')).toBe('Black/Sicilian');
    expect(normaliseFolderPath('Black//Sicilian/')).toBe('Black/Sicilian');
    expect(normaliseFolderPath('/Black/')).toBe('Black');
    expect(normaliseFolderPath('Sicilian   Najdorf')).toBe('Sicilian Najdorf');
  });

  it('treats anything unusable as the root rather than failing', () => {
    expect(normaliseFolderPath('')).toBe('');
    expect(normaliseFolderPath('   ')).toBe('');
    expect(normaliseFolderPath('///')).toBe('');
    expect(normaliseFolderPath(undefined)).toBe('');
    expect(normaliseFolderPath(null)).toBe('');
    expect(normaliseFolderPath(42)).toBe('');
    expect(normaliseFolderPath({ folder: 'x' })).toBe('');
  });

  it('caps depth and segment length', () => {
    const deep = Array.from({ length: 20 }, (_, i) => `f${i}`).join('/');
    expect(normaliseFolderPath(deep).split('/')).toHaveLength(8);
    expect(normaliseFolderPath('x'.repeat(200))).toHaveLength(64);
  });

  it('is idempotent', () => {
    const once = normaliseFolderPath(' a // b /c ');
    expect(normaliseFolderPath(once)).toBe(once);
  });
});

describe('path arithmetic', () => {
  it('reads a folder off a line, however it was stored', () => {
    expect(lineFolder(line('a'))).toBe('');
    expect(lineFolder(line('a', ' Black / Sicilian '))).toBe('Black/Sicilian');
  });

  it('names, parents and joins', () => {
    expect(folderName('Black/Sicilian')).toBe('Sicilian');
    expect(folderName('')).toBe('');
    expect(parentFolder('Black/Sicilian')).toBe('Black');
    expect(parentFolder('Black')).toBe('');
    expect(parentFolder('')).toBe('');
    expect(joinFolder('Black', 'Sicilian')).toBe('Black/Sicilian');
    expect(joinFolder('', 'Black')).toBe('Black');
    expect(joinFolder('Black', '')).toBe('Black');
  });

  it('labels the root', () => {
    expect(folderLabel('')).toBe(ROOT_FOLDER_LABEL);
    expect(folderLabel('Black/Sicilian')).toBe('Black/Sicilian');
  });

  it('containment is segment-aware, and everything is inside the root', () => {
    expect(isWithinFolder('Black/Sicilian', 'Black')).toBe(true);
    expect(isWithinFolder('Black', 'Black')).toBe(true);
    expect(isWithinFolder('Black', 'Black/Sicilian')).toBe(false);
    // The trap a naive `startsWith` falls into.
    expect(isWithinFolder('Sicilian Defence', 'Sicilian')).toBe(false);
    expect(isWithinFolder('', '')).toBe(true);
    expect(isWithinFolder('Black/Sicilian', '')).toBe(true);
  });

  it('builds breadcrumbs from the root down', () => {
    expect(folderCrumbs('')).toEqual([{ name: ROOT_FOLDER_LABEL, path: '' }]);
    expect(folderCrumbs('Black/Sicilian')).toEqual([
      { name: ROOT_FOLDER_LABEL, path: '' },
      { name: 'Black', path: 'Black' },
      { name: 'Sicilian', path: 'Black/Sicilian' },
    ]);
  });
});

describe('selecting lines', () => {
  it('linesInFolder takes only what is filed directly there', () => {
    expect(linesInFolder(REPERTOIRE, 'Black/Sicilian').map((l) => l.name)).toEqual([
      'Najdorf',
      'Dragon',
    ]);
    expect(linesInFolder(REPERTOIRE, '').map((l) => l.name)).toEqual(['Scandi']);
    expect(linesInFolder(REPERTOIRE, 'Nowhere')).toEqual([]);
  });

  it('linesUnderFolder includes the whole subtree', () => {
    expect(linesUnderFolder(REPERTOIRE, 'Black').map((l) => l.name)).toEqual([
      'Najdorf',
      'Dragon',
      'Deep',
      'Caro',
    ]);
    expect(linesUnderFolder(REPERTOIRE, 'Black/Sicilian').map((l) => l.name)).toEqual([
      'Najdorf',
      'Dragon',
      'Deep',
    ]);
  });

  it('the root subtree is every line, and is a copy', () => {
    const all = linesUnderFolder(REPERTOIRE, '');
    expect(all).toHaveLength(REPERTOIRE.length);
    all.pop();
    expect(REPERTOIRE).toHaveLength(6);
  });
});

describe('the implicit folder tree', () => {
  it('lists every path a line mentions, intermediates included', () => {
    expect(allFolderPaths(REPERTOIRE)).toEqual([
      'Black',
      'Black/Caro-Kann',
      'Black/Sicilian',
      'Black/Sicilian/Najdorf',
      'Black/Sicilian/Najdorf/Poisoned pawn',
      'White',
    ]);
  });

  it('has no folders at all when nothing is filed', () => {
    expect(allFolderPaths([line('a'), line('b')])).toEqual([]);
    expect(childFolders([line('a')], '')).toEqual([]);
  });

  it('lists immediate children with subtree counts', () => {
    expect(childFolders(REPERTOIRE, '')).toEqual([
      { path: 'Black', name: 'Black', lineCount: 4, directLineCount: 0, subfolderCount: 2 },
      { path: 'White', name: 'White', lineCount: 1, directLineCount: 1, subfolderCount: 0 },
    ]);
  });

  it('reaches a folder that only exists as an intermediate', () => {
    const children = childFolders(REPERTOIRE, 'Black/Sicilian');
    expect(children).toEqual([
      {
        path: 'Black/Sicilian/Najdorf',
        name: 'Najdorf',
        lineCount: 1,
        directLineCount: 0,
        subfolderCount: 1,
      },
    ]);
  });

  it('sorts children by name, not by insertion order', () => {
    const lines = [line('a', 'Zulu'), line('b', 'alpha'), line('c', 'Mike')];
    expect(childFolders(lines, '').map((f) => f.name)).toEqual(['alpha', 'Mike', 'Zulu']);
  });
});

describe('renaming a folder', () => {
  it('moves the folder and its whole subtree', () => {
    expect(renameFolderPath('Black/Sicilian', 'Black/Sicilian', 'Black/Open Sicilian')).toBe(
      'Black/Open Sicilian',
    );
    expect(
      renameFolderPath('Black/Sicilian/Najdorf', 'Black/Sicilian', 'Black/Open Sicilian'),
    ).toBe('Black/Open Sicilian/Najdorf');
  });

  it('leaves everything outside the renamed folder alone', () => {
    expect(renameFolderPath('Black/Caro-Kann', 'Black/Sicilian', 'X')).toBe('Black/Caro-Kann');
    // A prefix match that is not a path match must not be caught.
    expect(renameFolderPath('Sicilian Defence', 'Sicilian', 'X')).toBe('Sicilian Defence');
    expect(renameFolderPath('', 'Black', 'X')).toBe('');
  });

  it('lifts a subtree to the root when renamed to nothing', () => {
    expect(renameFolderPath('Black/Sicilian', 'Black', '')).toBe('Sicilian');
    expect(renameFolderPath('Black', 'Black', '')).toBe('');
  });

  it('refuses the renames that have no meaning', () => {
    expect(folderRenameError('Black', 'White')).toBeNull();
    expect(folderRenameError('Black', 'Black')).toBeNull();
    expect(folderRenameError('', 'Black')).toMatch(/root/i);
    expect(folderRenameError('Black', '  ')).toMatch(/name/i);
    expect(folderRenameError('Black', 'Black/Sicilian')).toMatch(/inside itself/i);
    // Renaming into a *sibling* of a descendant is fine.
    expect(folderRenameError('Black/Sicilian', 'Black/Caro-Kann')).toBeNull();
  });
});
