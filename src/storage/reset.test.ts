import { beforeEach, describe, expect, it, vi } from 'vitest';
import { START_FEN } from '../chess/position';
import { treeFromMoves } from '../chess/tree';
import type { Line } from './schema';

/**
 * The one test that runs against the *real* `public/data/*.json` files (through
 * `import.meta.glob` in `seedData.ts`, which vitest resolves like the app build does): every
 * bundled file must load cleanly, and a refresh must only ever destroy what it was asked to.
 * `refreshData` itself is driven with a stub loader, so its tests do not depend on what happens
 * to be in `public/data/` today.
 *
 * Same stub-per-test setup as `lines.test.ts`.
 */
async function load() {
  const reset = await import('./reset');
  const seedData = await import('./seedData');
  const lines = await import('./lines');
  const personal = await import('./personal');
  return { reset, seedData, lines, personal };
}

const HIDDEN_KEY = 'chess-trainer.hiddenServerLines.v1';
const PERSONAL_KEY = 'chess-trainer.personalLines.v1';
const BLIND_KEY = 'chess-trainer.blindGame.v1';

class StubStorage {
  readonly map = new Map<string, string>();
  /** Keys whose `setItem` / `removeItem` throw. */
  readonly failing = new Set<string>();

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
    if (this.failing.has(k)) throw new Error('QuotaExceededError: storage is full');
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    if (this.failing.has(k)) throw new Error('SecurityError: storage is disabled');
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
    expect(summary.hidden).toBe(0);
    expect(summary.personal).toBe(0);
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

describe('resetSummary', () => {
  it('counts hidden bundled lines and personal lines', async () => {
    const { reset, lines, personal } = await load();
    lines.setServerLines([bundled('s1'), bundled('s2'), bundled('s3')]);
    const mine = lines.createLine(MINE);
    lines.deleteLine('s1');
    lines.updateLine('s2', { name: 'Edited' });
    personal.addPersonal([mine.id, 's3', 'gone']);

    expect(reset.resetSummary()).toEqual({ total: 3, custom: 2, hidden: 2, personal: 2 });
  });
});

function bundled(id: string): Line {
  return {
    id,
    name: `Bundled ${id}`,
    startFen: START_FEN,
    tree: treeFromMoves(['e4', 'e5']),
    userColor: 'w',
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('refreshData', () => {
  /**
   * A store with one user line, one deleted bundled line ("s1"), one edited bundled line ("s2",
   * forked) and a Personal list of the user line, the fork, "s3" and a stale id. The stub
   * loader installs `next` as the new bundled set.
   */
  async function setup(next: string[] = ['s1', 's2', 's3']) {
    const modules = await load();
    const { lines, personal } = modules;
    lines.setServerLines([bundled('s1'), bundled('s2'), bundled('s3')]);
    const mine = lines.createLine(MINE);
    lines.deleteLine('s1');
    const fork = lines.updateLine('s2', { name: 'Edited' }) as Line;
    personal.addPersonal([mine.id, fork.id, 's3']);
    store.map.set(
      PERSONAL_KEY,
      JSON.stringify([...JSON.parse(store.map.get(PERSONAL_KEY) ?? '[]'), 'gone']),
    );
    store.map.set(BLIND_KEY, '{"saved":"game"}');
    vi.resetModules();
    const fresh = await load();
    fresh.lines.setServerLines([bundled('s1'), bundled('s2'), bundled('s3')]);
    const reload = vi.fn(() => {
      fresh.lines.setServerLines(next.map(bundled));
      return { added: next.length, files: [] };
    });
    return { ...fresh, mine, fork, reload };
  }

  it('delete mode: drops user lines and hidden ids, reloads, prunes Personal', async () => {
    const { reset, lines, personal, reload } = await setup();

    const result = reset.refreshData({ mode: 'delete-user-lines', clearPersonal: false, reload });
    expect(result).toEqual({ ok: true, personalRemoved: 3, personalCleared: false });
    expect(reload).toHaveBeenCalledOnce();
    expect(store.map.has(HIDDEN_KEY)).toBe(false);
    expect(lines.listLines().map((l) => l.id).sort()).toEqual(['s1', 's2', 's3']);
    // The user line, the fork and the stale id are gone; the bundled pick stays.
    expect(personal.personalIds()).toEqual(new Set(['s3']));
    expect(JSON.parse(store.map.get(PERSONAL_KEY) ?? '[]')).toEqual(['s3']);
    expect(store.map.get(BLIND_KEY)).toBe('{"saved":"game"}');
  });

  it('keep mode: keeps user lines, un-hides bundled lines, prunes only missing ids', async () => {
    const { reset, lines, personal, mine, fork, reload } = await setup();

    const result = reset.refreshData({ mode: 'keep-user-lines', clearPersonal: false, reload });
    expect(result).toEqual({ ok: true, personalRemoved: 1, personalCleared: false });
    expect(reload).toHaveBeenCalledOnce();
    expect(store.map.has(HIDDEN_KEY)).toBe(false);
    // Original and edited copy both appear.
    expect(lines.listLines().map((l) => l.id).sort()).toEqual(
      [mine.id, fork.id, 's1', 's2', 's3'].sort(),
    );
    expect(personal.personalIds()).toEqual(new Set([mine.id, fork.id, 's3']));
    expect(store.map.get(BLIND_KEY)).toBe('{"saved":"game"}');
  });

  it('prunes a bundled pick the new build no longer ships', async () => {
    const { reset, personal, reload } = await setup(['s1', 's2']);

    const result = reset.refreshData({ mode: 'keep-user-lines', clearPersonal: false, reload });
    expect(result.personalRemoved).toBe(2);
    expect(personal.isPersonal('s3')).toBe(false);
  });

  it.each(['delete-user-lines', 'keep-user-lines'] as const)(
    '%s with the checkbox ticked empties Personal',
    async (mode) => {
      const { reset, personal, reload } = await setup();

      const result = reset.refreshData({ mode, clearPersonal: true, reload });
      expect(result).toEqual({ ok: true, personalRemoved: 0, personalCleared: true });
      expect(store.map.has(PERSONAL_KEY)).toBe(false);
      expect(personal.personalIds().size).toBe(0);
      expect(store.map.get(BLIND_KEY)).toBe('{"saved":"game"}');
    },
  );

  it('keeps the user lines when the checkbox clears Personal in keep mode', async () => {
    const { reset, lines, mine, reload } = await setup();

    reset.refreshData({ mode: 'keep-user-lines', clearPersonal: true, reload });
    expect(lines.getLine(mine.id)).not.toBeNull();
  });

  it('reports failure instead of claiming a store it could not clear', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const { reset } = await load();
    const reload = vi.fn(() => ({ added: 0, files: [] }));

    for (const mode of ['delete-user-lines', 'keep-user-lines'] as const) {
      const result = reset.refreshData({ mode, clearPersonal: false, reload });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/storage/i);
    }
  });

  it('reports a hidden-ids record it could not remove', async () => {
    const { reset, reload } = await setup();
    store.failing.add(HIDDEN_KEY);

    const result = reset.refreshData({ mode: 'keep-user-lines', clearPersonal: false, reload });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/storage/i);
    // The rest still happened.
    expect(reload).toHaveBeenCalledOnce();
    expect(result.personalRemoved).toBe(1);
  });

  it('reports a Personal list it could not clear or prune', async () => {
    const { reset, reload } = await setup();
    store.failing.add(PERSONAL_KEY);

    expect(reset.refreshData({ mode: 'keep-user-lines', clearPersonal: true, reload }).ok).toBe(
      false,
    );
    expect(store.map.has(HIDDEN_KEY)).toBe(false);
  });

  it('reports a failed prune write', async () => {
    const { reset, reload } = await setup();
    store.failing.add(PERSONAL_KEY);

    const result = reset.refreshData({ mode: 'delete-user-lines', clearPersonal: false, reload });
    expect(result.ok).toBe(false);
    expect(result.personalRemoved).toBe(3);
  });

  it('defaults to the bundled loader', async () => {
    const { reset, seedData, lines } = await load();
    const loaded = seedData.loadBundledLines();
    lines.createLine(MINE);
    lines.setServerLines([]);

    expect(reset.refreshData({ mode: 'delete-user-lines', clearPersonal: false }).ok).toBe(true);
    expect(lines.listLines()).toHaveLength(loaded.added);
  });
});
