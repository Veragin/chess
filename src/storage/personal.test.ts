import { beforeEach, describe, expect, it, vi } from 'vitest';
import { START_FEN } from '../chess/position';
import { treeFromMoves } from '../chess/tree';
import type { Line } from './schema';

/**
 * Same stub-per-test setup as `lines.test.ts`: `personalIds.ts` and `lines.ts` look
 * `localStorage` up lazily, and `load()` after `vi.resetModules()` doubles as a page reload
 * against the same store.
 */
async function load() {
  const personal = await import('./personal');
  const lines = await import('./lines');
  return { personal, lines };
}

const PERSONAL_KEY = 'chess-trainer.personalLines.v1';

class StubStorage {
  readonly map = new Map<string, string>();
  throwOnGet = false;
  throwOnSet = false;

  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    if (this.throwOnGet) throw new Error('SecurityError: storage is disabled');
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    if (this.throwOnSet) throw new Error('QuotaExceededError: storage is full');
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

function install(value: unknown): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  vi.resetModules();
  store = new StubStorage();
  install(store);
});

const ITALIAN = {
  name: 'Italian',
  startFen: START_FEN,
  tree: treeFromMoves(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']),
  userColor: 'w' as const,
};
const FRENCH = {
  name: 'French',
  startFen: START_FEN,
  tree: treeFromMoves(['e4', 'e6']),
  userColor: 'b' as const,
};

function serverLine(id: string, folder?: string): Line {
  const line: Line = {
    id,
    name: `Bundled ${id}`,
    startFen: START_FEN,
    tree: treeFromMoves(['d4', 'd5']),
    userColor: 'w',
    createdAt: 1,
    updatedAt: 1,
  };
  if (folder !== undefined) line.folder = folder;
  return line;
}

function storedIds(): unknown {
  const raw = store.map.get(PERSONAL_KEY);
  return raw === undefined ? null : JSON.parse(raw);
}

// ---------------------------------------------------------------------------------------

describe('add / remove round-trip', () => {
  it('adds, reports and removes ids through storage', async () => {
    const { personal, lines } = await load();
    const a = lines.createLine(ITALIAN);
    const b = lines.createLine(FRENCH);

    expect(personal.addPersonal([a.id, b.id])).toBe(true);
    expect(personal.isPersonal(a.id)).toBe(true);
    expect(personal.personalIds()).toEqual(new Set([a.id, b.id]));
    expect(storedIds()).toEqual([a.id, b.id]);

    expect(personal.removePersonal([a.id])).toBe(true);
    expect(personal.isPersonal(a.id)).toBe(false);
    expect(storedIds()).toEqual([b.id]);
    // Removing from Personal never touches the line itself.
    expect(lines.getLine(a.id)).not.toBeNull();
  });

  it('survives a reload', async () => {
    const first = await load();
    const a = first.lines.createLine(ITALIAN);
    first.personal.addPersonal([a.id]);

    vi.resetModules();
    const second = await load();
    expect(second.personal.isPersonal(a.id)).toBe(true);
    expect(second.personal.listPersonalLines().map((l) => l.id)).toEqual([a.id]);
  });

  it('adds a whole folder in one write, without duplicates', async () => {
    const { personal, lines } = await load();
    const a = lines.createLine(ITALIAN);
    const b = lines.createLine(FRENCH);
    personal.addPersonal([a.id]);
    personal.addPersonal([a.id, b.id]);

    expect(storedIds()).toEqual([a.id, b.id]);
  });

  it('clearPersonal empties the set and removes the key', async () => {
    const { personal, lines } = await load();
    const a = lines.createLine(ITALIAN);
    personal.addPersonal([a.id]);

    expect(personal.clearPersonal()).toBe(true);
    expect(store.map.has(PERSONAL_KEY)).toBe(false);
    expect(personal.personalIds().size).toBe(0);
  });
});

describe('storage failure modes', () => {
  it('keeps the set in memory when localStorage is absent', async () => {
    install(undefined);
    const { personal, lines } = await load();
    const a = lines.createLine(ITALIAN);

    expect(personal.addPersonal([a.id])).toBe(false);
    expect(personal.isPersonal(a.id)).toBe(true);
    expect(personal.clearPersonal()).toBe(false);
    expect(personal.isPersonal(a.id)).toBe(false);
  });

  it('never throws when merely touching localStorage throws', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      get() {
        throw new Error('SecurityError: access denied');
      },
      configurable: true,
    });
    const { personal, lines } = await load();
    const a = lines.createLine(ITALIAN);

    expect(() => personal.personalIds()).not.toThrow();
    expect(personal.addPersonal([a.id])).toBe(false);
    expect(personal.listPersonalLines().map((l) => l.id)).toEqual([a.id]);
  });

  it('keeps a rejected write in memory and reports it', async () => {
    const { personal, lines } = await load();
    const a = lines.createLine(ITALIAN);
    store.throwOnSet = true;

    expect(personal.addPersonal([a.id])).toBe(false);
    expect(storedIds()).toBeNull();
    expect(personal.isPersonal(a.id)).toBe(true);
  });

  it('reads an empty set when getItem throws', async () => {
    store.map.set(PERSONAL_KEY, JSON.stringify(['x']));
    store.throwOnGet = true;
    const { personal } = await load();

    expect(personal.isPersonal('x')).toBe(false);
  });
});

