import { beforeEach, describe, expect, it, vi } from 'vitest';
import { START_FEN } from '../chess/position';
import { LINES_SCHEMA_VERSION } from './schema';

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
  moves?: unknown;
  userColor?: unknown;
  folder?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

function file(...lines: RawLine[]): unknown {
  return { schemaVersion: LINES_SCHEMA_VERSION, exportedAt: 1_700_000_000_000, lines };
}

function rawLine(id: string, name: string, overrides: RawLine = {}): RawLine {
  return {
    id,
    name,
    startFen: START_FEN,
    moves: ['e4', 'e5'],
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
    const broken = rawLine('bad', 'Broken', { moves: ['e4', 'e5', 'Qxh8'] });
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
      { name: 'x.json', payload: file(rawLine('a', 'Bad FEN', { startFen: 'not a fen', moves: [] })) },
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
