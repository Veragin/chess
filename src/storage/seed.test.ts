import { beforeEach, describe, expect, it, vi } from 'vitest';
import { START_FEN } from '../chess/position';
import { LINES_SCHEMA_VERSION } from './schema';
import { treeFromMoves, type MoveTree } from '../chess/tree';
import { encodeTree } from './treeFormat';

/**
 * Same setup as `lines.test.ts`: vitest runs in the `node` environment, so `localStorage` is a
 * stub installed per test, and both modules are re-imported through `load()` after
 * `vi.resetModules()` — which doubles as "the user reloaded the page" (a new build, when the
 * files passed in change) against the same store.
 */
async function load() {
  const seed = await import('./seed');
  const lines = await import('./lines');
  return { seed, lines };
}

const STORAGE_KEY = 'chess-trainer.lines.v1';
const HIDDEN_KEY = 'chess-trainer.hiddenServerLines.v1';

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

interface RawLine {
  id?: unknown;
  name?: unknown;
  startFen?: unknown;
  /** Schema v1 only. */
  moves?: unknown;
  tree?: unknown;
  userColor?: unknown;
  folder?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

/** A current-version file; trees are given in memory and stored as the schema writes them. */
function file(...lines: RawLine[]): unknown {
  const stored = lines.map((line) =>
    Array.isArray(line.tree) ? { ...line, tree: encodeTree(line.tree as MoveTree) } : line,
  );
  return { schemaVersion: LINES_SCHEMA_VERSION, exportedAt: 1_700_000_000_000, lines: stored };
}

function rawLine(id: string, name: string, overrides: RawLine = {}): RawLine {
  return {
    id,
    name,
    startFen: START_FEN,
    tree: treeFromMoves(['e4', 'e5']),
    userColor: 'w',
    folder: 'Stafford',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function storedIds(): string[] {
  const raw = store.map.get(STORAGE_KEY);
  if (raw === undefined) return [];
  return (JSON.parse(raw) as { lines: { id: string }[] }).lines.map((l) => l.id);
}

function hiddenIds(): string[] {
  const raw = store.map.get(HIDDEN_KEY);
  return raw === undefined ? [] : (JSON.parse(raw) as string[]);
}

// ---------------------------------------------------------------------------------------

describe('loading server lines', () => {
  it('lists every bundled line, marked as server, without writing anything', async () => {
    const { seed, lines } = await load();
    const report = seed.loadServerLines([
      { name: 'stafford.json', payload: file(rawLine('a', 'A'), rawLine('b', 'B')) },
    ]);

    expect(report.added).toBe(2);
    expect(report.files).toEqual([
      { file: 'stafford.json', added: 2, skipped: 0, rejections: [] },
    ]);
    const listed = lines.listLines();
    expect(listed.map((l) => l.id).sort()).toEqual(['a', 'b']);
    expect(listed.every((l) => l.origin === 'server')).toBe(true);
    expect(store.map.size).toBe(0);
  });

  it('keeps server ids, so a line is reachable by the id in its file', async () => {
    const { seed, lines } = await load();
    seed.loadServerLines([{ name: 'a.json', payload: file(rawLine('a', 'A')) }]);
    expect(lines.getLine('a')?.name).toBe('A');
  });

  it('replaces the server lines on every load, leaving user lines alone', async () => {
    const first = await load();
    first.seed.loadServerLines([{ name: 'a.json', payload: file(rawLine('a', 'Old')) }]);
    const mine = first.lines.createLine({
      name: 'Mine',
      startFen: START_FEN,
      tree: treeFromMoves(['d4']),
      userColor: 'w',
    });

    vi.resetModules();
    const second = await load();
    second.seed.loadServerLines([
      { name: 'a.json', payload: file(rawLine('a', 'New'), rawLine('c', 'Added')) },
    ]);

    const names = second.lines.listLines().map((l) => l.name).sort();
    expect(names).toEqual(['Added', 'Mine', 'New']);
    expect(storedIds()).toEqual([mine.id]);
  });

  it('reports a broken line and loads the rest of the file', async () => {
    const { seed, lines } = await load();
    const report = seed.loadServerLines([
      {
        name: 'a.json',
        payload: file(rawLine('a', 'Good'), rawLine('b', 'Broken', { tree: treeFromMoves(['e5']) })),
      },
    ]);

    expect(report.added).toBe(1);
    expect(report.files[0]?.rejections).toHaveLength(1);
    expect(report.files[0]?.rejections[0]?.name).toBe('Broken');
    expect(lines.listLines().map((l) => l.name)).toEqual(['Good']);
  });

  it('reports a file it cannot read', async () => {
    const { seed } = await load();
    const report = seed.loadServerLines([{ name: 'junk.json', payload: '{ nope' }]);
    expect(report.added).toBe(0);
    expect(report.files[0]?.error).toMatch(/JSON/);
  });

  it('refuses a second line with an id already loaded', async () => {
    const { seed, lines } = await load();
    const report = seed.loadServerLines([
      { name: 'a.json', payload: file(rawLine('x', 'First')) },
      { name: 'b.json', payload: file(rawLine('x', 'Second')) },
    ]);

    expect(report.added).toBe(1);
    expect(report.files[1]?.rejections[0]?.reason).toMatch(/duplicate id/);
    expect(lines.listLines().map((l) => l.name)).toEqual(['First']);
  });

  it('exposes the last report through seedReport()', async () => {
    const { seed } = await load();
    expect(seed.seedReport()).toBeNull();
    const report = seed.loadServerLines([]);
    expect(seed.seedReport()).toBe(report);
  });
});

describe('editing server lines', () => {
  it('stores an edit as a user line under a new id and hides the original', async () => {
    const { seed, lines } = await load();
    seed.loadServerLines([{ name: 'a.json', payload: file(rawLine('a', 'Bundled')) }]);

    const edited = lines.updateLine('a', { name: 'Edited' });

    expect(edited).not.toBeNull();
    expect(edited?.id).not.toBe('a');
    expect(edited?.origin).toBeUndefined();
    expect(storedIds()).toEqual([edited?.id]);
    expect(hiddenIds()).toEqual(['a']);
    const listed = lines.listLines();
    expect(listed.map((l) => l.name)).toEqual(['Edited']);
    expect(lines.getLine('a')).toBeNull();
  });

  it('keeps the edited copy, and the original hidden, after a new build changes the file', async () => {
    const first = await load();
    first.seed.loadServerLines([{ name: 'a.json', payload: file(rawLine('a', 'Bundled')) }]);
    first.lines.updateLine('a', { name: 'Edited' });

    vi.resetModules();
    const second = await load();
    second.seed.loadServerLines([
      { name: 'a.json', payload: file(rawLine('a', 'Bundled v2', { tree: treeFromMoves(['d4']) })) },
    ]);

    expect(second.lines.listLines().map((l) => l.name)).toEqual(['Edited']);
  });

  it('moving a server line to another folder is an edit too', async () => {
    const { seed, lines } = await load();
    seed.loadServerLines([{ name: 'a.json', payload: file(rawLine('a', 'Bundled')) }]);

    const moved = lines.moveLineToFolder('a', 'Elsewhere');

    expect(moved?.id).not.toBe('a');
    expect(moved?.folder).toBe('Elsewhere');
    expect(lines.listLines()).toHaveLength(1);
  });

  it('renaming a folder copies its server lines into the new folder', async () => {
    const { seed, lines } = await load();
    seed.loadServerLines([
      {
        name: 'a.json',
        payload: file(rawLine('a', 'A'), rawLine('b', 'B', { folder: 'Other' })),
      },
    ]);

    const result = lines.renameFolder('Stafford', 'Stafford Gambit');

    expect(result).toEqual({ ok: true, moved: 1 });
    expect(hiddenIds()).toEqual(['a']);
    const listed = lines.listLines();
    expect(listed.map((l) => [l.name, l.folder, l.origin]).sort()).toEqual([
      ['A', 'Stafford Gambit', undefined],
      ['B', 'Other', 'server'],
    ]);
  });
});

describe('deleting server lines', () => {
  it('hides the line, for good, without touching the user store', async () => {
    const first = await load();
    first.seed.loadServerLines([{ name: 'a.json', payload: file(rawLine('a', 'A'), rawLine('b', 'B')) }]);

    expect(first.lines.deleteLine('a')).toBe(true);
    expect(first.lines.listLines().map((l) => l.id)).toEqual(['b']);
    expect(store.map.has(STORAGE_KEY)).toBe(false);

    vi.resetModules();
    const second = await load();
    second.seed.loadServerLines([{ name: 'a.json', payload: file(rawLine('a', 'A'), rawLine('b', 'B')) }]);
    expect(second.lines.listLines().map((l) => l.id)).toEqual(['b']);
  });

  it('brings hidden lines back when the store is cleared', async () => {
    const { seed, lines } = await load();
    seed.loadServerLines([{ name: 'a.json', payload: file(rawLine('a', 'A')) }]);
    lines.deleteLine('a');

    expect(lines.clearLines()).toBe(true);
    expect(lines.listLines().map((l) => l.id)).toEqual(['a']);
    expect(store.map.size).toBe(0);
  });

  it('reports an unknown id as not deleted', async () => {
    const { seed, lines } = await load();
    seed.loadServerLines([{ name: 'a.json', payload: file(rawLine('a', 'A')) }]);
    expect(lines.deleteLine('nope')).toBe(false);
  });
});

describe('export', () => {
  it('includes server lines, without their origin', async () => {
    const { seed, lines } = await load();
    seed.loadServerLines([{ name: 'a.json', payload: file(rawLine('a', 'A')) }]);

    const exported = lines.exportAll();
    expect(exported.lines.map((l) => l.id)).toEqual(['a']);
    const json = JSON.parse(
      (await import('./schema')).serialiseLinesFile(exported),
    ) as { lines: Record<string, unknown>[] };
    expect(json.lines[0]).not.toHaveProperty('origin');
  });
});