describe('corrupt payload', () => {
  it.each(['not json', '{"a":1}', '42'])('reads %j as nothing, left on disk', async (raw) => {
    store.map.set(PERSONAL_KEY, raw);
    const { personal, lines } = await load();
    lines.createLine(ITALIAN);

    expect(personal.personalIds().size).toBe(0);
    expect(personal.listPersonalLines()).toEqual([]);
    expect(store.map.get(PERSONAL_KEY)).toBe(raw);
  });

  it('ignores non-string entries', async () => {
    const { lines } = await load();
    const a = lines.createLine(ITALIAN);
    store.map.set(PERSONAL_KEY, JSON.stringify([a.id, 7, null]));

    vi.resetModules();
    const { personal } = await load();
    expect(personal.personalIds()).toEqual(new Set([a.id]));
  });
});

describe('stale ids', () => {
  it('are filtered on read without writing, and pruned on the next write', async () => {
    const { lines } = await load();
    const a = lines.createLine(ITALIAN);
    const b = lines.createLine(FRENCH);
    const raw = JSON.stringify([a.id, 'gone']);
    store.map.set(PERSONAL_KEY, raw);

    vi.resetModules();
    const { personal } = await load();
    expect(personal.listPersonalLines().map((l) => l.id)).toEqual([a.id]);
    expect(personal.personalIds()).toEqual(new Set([a.id]));
    expect(store.map.get(PERSONAL_KEY)).toBe(raw);

    personal.addPersonal([b.id]);
    expect(storedIds()).toEqual([a.id, b.id]);
  });

  it('prunePersonal keeps only resolvable ids', async () => {
    const { lines } = await load();
    const a = lines.createLine(ITALIAN);
    store.map.set(PERSONAL_KEY, JSON.stringify(['gone', a.id, 'also-gone']));

    vi.resetModules();
    const { personal } = await load();
    expect(personal.prunePersonal()).toEqual({ removed: 2, ok: true });
    expect(storedIds()).toEqual([a.id]);
    expect(personal.prunePersonal()).toEqual({ removed: 0, ok: true });
  });
});

describe('id changes in lines.ts', () => {
  it('editing a personal server line keeps it personal under the fork id', async () => {
    const { personal, lines } = await load();
    lines.setServerLines([serverLine('s1'), serverLine('s2')]);
    personal.addPersonal(['s1', 's2']);

    const edited = lines.updateLine('s1', { name: 'Edited' });
    expect(edited).not.toBeNull();
    expect(edited?.id).not.toBe('s1');
    expect(personal.isPersonal(edited?.id ?? '')).toBe(true);
    expect(personal.isPersonal('s1')).toBe(false);
    expect(personal.listPersonalLines().map((l) => l.name).sort()).toEqual([
      'Bundled s2',
      'Edited',
    ]);
  });

  it('editing a server line that is not personal leaves the set alone', async () => {
    const { personal, lines } = await load();
    lines.setServerLines([serverLine('s1')]);

    lines.updateLine('s1', { name: 'Edited' });
    expect(store.map.has(PERSONAL_KEY)).toBe(false);
    expect(personal.personalIds().size).toBe(0);
  });

  it('renameFolder over personal server lines keeps them personal', async () => {
    const { personal, lines } = await load();
    lines.setServerLines([serverLine('s1', 'Old'), serverLine('s2', 'Old/Deep'), serverLine('s3')]);
    personal.addPersonal(['s1', 's2', 's3']);

    expect(lines.renameFolder('Old', 'New').ok).toBe(true);
    const picked = personal.listPersonalLines();
    expect(picked).toHaveLength(3);
    expect(picked.map((l) => l.folder ?? '').sort()).toEqual(['', 'New', 'New/Deep']);
    expect(personal.isPersonal('s3')).toBe(true);
    expect(personal.isPersonal('s1')).toBe(false);
  });

  it('deleteLine drops the id, for user and server lines alike', async () => {
    const { personal, lines } = await load();
    lines.setServerLines([serverLine('s1')]);
    const a = lines.createLine(ITALIAN);
    const b = lines.createLine(FRENCH);
    personal.addPersonal([a.id, b.id, 's1']);

    expect(lines.deleteLine(a.id)).toBe(true);
    expect(lines.deleteLine('s1')).toBe(true);
    expect(storedIds()).toEqual([b.id]);
  });
});
