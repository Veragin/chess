import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LINES_SCHEMA_VERSION, type Line, type LinesFile } from './schema';
import { START_FEN } from '../chess/position';

/**
 * Vitest runs in the `node` environment (see `vite.config.ts`), so there is no DOM and no
 * `localStorage`. `lines.ts` looks the global up lazily inside every accessor, which lets
 * us install the stub below per test.
 *
 * The module keeps a little session state (the in-memory fallback and its warning), so each
 * test re-imports it through `load()` after `vi.resetModules()` — that also doubles as a
 * "page reload" against the same underlying store.
 */
async function load() {
  return import('./lines');
}
type LinesModule = Awaited<ReturnType<typeof load>>;

const STORAGE_KEY = 'chess-trainer.lines.v1';

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
    if (this.throwOnSet) {
      const err = new Error('QuotaExceededError: storage is full');
      err.name = 'QuotaExceededError';
      throw err;
    }
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

/** Private-browsing behaviour: even *touching* `localStorage` throws. */
function installThrowingGetter(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    get() {
      throw new Error('SecurityError: access denied');
    },
    configurable: true,
  });
}

function uninstall(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value: undefined,
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
  moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'],
  userColor: 'w' as const,
};
const FRENCH = {
  name: 'French',
  startFen: START_FEN,
  moves: ['e4', 'e6'],
  userColor: 'b' as const,
  notes: 'as Black',
};

function stripIds(lines: Line[]): Record<string, unknown>[] {
  return lines.map((line) => {
    const copy: Record<string, unknown> = { ...line };
    delete copy.id;
    return copy;
  });
}

function storedRaw(): string | null {
  return store.map.get(STORAGE_KEY) ?? null;
}

// ---------------------------------------------------------------------------------------

describe('crypto.randomUUID', () => {
  it('is available in this Node runtime (no polyfill needed)', () => {
    expect(typeof globalThis.crypto.randomUUID).toBe('function');
  });
});

describe('CRUD round-trip', () => {
  it('creates, reads, updates and deletes through storage', async () => {
    const lines = await load();

    expect(lines.listLines()).toEqual([]);
    expect(lines.storageWarning()).toBeNull();

    const created = lines.createLine(ITALIAN);
    expect(created.id).toMatch(/\S/);
    expect(created.createdAt).toBe(created.updatedAt);
    expect(lines.getLine(created.id)).toEqual(created);
    expect(lines.listLines()).toEqual([created]);

    const updated = lines.updateLine(created.id, {
      name: 'Italian Game',
      moves: [...ITALIAN.moves, 'Bc5'],
      notes: 'giuoco piano',
      updatedAt: created.updatedAt + 1000,
    });
    expect(updated).not.toBeNull();
    expect(updated?.name).toBe('Italian Game');
    expect(updated?.moves).toHaveLength(6);
    expect(updated?.notes).toBe('giuoco piano');
    expect(updated?.createdAt).toBe(created.createdAt);
    expect(updated?.updatedAt).toBeGreaterThan(created.updatedAt);
    expect(lines.getLine(created.id)?.name).toBe('Italian Game');

    expect(lines.updateLine('nope', { name: 'x' })).toBeNull();
    expect(lines.getLine('nope')).toBeNull();
    expect(lines.deleteLine('nope')).toBe(false);

    expect(lines.deleteLine(created.id)).toBe(true);
    expect(lines.listLines()).toEqual([]);
    expect(lines.getLine(created.id)).toBeNull();
    expect(lines.storageWarning()).toBeNull();
  });

  it('persists across a module reload (a page reload)', async () => {
    const first = await load();
    const created = first.createLine(ITALIAN);

    vi.resetModules();
    const second = await load();
    expect(second.listLines()).toEqual([created]);
  });

  it('writes a single versioned key', async () => {
    const lines = await load();
    lines.createLine(ITALIAN);

    expect([...store.map.keys()]).toEqual([STORAGE_KEY]);
    const payload = JSON.parse(storedRaw() as string) as LinesFile;
    expect(payload.schemaVersion).toBe(LINES_SCHEMA_VERSION);
    expect(typeof payload.exportedAt).toBe('number');
    expect(payload.lines).toHaveLength(1);
  });

  it('does not leak the stored array into callers', async () => {
    const lines = await load();
    lines.createLine(ITALIAN);
    const listed = lines.listLines();
    listed.pop();
    expect(lines.listLines()).toHaveLength(1);
  });
});

