import { beforeEach, describe, expect, it, vi } from 'vitest';
import { treeFromMoves } from '../chess/tree';

/**
 * The one test that runs against the *real* `public/data/*.json` files (through
 * `import.meta.glob` in `seedData.ts`, which vitest resolves like the app build does): every
 * bundled file must load cleanly, and a reset must only ever destroy the user's own lines.
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

const MINE = {
  name: 'Mine',
  startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  tree: treeFromMoves(['d4']),
  userColor: 'w' as const,
};

describe('bundled files', () => {
  it('all load without a rejected line', async () => {
    const { seedData } = await load();
    const report = seedData.loadBundledLines();
    expect(report.added).toBeGreaterThan(0);
    expect(report.files.filter((f) => f.error !== undefined || f.rejections.length > 0)).toEqual([]);
  });
});

describe('resetSummary against the bundled files', () => {
  it('counts no custom line when only bundled lines are listed', async () => {
    const { reset, seedData } = await load();
    const loaded = seedData.loadBundledLines();

    const summary = reset.resetSummary();
    expect(summary.total).toBe(loaded.added);
    expect(summary.custom).toBe(0);
    expect(summary.blindGame).toBe(false);
  });

  it('counts the lines the user added, and bundled lines they edited', async () => {
    const { reset, seedData, lines } = await load();
    seedData.loadBundledLines();
    lines.createLine(MINE);
    const bundled = lines.listLines().find((l) => l.origin === 'server');
    lines.updateLine(bundled?.id ?? '', { name: 'Edited' });

    expect(reset.resetSummary().custom).toBe(2);
  });
});

describe('clearAll', () => {
  it('empties every key, keeps the bundled lines and drops the user ones', async () => {
    const { reset, seedData, lines } = await load();
    const loaded = seedData.loadBundledLines();
    lines.createLine(MINE);
    const bundled = lines.listLines().find((l) => l.origin === 'server');
    lines.deleteLine(bundled?.id ?? '');

    expect(reset.clearAll()).toEqual({ ok: true });
    expect(store.map.size).toBe(0);
    expect(lines.listLines()).toHaveLength(loaded.added);
    expect(lines.listLines().map((l) => l.name)).not.toContain('Mine');
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
