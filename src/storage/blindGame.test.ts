import { beforeEach, describe, expect, it, vi } from 'vitest';
import { START_FEN } from '../chess/position';

/**
 * Vitest runs in the `node` environment (see `vite.config.ts`), so there is no DOM and no
 * `localStorage`. `blindGame.ts` looks the global up lazily inside every accessor, which lets
 * us install the stub below per test.
 *
 * The module keeps session state (the in-memory fallback and its warning), so each test
 * re-imports it through `load()` after `vi.resetModules()` — which doubles as a "page reload"
 * against the same underlying store.
 */
async function load() {
  return import('./blindGame');
}

const STORAGE_KEY = 'chess-trainer.blindGame.v1';

class StubStorage {
  readonly map = new Map<string, string>();
  throwOnGet = false;
  throwOnSet = false;
  throwOnRemove = false;

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
    if (this.throwOnRemove) throw new Error('SecurityError: storage is disabled');
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

const ITALIAN = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'];

function storedRaw(): string | null {
  return store.map.get(STORAGE_KEY) ?? null;
}

function put(payload: unknown): void {
  store.map.set(STORAGE_KEY, typeof payload === 'string' ? payload : JSON.stringify(payload));
}

// ---------------------------------------------------------------------------------------

describe('save / load round-trip', () => {
  it('offers nothing when the store is empty', async () => {
    const m = await load();
    expect(m.loadBlindGame()).toBeNull();
    expect(m.blindStorageWarning()).toBeNull();
  });

  it('round-trips a game through storage, surviving a module reload', async () => {
    const first = await load();
    expect(
      first.saveBlindGame({
        startFen: START_FEN,
        moves: ITALIAN,
        revealed: false,
        updatedAt: 1_700_000_000_000,
      }),
    ).toBe(true);
    expect(first.blindStorageWarning()).toBeNull();

    // "Reload the page": fresh module instance, same underlying store.
    vi.resetModules();
    const second = await load();
    expect(second.loadBlindGame()).toEqual({
      startFen: START_FEN,
      moves: ITALIAN,
      revealed: false,
      updatedAt: 1_700_000_000_000,
    });
  });

  it('persists the reveal state alongside the moves', async () => {
    const m = await load();
    m.saveBlindGame({ startFen: START_FEN, moves: ['e4'], revealed: true, updatedAt: 1 });
    expect(m.loadBlindGame()?.revealed).toBe(true);
  });

  it('normalises SAN through chess.js so the offered moves are replayable verbatim', async () => {
    const m = await load();
    // Sloppy-but-legal input the UI could hand over.
    m.saveBlindGame({ startFen: START_FEN, moves: ['e4', 'e5', 'Nf3'], revealed: false, updatedAt: 1 });
    put({ version: 1, startFen: START_FEN, moves: ['e4', 'e5', 'Ng1f3'], revealed: false, updatedAt: 1 });
    vi.resetModules();
    const reloaded = await load();
    expect(reloaded.loadBlindGame()?.moves).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('stores a versioned payload under its own key, distinct from the lines store', async () => {
    const m = await load();
    m.saveBlindGame({ startFen: START_FEN, moves: [], revealed: false, updatedAt: 7 });
    const raw = storedRaw();
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({
      version: m.BLIND_GAME_VERSION,
      startFen: START_FEN,
      moves: [],
      revealed: false,
      updatedAt: 7,
    });
    expect(store.map.has('chess-trainer.lines.v1')).toBe(false);
  });

  it('overwrites the previous record — there is only ever one saved game', async () => {
    const m = await load();
    m.saveBlindGame({ startFen: START_FEN, moves: ['e4'], revealed: false, updatedAt: 1 });
    m.saveBlindGame({ startFen: START_FEN, moves: ['d4'], revealed: false, updatedAt: 2 });
    expect(store.map.size).toBe(1);
    expect(m.loadBlindGame()?.moves).toEqual(['d4']);
  });

  it('resumes a game that started from a custom position', async () => {
    const m = await load();
    // Black to move, move 14: a mid-game FEN.
    const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 5 4';
    expect(m.saveBlindGame({ startFen: fen, moves: ['Bc5'], revealed: false, updatedAt: 1 })).toBe(
      true,
    );
    expect(m.loadBlindGame()).toEqual({
      startFen: fen,
      moves: ['Bc5'],
      revealed: false,
      updatedAt: 1,
    });
  });
});

describe('hasStoredBlindGame', () => {
  it('is false on an empty store and true once a game is saved', async () => {
    const m = await load();
    expect(m.hasStoredBlindGame()).toBe(false);
    m.saveBlindGame({ startFen: START_FEN, moves: ['e4'], revealed: false, updatedAt: 1 });
    expect(m.hasStoredBlindGame()).toBe(true);
    m.clearBlindGame();
    expect(m.hasStoredBlindGame()).toBe(false);
  });

  it('is true for a record too corrupt to resume — "clear data" still deletes it', async () => {
    store.map.set(STORAGE_KEY, '{not json');
    const m = await load();
    expect(m.hasStoredBlindGame()).toBe(true);
    expect(m.loadBlindGame()).toBeNull();
  });

  it('does not raise a warning about a game the user never tried to resume', async () => {
    store.map.set(STORAGE_KEY, '{not json');
    const m = await load();
    m.hasStoredBlindGame();
    expect(m.blindStorageWarning()).toBeNull();
  });
});

describe('clearBlindGame', () => {
  it('removes the record so nothing is offered afterwards', async () => {
    const m = await load();
    m.saveBlindGame({ startFen: START_FEN, moves: ['e4'], revealed: false, updatedAt: 1 });
    expect(m.clearBlindGame()).toBe(true);
    expect(storedRaw()).toBeNull();
    expect(m.loadBlindGame()).toBeNull();
    expect(m.blindStorageWarning()).toBeNull();
  });
});

describe('corrupt records produce "no resume available", never a crash', () => {
  const CASES: { name: string; payload: unknown }[] = [
    { name: 'unparseable JSON', payload: '{not json' },
    { name: 'a JSON scalar', payload: '42' },
    { name: 'a JSON array', payload: '[]' },
    { name: 'a missing version', payload: { startFen: START_FEN, moves: [] } },
    { name: 'a future version', payload: { version: 99, startFen: START_FEN, moves: [] } },
    { name: 'a missing startFen', payload: { version: 1, moves: [] } },
    { name: 'a non-string startFen', payload: { version: 1, startFen: 5, moves: [] } },
    { name: 'a malformed FEN', payload: { version: 1, startFen: 'not a fen', moves: [] } },
    {
      name: 'an illegal FEN (no black king)',
      payload: { version: 1, startFen: '8/8/8/8/8/8/8/K7 w - - 0 1', moves: [] },
    },
    { name: 'a missing moves array', payload: { version: 1, startFen: START_FEN } },
    { name: 'moves that are not strings', payload: { version: 1, startFen: START_FEN, moves: [4] } },
    {
      name: 'a move that is illegal at ply 2',
      payload: { version: 1, startFen: START_FEN, moves: ['e4', 'e5', 'Qh8'] },
    },
    {
      name: 'a non-boolean reveal flag',
      payload: { version: 1, startFen: START_FEN, moves: [], revealed: 'yes' },
    },
  ];

  for (const testCase of CASES) {
    it(`rejects ${testCase.name}`, async () => {
      put(testCase.payload);
      const m = await load();
      expect(m.loadBlindGame()).toBeNull();
      expect(m.blindStorageWarning()).toMatch(/No resume available/);
    });
  }

  it('leaves the corrupt payload on disk — a read never writes', async () => {
    put({ version: 1, startFen: START_FEN, moves: ['e4', 'Qh8'] });
    const before = storedRaw();
    const m = await load();
    expect(m.loadBlindGame()).toBeNull();
    expect(storedRaw()).toBe(before);
  });

  it('names the illegal move so the warning is actionable', async () => {
    put({ version: 1, startFen: START_FEN, moves: ['e4', 'e5', 'Qh8'] });
    const m = await load();
    m.loadBlindGame();
    expect(m.blindStorageWarning()).toContain('Qh8');
    expect(m.blindStorageWarning()).toContain('ply 2');
  });
});

describe('parseBlindGameRecord', () => {
  it('accepts a well-formed payload and defaults the reveal flag to false', async () => {
    const m = await load();
    const parsed = m.parseBlindGameRecord({
      version: 1,
      startFen: START_FEN,
      moves: ['e4'],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.record.revealed).toBe(false);
      expect(parsed.record.updatedAt).toBe(0);
    }
  });

  it('never throws, whatever it is handed', async () => {
    const m = await load();
    for (const junk of [null, undefined, 0, '', [], NaN, Symbol('x')]) {
      expect(() => m.parseBlindGameRecord(junk)).not.toThrow();
      expect(m.parseBlindGameRecord(junk).ok).toBe(false);
    }
  });
});

describe('save refuses an invalid record rather than writing it', () => {
  it('rejects an illegal start position', async () => {
    const m = await load();
    expect(
      m.saveBlindGame({ startFen: 'garbage', moves: [], revealed: false, updatedAt: 1 }),
    ).toBe(false);
    expect(storedRaw()).toBeNull();
    expect(m.blindStorageWarning()).toContain('could not be saved');
  });

  it('rejects a move list that does not replay', async () => {
    const m = await load();
    expect(
      m.saveBlindGame({ startFen: START_FEN, moves: ['e4', 'e4'], revealed: false, updatedAt: 1 }),
    ).toBe(false);
    expect(storedRaw()).toBeNull();
  });

  it('does not clobber a good record with a bad save', async () => {
    const m = await load();
    m.saveBlindGame({ startFen: START_FEN, moves: ['e4'], revealed: false, updatedAt: 1 });
    m.saveBlindGame({ startFen: START_FEN, moves: ['e4', 'e4'], revealed: false, updatedAt: 2 });
    expect(m.loadBlindGame()?.moves).toEqual(['e4']);
  });
});

describe('degrades to memory instead of throwing (README §8.10)', () => {
  it('survives localStorage being absent entirely', async () => {
    uninstall();
    const m = await load();
    expect(m.loadBlindGame()).toBeNull();
    expect(m.saveBlindGame({ startFen: START_FEN, moves: ['e4'], revealed: false, updatedAt: 1 }))
      .toBe(false);
    // In-memory copy is still readable within the session.
    expect(m.loadBlindGame()?.moves).toEqual(['e4']);
    expect(m.blindStorageWarning()).toMatch(/storage is unavailable/i);
  });

  it('survives a localStorage getter that throws (private browsing)', async () => {
    installThrowingGetter();
    const m = await load();
    expect(() => m.loadBlindGame()).not.toThrow();
    expect(m.loadBlindGame()).toBeNull();
    expect(m.saveBlindGame({ startFen: START_FEN, moves: [], revealed: false, updatedAt: 1 }))
      .toBe(false);
    expect(m.blindStorageWarning()).toMatch(/storage is unavailable/i);
    install(store);
  });

  it('survives getItem throwing', async () => {
    store.throwOnGet = true;
    const m = await load();
    expect(m.loadBlindGame()).toBeNull();
    expect(m.blindStorageWarning()).toMatch(/storage is unavailable/i);
  });

  it('reports a quota-exceeded write and keeps the game in memory', async () => {
    store.throwOnSet = true;
    const m = await load();
    expect(m.saveBlindGame({ startFen: START_FEN, moves: ['e4'], revealed: false, updatedAt: 1 }))
      .toBe(false);
    expect(m.blindStorageWarning()).toMatch(/rejected the write/i);
    // The move is not lost for this session, it just will not survive a reload.
    expect(m.loadBlindGame()?.moves).toEqual(['e4']);
    expect(storedRaw()).toBeNull();
  });

  it('keeps using the memory copy after a failed write, even if storage recovers', async () => {
    store.throwOnSet = true;
    const m = await load();
    m.saveBlindGame({ startFen: START_FEN, moves: ['e4'], revealed: false, updatedAt: 1 });
    store.throwOnSet = false;
    m.saveBlindGame({ startFen: START_FEN, moves: ['d4'], revealed: false, updatedAt: 2 });
    expect(m.loadBlindGame()?.moves).toEqual(['d4']);
  });

  it('survives removeItem throwing', async () => {
    const m = await load();
    m.saveBlindGame({ startFen: START_FEN, moves: ['e4'], revealed: false, updatedAt: 1 });
    store.throwOnRemove = true;
    expect(m.clearBlindGame()).toBe(false);
    expect(m.blindStorageWarning()).toMatch(/storage is unavailable/i);
    // The in-memory view is cleared even when the disk copy could not be.
    expect(m.loadBlindGame()).toBeNull();
  });
});
