import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The one test that runs against the *real* `public/data/*.json` files (through
 * `import.meta.glob` in `seedData.ts`, which vitest resolves like the app build does).
 *
 * What it guards is the claim the confirmation dialog makes: "these N lines are your own, the
 * rest come back on the next load". That claim rests on a freshly seeded line matching its own
 * source file by content — so a bundled file written with SAN the normaliser rewrites (`0-0`,
 * `e4xd5`), or a folder path that gets trimmed on the way in, would silently turn every seeded
 * line into a "custom" one and warn the user about losing lines they never wrote.
 *
 * Same stub-per-test setup as `lines.test.ts`.
 */
async function load() {
  const reset = await import('./reset');
  const seedData = await import('./seedData');
  const lines = await import('./lines');
  return { reset, seedData, lines };
}

class StubStorage {
  readonly map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}

let store: StubStorage;

beforeEach(() => {
  vi.resetModules();
  store = new StubStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    value: store,
    configurable: true,
    writable: true,
  });
});

describe('resetSummary against the bundled files', () => {
  it('counts no custom line in a store that holds only seeded lines', async () => {
    const { reset, seedData } = await load();
    const seeded = seedData.seedBundledLines();

    const summary = reset.resetSummary();
    expect(summary.total).toBe(seeded.added);
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.custom).toBe(0);
    expect(summary.blindGame).toBe(false);
  });

  it('counts the lines the user added on top', async () => {
    const { reset, seedData, lines } = await load();
    seedData.seedBundledLines();
    lines.createLine({
      name: 'Mine',
      startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      moves: ['d4'],
      userColor: 'w',
    });

    expect(reset.resetSummary().custom).toBe(1);
  });
});

describe('clearAll', () => {
  it('empties every key, and the next load seeds the bundled lines again', async () => {
    const first = await load();
    const seeded = first.seedData.seedBundledLines();
    first.lines.createLine({
      name: 'Mine',
      startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      moves: ['d4'],
      userColor: 'w',
    });

    expect(first.reset.clearAll()).toEqual({ ok: true });
    expect(store.map.size).toBe(0);
    expect(first.lines.listLines()).toEqual([]);

    vi.resetModules();
    const second = await load();
    second.seedData.seedBundledLines();
    // The bundled repertoire is back in full; the hand-written line is not.
    expect(second.lines.listLines()).toHaveLength(seeded.added);
    expect(second.lines.listLines().map((l) => l.name)).not.toContain('Mine');
  });

  it('reports failure instead of claiming an empty store it could not empty', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const { reset } = await load();

    const result = reset.clearAll();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/storage/i);
  });
});
