import { beforeEach, describe, expect, it, vi } from 'vitest';
import { START_FEN } from '../chess/position';
import { LINES_SCHEMA_VERSION } from './schema';
import { treeFromMoves, type MoveTree } from '../chess/tree';
import { encodeTree } from './treeFormat';

/**
 * Same setup as `lines.test.ts`: vitest runs in the `node` environment, so `localStorage` is a
 * stub installed per test, and both modules are re-imported through `load()` after
 * `vi.resetModules()` — which doubles as "the user reloaded the page" against the same store.
 */
async function load() {
  const seed = await import('./seed');
  const lines = await import('./lines');
  return { seed, lines };
}

const STORAGE_KEY = 'chess-trainer.lines.v1';
const SEED_KEY = 'chess-trainer.seededLines.v1';

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

function seededKeys(): string[] {
  const raw = store.map.get(SEED_KEY);
  return raw === undefined ? [] : (JSON.parse(raw) as string[]);
}

// ---------------------------------------------------------------------------------------

describe('seeding bundled files', () => {
  it('adds every line of a file and records what it handed over', async () => {
    const { seed, lines } = await load();

    const report = seed.seedFromFiles([
      { name: 'stafford.json', payload: file(rawLine('a', 'One'), rawLine('b', 'Two')) },
    ]);

    expect(report.added).toBe(2);
    expect(report.files).toEqual([
      { file: 'stafford.json', added: 2, skipped: 0, rejections: [] },
    ]);
    expect(lines.listLines().map((l) => l.name).sort()).toEqual(['One', 'Two']);
    expect(lines.listLines().every((l) => l.folder === 'Stafford')).toBe(true);
    expect(seededKeys().sort()).toEqual(['stafford.json::a', 'stafford.json::b']);
    // Fresh ids, exactly as an import gets: the file's ids never land in the store.
    expect(lines.listLines().map((l) => l.id)).not.toContain('a');
  });

  it('is what `seedReport()` returns afterwards', async () => {
    const { seed } = await load();
    expect(seed.seedReport()).toBeNull();
    const report = seed.seedFromFiles([{ name: 'x.json', payload: file(rawLine('a', 'One')) }]);
    expect(seed.seedReport()).toEqual(report);
  });

  it('adds nothing on a second run, in the same session or after a reload', async () => {
    const first = await load();
    const payload = file(rawLine('a', 'One'));
    first.seed.seedFromFiles([{ name: 'stafford.json', payload }]);
    first.seed.seedFromFiles([{ name: 'stafford.json', payload }]);
    expect(first.lines.listLines()).toHaveLength(1);

    vi.resetModules();
    const second = await load();
    const report = second.seed.seedFromFiles([{ name: 'stafford.json', payload }]);
    expect(report.added).toBe(0);
    expect(second.lines.listLines()).toHaveLength(1);
  });

  it('leaves a seeded line deleted once the user deletes it', async () => {
    const first = await load();
    const payload = file(rawLine('a', 'One'));
    first.seed.seedFromFiles([{ name: 'stafford.json', payload }]);
    const [line] = first.lines.listLines();
    expect(first.lines.deleteLine((line as { id: string }).id)).toBe(true);

    vi.resetModules();
    const second = await load();
    second.seed.seedFromFiles([{ name: 'stafford.json', payload }]);
    expect(second.lines.listLines()).toEqual([]);
  });

  it('keeps the user’s edits to a seeded line', async () => {
    const first = await load();
    const payload = file(rawLine('a', 'One'));
    first.seed.seedFromFiles([{ name: 'stafford.json', payload }]);
    const [line] = first.lines.listLines();
    first.lines.updateLine((line as { id: string }).id, { name: 'Renamed', folder: 'Mine' });

    vi.resetModules();
    const second = await load();
    second.seed.seedFromFiles([{ name: 'stafford.json', payload }]);
    expect(second.lines.listLines().map((l) => l.name)).toEqual(['Renamed']);
  });

  it('picks up a line added to a file later, without re-adding the old ones', async () => {
    const first = await load();
    first.seed.seedFromFiles([{ name: 'stafford.json', payload: file(rawLine('a', 'One')) }]);

    vi.resetModules();
    const second = await load();
    const report = second.seed.seedFromFiles([
      { name: 'stafford.json', payload: file(rawLine('a', 'One'), rawLine('b', 'Two')) },
    ]);
    expect(report.added).toBe(1);
    expect(second.lines.listLines().map((l) => l.name).sort()).toEqual(['One', 'Two']);
  });

  it('picks up a whole new file', async () => {
    const first = await load();
    first.seed.seedFromFiles([{ name: 'stafford.json', payload: file(rawLine('a', 'One')) }]);

    vi.resetModules();
    const second = await load();
    const report = second.seed.seedFromFiles([
      { name: 'stafford.json', payload: file(rawLine('a', 'One')) },
      { name: 'caro.json', payload: file(rawLine('a', 'Caro')) },
    ]);
    // Same `id` in a different file is a different line: the key is scoped by file name.
    expect(report.added).toBe(1);
    expect(second.lines.listLines().map((l) => l.name).sort()).toEqual(['Caro', 'One']);
  });

  it('treats a file with no ids as positional, and still seeds it once', async () => {
    const first = await load();
    const payload = file(
      rawLine('', 'One', { id: undefined }),
      rawLine('', 'Two', { id: undefined }),
    );
    // No `id` fails `validateLineShape`, so such a file is rejected line by line rather than
    // silently half-imported — the same answer the manual import gives.
    const report = first.seed.seedFromFiles([{ name: 'hand.json', payload }]);
    expect(report.added).toBe(0);
    expect(report.files[0]?.skipped).toBe(2);
    expect(report.files[0]?.rejections[0]?.reason).toMatch(/"id"/);
    expect(first.lines.listLines()).toEqual([]);
  });

  it('leaves the store untouched when a file is not a lines export', async () => {
    const { seed, lines } = await load();
    const report = seed.seedFromFiles([
      { name: 'junk.json', payload: { hello: 'world' } },
      { name: 'future.json', payload: { schemaVersion: 99, lines: [] } },
    ]);

    expect(report.added).toBe(0);
    expect(report.files[0]?.error).toMatch(/schemaVersion/);
    expect(report.files[1]?.error).toMatch(/newer version/);
    expect(lines.listLines()).toEqual([]);
    expect(store.map.has(STORAGE_KEY)).toBe(false);
  });

  it('rejects an unplayable line, seeds its healthy siblings, and retries it once fixed', async () => {
    const first = await load();
    const broken = rawLine('bad', 'Broken', { tree: treeFromMoves(['e4', 'e5', 'Qxh8']) });
    const report = first.seed.seedFromFiles([
      { name: 'stafford.json', payload: file(rawLine('a', 'One'), broken) },
    ]);

    expect(report.added).toBe(1);
    expect(report.files[0]?.rejections).toEqual([
      { name: 'Broken', reason: expect.stringContaining('illegal move "Qxh8"') },
    ]);
    expect(first.lines.listLines().map((l) => l.name)).toEqual(['One']);
    // A rejection is never recorded as delivered.
    expect(seededKeys()).toEqual(['stafford.json::a']);

    vi.resetModules();
    const second = await load();
    const fixed = second.seed.seedFromFiles([
      { name: 'stafford.json', payload: file(rawLine('a', 'One'), rawLine('bad', 'Fixed')) },
    ]);
    expect(fixed.added).toBe(1);
    expect(second.lines.listLines().map((l) => l.name).sort()).toEqual(['Fixed', 'One']);
  });

  it('rejects an illegal start position', async () => {
    const { seed, lines } = await load();
    const report = seed.seedFromFiles([
      { name: 'x.json', payload: file(rawLine('a', 'Bad FEN', { startFen: 'not a fen', tree: treeFromMoves([]) })) },
    ]);
    expect(report.added).toBe(0);
    expect(report.files[0]?.rejections[0]?.reason).toMatch(/illegal start position/);
    expect(lines.listLines()).toEqual([]);
  });

  it('does not duplicate identical lines when the seed record is lost', async () => {
    const first = await load();
    const payload = file(rawLine('a', 'One'));
    first.seed.seedFromFiles([{ name: 'stafford.json', payload }]);

    // e.g. the user cleared that one key, or an older build wrote the lines without a record.
    store.map.delete(SEED_KEY);
    vi.resetModules();
    const second = await load();
    const report = second.seed.seedFromFiles([{ name: 'stafford.json', payload }]);

    expect(report.added).toBe(0);
    expect(second.lines.listLines()).toHaveLength(1);
    // The record is rebuilt, so the signature guard is not load-bearing next time either.
    expect(seededKeys()).toEqual(['stafford.json::a']);
  });

  it('seeds a schema v1 file as single-branch trees', async () => {
    const { seed, lines } = await load();
    const v1 = { ...rawLine('a', 'Old'), tree: undefined, moves: ['e4', 'e5', 'Ng1f3'] };
    const report = seed.seedFromFiles([
      { name: 'old.json', payload: { schemaVersion: 1, exportedAt: 1, lines: [v1] } },
    ]);
    expect(report.added).toBe(1);
    expect(lines.listLines()[0]?.tree).toEqual(treeFromMoves(['e4', 'e5', 'Nf3']));
  });

  it('compares content by tree, ignoring sibling order and comments', async () => {
    const first = await load();
    const tree = [
      {
        san: 'e4',
        next: [
          { san: 'e5', comment: 'a', next: [] },
          { san: 'c5', next: [] },
        ],
      },
    ];
    first.seed.seedFromFiles([{ name: 'a.json', payload: file(rawLine('a', 'One', { tree })) }]);

    store.map.delete(SEED_KEY);
    vi.resetModules();
    const second = await load();
    const reordered = [{ san: 'e4', next: [{ san: 'c5', next: [] }, { san: 'e5', next: [] }] }];
    const report = second.seed.seedFromFiles([
      { name: 'a.json', payload: file(rawLine('a', 'One', { tree: reordered })) },
    ]);
    expect(report.added).toBe(0);
    expect(second.lines.listLines()).toHaveLength(1);
  });

  describe('rewritten files (seed aliases)', () => {
    const joined = [{ san: 'e4', next: [{ san: 'e5', next: [] }, { san: 'c5', next: [] }] }];
    const v1 = (): unknown =>
      file(
        rawLine('a', 'One'),
        rawLine('b', 'Two', { tree: treeFromMoves(['e4', 'c5']) }),
      );
    const v2 = (): unknown => file(rawLine('n', 'Joined', { tree: joined }));

    it('does not offer a joined line again when every line it replaces was handed over', async () => {
      const first = await load();
      first.seed.seedFromFiles([{ name: 'stafford.json', payload: v1() }]);

      vi.resetModules();
      const second = await load();
      const report = second.seed.seedFromFiles([{ name: 'stafford.json', payload: v2() }], {
        'stafford.json::n': ['stafford.json::a', 'stafford.json::b'],
      });
      expect(report.added).toBe(0);
      expect(second.lines.listLines().map((l) => l.name).sort()).toEqual(['One', 'Two']);
      // Recorded under its own key, so it stays handed over without the aliases too.
      expect(seededKeys()).toContain('stafford.json::n');
    });

    it('offers it when only some of the lines it replaces were handed over', async () => {
      const first = await load();
      first.seed.seedFromFiles([{ name: 'stafford.json', payload: file(rawLine('a', 'One')) }]);

      vi.resetModules();
      const second = await load();
      const report = second.seed.seedFromFiles([{ name: 'stafford.json', payload: v2() }], {
        'stafford.json::n': ['stafford.json::a', 'stafford.json::b'],
      });
      expect(report.added).toBe(1);
    });

    it('follows aliases across several rewrites', async () => {
      const first = await load();
      first.seed.seedFromFiles([{ name: 'stafford.json', payload: v1() }]);

      vi.resetModules();
      const second = await load();
      const report = second.seed.seedFromFiles(
        [{ name: 'other.json', payload: file(rawLine('m', 'Moved', { tree: joined })) }],
        {
          'other.json::m': ['stafford.json::n'],
          'stafford.json::n': ['stafford.json::a', 'stafford.json::b'],
        },
      );
      expect(report.added).toBe(0);
    });

    it('seeds a new user normally, and survives an alias cycle', async () => {
      const { seed, lines } = await load();
      const report = seed.seedFromFiles([{ name: 'stafford.json', payload: v2() }], {
        'stafford.json::n': ['stafford.json::x'],
        'stafford.json::x': ['stafford.json::n'],
      });
      expect(report.added).toBe(1);
      expect(lines.listLines().map((l) => l.name)).toEqual(['Joined']);
    });
  });

  it('writes no seed record when storage is unavailable', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const { seed, lines } = await load();
    const report = seed.seedFromFiles([{ name: 'x.json', payload: file(rawLine('a', 'One')) }]);

    // The lines still arrive — in memory, for this session — and the write problem is reported.
    expect(report.added).toBe(1);
    expect(report.error).toMatch(/storage/i);
    expect(lines.listLines()).toHaveLength(1);
  });

  it('does no work at all for an empty file list', async () => {
    const { seed } = await load();
    const report = seed.seedFromFiles([]);
    expect(report).toEqual({ added: 0, files: [] });
    expect(store.map.has(STORAGE_KEY)).toBe(false);
    expect(store.map.has(SEED_KEY)).toBe(false);
  });
});

