import { beforeEach, describe, expect, it, vi } from 'vitest';
import { START_FEN } from '../../../chess/position';
import { LINES_SCHEMA_VERSION, type Line } from '../../../storage/schema';
import { treeFromMoves } from '../../../chess/tree';
import { encodeTree } from '../../../storage/treeFormat';

/**
 * `pool.ts` reads storage, and storage reads `localStorage` lazily, so the store is stubbed the
 * same way `storage/lines.test.ts` does it and the modules are re-imported per test.
 */
const STORAGE_KEY = 'chess-trainer.lines.v1';
const PERSONAL_KEY = 'chess-trainer.personalLines.v1';

let store: Map<string, string>;

function seed(lines: Partial<Line>[]): void {
  const payload = {
    schemaVersion: LINES_SCHEMA_VERSION,
    exportedAt: 1,
    lines: lines.map((partial, i) => ({
      id: `id-${i}`,
      name: `Line ${i}`,
      startFen: START_FEN,
      userColor: 'w',
      createdAt: 1,
      updatedAt: lines.length - i, // keeps listLines' order the seeded order
      ...partial,
      tree: encodeTree(partial.tree ?? treeFromMoves(['e4', 'e5'])),
    })),
  };
  store.set(STORAGE_KEY, JSON.stringify(payload));
}

async function pool(folder?: string): Promise<string[]> {
  const { drillablePool } = await import('./pool');
  return folder === undefined ? drillablePool() : drillablePool(folder);
}

beforeEach(() => {
  vi.resetModules();
  store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    },
    configurable: true,
    writable: true,
  });
});

describe('drillablePool', () => {
  it('serves every line when no folder is given', async () => {
    seed([{}, { folder: 'White' }, { folder: 'Black/Sicilian' }]);
    expect(await pool()).toEqual(['id-0', 'id-1', 'id-2']);
    expect(await pool('')).toEqual(['id-0', 'id-1', 'id-2']);
  });

  it('scopes to one folder and everything beneath it', async () => {
    seed([
      { folder: '' },
      { folder: 'White' },
      { folder: 'Black' },
      { folder: 'Black/Sicilian' },
      { folder: 'Black/Sicilian/Najdorf' },
      { folder: 'Black-ish' },
    ]);

    // The whole Black repertoire, subfolders included — but not the similarly named sibling.
    expect(await pool('Black')).toEqual(['id-2', 'id-3', 'id-4']);
    expect(await pool('Black/Sicilian')).toEqual(['id-3', 'id-4']);
    expect(await pool('White')).toEqual(['id-1']);
  });

  it('is empty for a folder no line names', async () => {
    seed([{ folder: 'White' }]);
    expect(await pool('Nowhere')).toEqual([]);
  });

  it('accepts an un-normalised folder, as the URL may carry one', async () => {
    seed([{ folder: 'Black/Sicilian' }]);
    expect(await pool(' Black / Sicilian ')).toEqual(['id-0']);
  });

  it('still drops lines that cannot be replayed, inside a folder as well as outside', async () => {
    seed([
      { folder: 'White', tree: treeFromMoves(['e4', 'Qh9']) },
      { folder: 'White', tree: treeFromMoves(['d4']) },
    ]);
    expect(await pool('White')).toEqual(['id-1']);
  });
});

describe('drillablePool in the Personal set', () => {
  function pick(ids: string[]): void {
    store.set(PERSONAL_KEY, JSON.stringify(ids));
  }

  async function personalPool(folder = ''): Promise<string[]> {
    const { drillablePool } = await import('./pool');
    return drillablePool(folder, 'personal');
  }

  it('serves only the picked lines', async () => {
    seed([{}, { folder: 'White' }, { folder: 'Black' }]);
    pick(['id-2', 'id-0']);
    expect(await personalPool()).toEqual(['id-0', 'id-2']);
    // The Database pool is unaffected by the picks.
    expect(await pool()).toEqual(['id-0', 'id-1', 'id-2']);
  });

  it('is empty when nothing is picked', async () => {
    seed([{}, { folder: 'White' }]);
    expect(await personalPool()).toEqual([]);
  });

  it('scopes to a folder within the picked lines', async () => {
    seed([
      { folder: 'Black' },
      { folder: 'Black/Sicilian' },
      { folder: 'Black/Sicilian' },
      { folder: 'White' },
    ]);
    pick(['id-1', 'id-3']);
    expect(await personalPool('Black')).toEqual(['id-1']);
    expect(await personalPool('Black/Sicilian')).toEqual(['id-1']);
    expect(await personalPool('White')).toEqual(['id-3']);
  });

  it('ignores a picked id whose line no longer exists, without writing', async () => {
    seed([{}, {}]);
    pick(['gone', 'id-1']);
    expect(await personalPool()).toEqual(['id-1']);
    expect(store.get(PERSONAL_KEY)).toBe(JSON.stringify(['gone', 'id-1']));
  });
});

describe('drillableBranchPool / drillPoolEntry', () => {
  const twoBranches = [
    {
      san: 'e4',
      next: [
        { san: 'e5', next: [] },
        { san: 'c5', next: [] },
      ],
    },
  ];

  it('carries each line’s branch count', async () => {
    seed([{ tree: twoBranches }, {}, { tree: [] }]);
    const { drillableBranchPool } = await import('./pool');
    expect(drillableBranchPool()).toEqual([
      { id: 'id-0', branches: 2 },
      { id: 'id-1', branches: 1 },
      { id: 'id-2', branches: 1 },
    ]);
  });

  it('describes a single line, even one that no longer exists', async () => {
    seed([{ tree: twoBranches }]);
    const { drillPoolEntry } = await import('./pool');
    expect(drillPoolEntry('id-0')).toEqual({ id: 'id-0', branches: 2 });
    expect(drillPoolEntry('gone')).toEqual({ id: 'gone', branches: 1 });
  });
});

describe('loadDrillLine', () => {
  const branched = [
    {
      san: 'e4',
      next: [
        { san: 'e5', next: [{ san: 'Nf3', comment: 'develop', next: [] }] },
        { san: 'c5', next: [] },
      ],
    },
  ];

  it('loads the requested branch, comments included', async () => {
    seed([{ tree: branched }]);
    const { loadDrillLine } = await import('./pool');

    const main = loadDrillLine('id-0');
    expect(main.status).toBe('ready');
    if (main.status === 'ready') {
      expect(main.line.sans).toEqual(['e4', 'e5', 'Nf3']);
      expect(main.line.comments).toEqual([undefined, undefined, 'develop']);
    }
    // The whole tree comes along, so the run can follow another repertoire move.
    expect(main.status === 'ready' && main.tree).toEqual(branched);
    const second = loadDrillLine('id-0', 1);
    expect(second.status === 'ready' && second.line.sans).toEqual(['e4', 'c5']);
  });

  it('reports a branch that does not exist as missing', async () => {
    seed([{ tree: branched }]);
    const { loadDrillLine } = await import('./pool');
    expect(loadDrillLine('id-0', 2)).toEqual({ status: 'missing' });
    expect(loadDrillLine('nope')).toEqual({ status: 'missing' });
  });
});