describe('listLines ordering', () => {
  it('sorts by updatedAt descending', async () => {
    const lines = await load();
    const a = lines.createLine({ ...ITALIAN, name: 'A' });
    const b = lines.createLine({ ...ITALIAN, name: 'B' });
    const c = lines.createLine({ ...ITALIAN, name: 'C' });

    lines.updateLine(a.id, { updatedAt: 1_000 });
    lines.updateLine(b.id, { updatedAt: 3_000 });
    lines.updateLine(c.id, { updatedAt: 2_000 });

    expect(lines.listLines().map((l) => l.name)).toEqual(['B', 'C', 'A']);
  });
});

describe('export / import', () => {
  it('exportAll stamps the current schema version and an exportedAt', async () => {
    const lines = await load();
    lines.createLine(ITALIAN);
    const file = lines.exportAll();
    expect(file.schemaVersion).toBe(LINES_SCHEMA_VERSION);
    expect(file.exportedAt).toBeGreaterThan(0);
    expect(file.lines).toHaveLength(1);
  });

  it('exportAll -> importFile is lossless across a cleared store', async () => {
    const first = await load();
    first.createLine(ITALIAN);
    first.createLine(FRENCH);
    const exported = first.exportAll();
    const json = JSON.stringify(exported);

    // Simulate a wiped browser: empty store, fresh module.
    store.clear();
    vi.resetModules();
    const second = await load();
    expect(second.listLines()).toEqual([]);

    const result = second.importFile(json);
    expect(result).toEqual({ added: 2, skipped: 0, rejections: [] });

    const reimported = second.listLines();
    // Everything but the (deliberately regenerated) ids survives the round trip.
    expect(stripIds(reimported)).toEqual(stripIds(exported.lines));
    expect(reimported.map((l) => l.id).sort()).not.toEqual(
      exported.lines.map((l) => l.id).sort(),
    );
  });

  it('gives imported lines fresh ids so an import never clobbers an existing line', async () => {
    const lines = await load();
    const existing = lines.createLine(ITALIAN);
    const json = JSON.stringify(lines.exportAll());

    const result = lines.importFile(json);
    expect(result.added).toBe(1);

    const all = lines.listLines();
    expect(all).toHaveLength(2);
    expect(new Set(all.map((l) => l.id)).size).toBe(2);
    expect(lines.getLine(existing.id)).not.toBeNull();
    // Name collisions are tolerated.
    expect(all.filter((l) => l.name === 'Italian')).toHaveLength(2);
  });

  it('accepts a file whose ids collide with existing lines', async () => {
    const lines = await load();
    const existing = lines.createLine(ITALIAN);
    const file: LinesFile = {
      schemaVersion: LINES_SCHEMA_VERSION,
      exportedAt: Date.now(),
      lines: [{ ...existing, name: 'Copy' }],
    };
    expect(lines.importFile(JSON.stringify(file)).added).toBe(1);
    expect(lines.getLine(existing.id)?.name).toBe('Italian');
    expect(lines.listLines()).toHaveLength(2);
  });
});

