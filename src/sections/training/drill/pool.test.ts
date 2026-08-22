import { beforeEach, describe, expect, it, vi } from 'vitest';
import { START_FEN } from '../../../chess/position';
import { LINES_SCHEMA_VERSION, type Line } from '../../../storage/schema';

/**
 * `pool.ts` reads storage, and storage reads `localStorage` lazily, so the store is stubbed the
 * same way `storage/lines.test.ts` does it and the modules are re-imported per test.
 */
const STORAGE_KEY = 'chess-trainer.lines.v1';

let store: Map<string, string>;

function seed(lines: Partial<Line>[]): void {
  const payload = {
    schemaVersion: LINES_SCHEMA_VERSION,
    exportedAt: 1,
    lines: lines.map((partial, i) => ({
      id: `id-${i}`,
      name: `Line ${i}`,
      startFen: START_FEN,
      moves: ['e4', 'e5'],
      userColor: 'w',
      createdAt: 1,
      updatedAt: lines.length - i, // keeps listLines' order the seeded order
      ...partial,
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
      { folder: 'White', moves: ['e4', 'Qh9'] },
      { folder: 'White', moves: ['d4'] },
    ]);
    expect(await pool('White')).toEqual(['id-1']);
  });
});