describe('customLines', () => {
  const files = [{ name: 'stafford.json', payload: file(rawLine('a', 'One'), rawLine('b', 'Two')) }];

  it('counts nothing when every stored line came from a bundled file', async () => {
    const { seed, lines } = await load();
    seed.seedFromFiles(files);

    expect(seed.customLines(lines.listLines(), files)).toEqual([]);
  });

  it('counts what the user wrote or imported', async () => {
    const { seed, lines } = await load();
    seed.seedFromFiles(files);
    lines.createLine({
      name: 'Mine',
      startFen: START_FEN,
      tree: treeFromMoves(['d4']),
      userColor: 'w',
    });

    expect(seed.customLines(lines.listLines(), files).map((l) => l.name)).toEqual(['Mine']);
  });

  it('counts an edited seeded line — the edit is what a reset would destroy', async () => {
    const { seed, lines } = await load();
    seed.seedFromFiles(files);
    const [line] = lines.listLines();
    lines.updateLine((line as { id: string }).id, { name: 'Renamed' });

    expect(seed.customLines(lines.listLines(), files).map((l) => l.name)).toEqual(['Renamed']);
  });

  it('ignores ids, timestamps and unreadable files', async () => {
    const { seed, lines } = await load();
    seed.seedFromFiles(files);
    // Fresh ids and a later `updatedAt` are what any seeded line has; neither makes it custom.
    const [line] = lines.listLines();
    lines.updateLine((line as { id: string }).id, { updatedAt: 9_999_999_999_999 });

    expect(
      seed.customLines(lines.listLines(), [...files, { name: 'broken.json', payload: 'not json' }]),
    ).toEqual([]);
  });
});

describe('clearSeedRecord', () => {
  it('lets the next load seed every bundled line again', async () => {
    const first = await load();
    const payload = file(rawLine('a', 'One'));
    first.seed.seedFromFiles([{ name: 'stafford.json', payload }]);

    // What "clear data" does: the repertoire and the record of what was handed over.
    expect(first.lines.clearLines()).toBe(true);
    expect(first.seed.clearSeedRecord()).toBe(true);
    expect(store.map.has(SEED_KEY)).toBe(false);
    expect(first.seed.seedReport()).toBeNull();

    vi.resetModules();
    const second = await load();
    const report = second.seed.seedFromFiles([{ name: 'stafford.json', payload }]);
    expect(report.added).toBe(1);
    expect(second.lines.listLines().map((l) => l.name)).toEqual(['One']);
  });

  it('reports failure when storage is unavailable', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const { seed } = await load();
    expect(seed.clearSeedRecord()).toBe(false);
  });
});