describe('import validation', () => {
  /** Two pre-existing lines that every rejection test must leave untouched. */
  async function withExisting(): Promise<{ lines: LinesModule; before: Line[]; raw: string }> {
    const lines = await load();
    lines.createLine(ITALIAN);
    lines.createLine(FRENCH);
    return { lines, before: lines.listLines(), raw: storedRaw() as string };
  }

  function file(rawLines: unknown[], schemaVersion = LINES_SCHEMA_VERSION): string {
    return JSON.stringify({ schemaVersion, exportedAt: 123, lines: rawLines });
  }

  function goodRaw(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'imported-1',
      name: 'Imported',
      startFen: START_FEN,
      moves: ['e4', 'e5'],
      userColor: 'w',
      createdAt: 10,
      updatedAt: 20,
      ...over,
    };
  }

  it('rejects a future schema version and writes nothing', async () => {
    const { lines, before, raw } = await withExisting();
    const result = lines.importFile(file([goodRaw()], LINES_SCHEMA_VERSION + 1));

    expect(result.added).toBe(0);
    expect(result.error).toContain('newer version');
    expect(result.rejections).toEqual([]);
    expect(lines.listLines()).toEqual(before);
    expect(storedRaw()).toBe(raw);
  });

  it('rejects unparseable JSON and writes nothing', async () => {
    const { lines, before, raw } = await withExisting();
    const result = lines.importFile('{ this is not json');
    expect(result.added).toBe(0);
    expect(result.error).toContain('Not valid JSON');
    expect(lines.listLines()).toEqual(before);
    expect(storedRaw()).toBe(raw);
  });

  it.each([
    ['a missing lines array', JSON.stringify({ schemaVersion: 1, exportedAt: 1 })],
    ['lines that is not an array', JSON.stringify({ schemaVersion: 1, lines: 'e4' })],
    ['a bare array', '[]'],
    ['an empty string', ''],
  ])('imports nothing from %s', async (_label, json) => {
    const { lines, before, raw } = await withExisting();
    const result = lines.importFile(json);
    expect(result.added).toBe(0);
    expect(result.error).toBeTruthy();
    expect(lines.listLines()).toEqual(before);
    expect(storedRaw()).toBe(raw);
  });

  it('rejects a malformed FEN, naming the line, without corrupting existing data', async () => {
    const { lines, before, raw } = await withExisting();
    const result = lines.importFile(
      file([goodRaw({ name: 'Broken FEN', startFen: 'total nonsense' })]),
    );

    expect(result.added).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0]?.name).toBe('Broken FEN');
    expect(result.rejections[0]?.reason).toContain('start position');
    expect(lines.listLines()).toEqual(before);
    expect(storedRaw()).toBe(raw);
  });

  it('rejects a structurally valid but illegal start position', async () => {
    const { lines } = await withExisting();
    const result = lines.importFile(
      file([goodRaw({ name: 'No kings', startFen: '8/8/8/8/8/8/8/8 w - - 0 1', moves: [] })]),
    );
    expect(result.added).toBe(0);
    expect(result.rejections[0]?.reason).toContain('start position');
  });

  it('rejects a move sequence that is illegal at ply 3, without corrupting existing data', async () => {
    const { lines, before, raw } = await withExisting();
    // Black has no knight that can reach c3, so ply index 3 is unplayable.
    const result = lines.importFile(
      file([goodRaw({ name: 'Bad ply 3', moves: ['e4', 'e5', 'Nf3', 'Nc3'] })]),
    );

    expect(result.added).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.rejections[0]?.name).toBe('Bad ply 3');
    expect(result.rejections[0]?.reason).toContain('ply 3');
    expect(result.rejections[0]?.reason).toContain('Nc3');
    expect(lines.listLines()).toEqual(before);
    expect(storedRaw()).toBe(raw);
  });

  it('rejects malformed line objects with a per-line reason', async () => {
    const { lines } = await withExisting();
    const result = lines.importFile(
      file([
        goodRaw({ name: 'No colour', userColor: 'white' }),
        goodRaw({ name: 'Bad moves', moves: [1, 2] }),
        'not even an object',
      ]),
    );

    expect(result.added).toBe(0);
    expect(result.skipped).toBe(3);
    expect(result.rejections.map((r) => r.name)).toEqual([
      'No colour',
      'Bad moves',
      '(unnamed line #3)',
    ]);
    expect(result.rejections[0]?.reason).toContain('userColor');
    expect(result.rejections[1]?.reason).toContain('moves');
  });

  it('imports the good lines from a file that also contains bad ones', async () => {
    const { lines, before } = await withExisting();
    const result = lines.importFile(
      file([
        goodRaw({ name: 'Fine', moves: ['d4', 'd5'] }),
        goodRaw({ name: 'Bad ply 3', moves: ['e4', 'e5', 'Nf3', 'Nc3'] }),
        goodRaw({ name: 'Also fine', moves: [], userColor: 'b' }),
      ]),
    );

    expect(result.added).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.rejections[0]?.name).toBe('Bad ply 3');

    const names = lines.listLines().map((l) => l.name);
    expect(names).toContain('Fine');
    expect(names).toContain('Also fine');
    expect(names).not.toContain('Bad ply 3');
    // Existing lines are still there, untouched.
    for (const existing of before) {
      expect(lines.getLine(existing.id)).toEqual(existing);
    }
  });

  it('normalises imported SAN and preserves timestamps and notes', async () => {
    const lines = await load();
    const result = lines.importFile(
      file([goodRaw({ moves: ['e4', 'e5', 'Nf3'], notes: 'hello', createdAt: 7, updatedAt: 8 })]),
    );
    expect(result.added).toBe(1);
    const imported = lines.listLines()[0] as Line;
    expect(imported.moves).toEqual(['e4', 'e5', 'Nf3']);
    expect(imported.notes).toBe('hello');
    expect(imported.createdAt).toBe(7);
    expect(imported.updatedAt).toBe(8);
  });

  it('accepts a file with zero lines', async () => {
    const lines = await load();
    const result = lines.importFile(file([]));
    expect(result).toEqual({ added: 0, skipped: 0, rejections: [] });
    expect(lines.listLines()).toEqual([]);
  });
});

describe('corrupt stored payload', () => {
  it('reads as empty, warns, and leaves the stored blob untouched', async () => {
    store.map.set(STORAGE_KEY, '{ not json at all');
    const lines = await load();

    expect(lines.listLines()).toEqual([]);
    expect(lines.storageWarning()).toContain('could not be read');
    // The unreadable payload must survive the read — no repaired blob written over it.
    expect(storedRaw()).toBe('{ not json at all');
  });

  it('refuses a future schemaVersion in the store without rewriting it', async () => {
    const raw = JSON.stringify({
      schemaVersion: LINES_SCHEMA_VERSION + 1,
      exportedAt: 1,
      lines: [],
    });
    store.map.set(STORAGE_KEY, raw);
    const lines = await load();

    expect(lines.listLines()).toEqual([]);
    expect(lines.storageWarning()).toContain('newer version');
    expect(storedRaw()).toBe(raw);
  });

  it('drops individual junk lines on read but keeps the good ones and does not rewrite', async () => {
    const raw = JSON.stringify({
      schemaVersion: LINES_SCHEMA_VERSION,
      exportedAt: 1,
      lines: [
        { id: 'a', name: 'Good', startFen: START_FEN, moves: [], userColor: 'w', createdAt: 1, updatedAt: 1 },
        { id: 'b', name: 'Junk' },
      ],
    });
    store.map.set(STORAGE_KEY, raw);
    const lines = await load();

    expect(lines.listLines().map((l) => l.id)).toEqual(['a']);
    expect(lines.storageWarning()).toContain('Junk');
    expect(storedRaw()).toBe(raw);
  });
});

describe('localStorage failure modes', () => {
  it('degrades to an in-memory store when localStorage is absent', async () => {
    uninstall();
    const lines = await load();

    const created = lines.createLine(ITALIAN);
    expect(lines.listLines()).toEqual([created]);
    expect(lines.storageWarning()).toContain('unavailable');
  });

  it('degrades when merely touching localStorage throws (private mode)', async () => {
    installThrowingGetter();
    const lines = await load();

    expect(() => lines.listLines()).not.toThrow();
    const created = lines.createLine(FRENCH);
    expect(lines.getLine(created.id)).toEqual(created);
    expect(lines.storageWarning()).toContain('unavailable');
  });

  it('degrades when getItem throws', async () => {
    store.throwOnGet = true;
    const lines = await load();

    expect(lines.listLines()).toEqual([]);
    expect(lines.storageWarning()).toContain('unavailable');
    const created = lines.createLine(ITALIAN);
    expect(lines.listLines()).toEqual([created]);
  });

  it('degrades to memory with a warning when the quota is exceeded', async () => {
    const lines = await load();
    store.throwOnSet = true;

    let created: Line | undefined;
    expect(() => {
      created = lines.createLine(ITALIAN);
    }).not.toThrow();

    // The write did not reach localStorage...
    expect(storedRaw()).toBeNull();
    // ...but it is not silently lost either: the session keeps working and says why.
    expect(lines.storageWarning()).toContain('full');
    expect(lines.listLines()).toEqual([created]);

    // Subsequent mutations keep working against the in-memory copy.
    const second = lines.createLine(FRENCH);
    expect(lines.listLines().map((l) => l.name).sort()).toEqual(['French', 'Italian']);
    expect(lines.deleteLine(second.id)).toBe(true);
    expect(lines.listLines()).toEqual([created]);
  });

  it('reports a failed write on importFile instead of claiming success silently', async () => {
    const lines = await load();
    store.throwOnSet = true;

    const result = lines.importFile(
      JSON.stringify({
        schemaVersion: LINES_SCHEMA_VERSION,
        exportedAt: 1,
        lines: [
          {
            id: 'x',
            name: 'Imported',
            startFen: START_FEN,
            moves: ['e4'],
            userColor: 'w',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    );

    expect(result.added).toBe(1);
    expect(result.error).toContain('full');
    expect(storedRaw()).toBeNull();
    expect(lines.listLines()).toHaveLength(1);
  });
});

describe('folders', () => {
  it('round-trips a folder path, normalising it on the way in', async () => {
    const lines = await load();
    const created = lines.createLine({ ...ITALIAN, folder: '  White / Italian  ' });

    expect(created.folder).toBe('White/Italian');
    expect(lines.getLine(created.id)?.folder).toBe('White/Italian');

    vi.resetModules();
    const reloaded = await load();
    expect(reloaded.getLine(created.id)?.folder).toBe('White/Italian');
  });

  it('omits the field entirely rather than storing an empty folder', async () => {
    const lines = await load();
    const created = lines.createLine({ ...ITALIAN, folder: '   ' });

    expect('folder' in created).toBe(false);
    const payload = JSON.parse(storedRaw() as string) as LinesFile;
    expect('folder' in (payload.lines[0] as object)).toBe(false);
  });

  it('moves a line between folders, and back to the root with an empty string', async () => {
    const lines = await load();
    const created = lines.createLine({ ...ITALIAN, folder: 'White' });

    expect(lines.updateLine(created.id, { folder: 'Black/Sicilian' })?.folder).toBe(
      'Black/Sicilian',
    );
    const rooted = lines.updateLine(created.id, { folder: '' });
    expect(rooted).not.toBeNull();
    expect('folder' in (rooted as object)).toBe(false);
    expect(lines.getLine(created.id)?.folder).toBeUndefined();
  });

  it('leaves the folder alone when a patch does not mention it', async () => {
    const lines = await load();
    const created = lines.createLine({ ...ITALIAN, folder: 'White' });

    expect(lines.updateLine(created.id, { name: 'Renamed' })?.folder).toBe('White');
  });

  it('renames a folder, carrying its subtree and leaving siblings alone', async () => {
    const lines = await load();
    const sicilian = lines.createLine({ ...FRENCH, name: 'Najdorf', folder: 'Black/Sicilian' });
    const najdorf = lines.createLine({
      ...FRENCH,
      name: 'Poisoned pawn',
      folder: 'Black/Sicilian/Najdorf',
    });
    const caro = lines.createLine({ ...FRENCH, name: 'Caro', folder: 'Black/Caro-Kann' });
    const white = lines.createLine({ ...ITALIAN, folder: 'White' });

    const result = lines.renameFolder('Black/Sicilian', 'Black/Open Sicilian');
    expect(result).toEqual({ ok: true, moved: 2 });

    expect(lines.getLine(sicilian.id)?.folder).toBe('Black/Open Sicilian');
    expect(lines.getLine(najdorf.id)?.folder).toBe('Black/Open Sicilian/Najdorf');
    expect(lines.getLine(caro.id)?.folder).toBe('Black/Caro-Kann');
    expect(lines.getLine(white.id)?.folder).toBe('White');
  });

  it('does not touch updatedAt when refiling lines', async () => {
    const lines = await load();
    const created = lines.createLine({ ...ITALIAN, folder: 'White' });
    lines.updateLine(created.id, { updatedAt: 5_000 });

    lines.renameFolder('White', 'Białe');
    expect(lines.getLine(created.id)?.updatedAt).toBe(5_000);

    lines.moveLineToFolder(created.id, 'Black');
    expect(lines.getLine(created.id)?.folder).toBe('Black');
    expect(lines.getLine(created.id)?.updatedAt).toBe(5_000);
  });

  it('refuses to move a folder inside itself, writing nothing', async () => {
    const lines = await load();
    const created = lines.createLine({ ...ITALIAN, folder: 'Black' });

    const result = lines.renameFolder('Black', 'Black/Sicilian');
    expect(result.ok).toBe(false);
    expect(result.moved).toBe(0);
    expect(result.error).toMatch(/inside itself/i);
    expect(lines.getLine(created.id)?.folder).toBe('Black');
  });

  it('merges into an existing folder rather than inventing a second one', async () => {
    const lines = await load();
    const a = lines.createLine({ ...ITALIAN, name: 'A', folder: 'Italian' });
    const b = lines.createLine({ ...ITALIAN, name: 'B', folder: 'Italiann' });

    expect(lines.renameFolder('Italiann', 'Italian').moved).toBe(1);
    expect(lines.getLine(a.id)?.folder).toBe('Italian');
    expect(lines.getLine(b.id)?.folder).toBe('Italian');
  });

  it('reports a rename that only reached memory', async () => {
    const lines = await load();
    lines.createLine({ ...ITALIAN, folder: 'White' });
    store.throwOnSet = true;

    const result = lines.renameFolder('White', 'Black');
    expect(result.ok).toBe(true);
    expect(result.moved).toBe(1);
    expect(result.error).toContain('full');
  });

  it('survives a hand-edited store with a non-string folder', async () => {
    store.map.set(
      STORAGE_KEY,
      JSON.stringify({
        schemaVersion: LINES_SCHEMA_VERSION,
        exportedAt: 1,
        lines: [
          {
            id: 'a',
            name: 'Odd',
            startFen: START_FEN,
            moves: ['e4'],
            userColor: 'w',
            folder: 42,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    );
    const lines = await load();

    // The line is rejected rather than silently refiled: a wrong *type* is a broken payload,
    // not a folder the user typed.
    expect(lines.listLines()).toEqual([]);
    expect(lines.storageWarning()).toContain('folder');
  });

  it('carries folders through export and import', async () => {
    const first = await load();
    first.createLine({ ...ITALIAN, folder: 'White/Italian' });
    const json = JSON.stringify(first.exportAll());

    vi.resetModules();
    store.map.clear();
    const second = await load();
    expect(second.importFile(json).added).toBe(1);
    expect(second.listLines()[0]?.folder).toBe('White/Italian');
  });
});
