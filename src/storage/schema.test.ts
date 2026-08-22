import { describe, expect, it } from 'vitest';
import {
  LINES_SCHEMA_VERSION,
  emptyLinesFile,
  lineLabel,
  migrate,
  parseLinesFilePayload,
  toLine,
  validateLineShape,
  type Line,
} from './schema';
import { START_FEN } from '../chess/position';

function makeLine(over: Partial<Line> = {}): Line {
  return {
    id: 'id-1',
    name: 'Italian',
    startFen: START_FEN,
    moves: ['e4', 'e5', 'Nf3'],
    userColor: 'w',
    createdAt: 1_000,
    updatedAt: 2_000,
    ...over,
  };
}

describe('validateLineShape', () => {
  it('accepts a well-formed line, with and without notes', () => {
    expect(validateLineShape(makeLine()).valid).toBe(true);
    expect(validateLineShape(makeLine({ notes: 'main line' })).valid).toBe(true);
  });

  it('accepts an empty move list and an empty name', () => {
    expect(validateLineShape(makeLine({ moves: [] })).valid).toBe(true);
    expect(validateLineShape(makeLine({ name: '' })).valid).toBe(true);
  });

  it.each([
    ['not an object', 42],
    ['null', null],
    ['an array', []],
  ])('rejects %s', (_label, value) => {
    const res = validateLineShape(value);
    expect(res.valid).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it('names the offending field', () => {
    expect(validateLineShape({ ...makeLine(), id: 1 }).error).toContain('id');
    expect(validateLineShape({ ...makeLine(), name: undefined }).error).toContain('name');
    expect(validateLineShape({ ...makeLine(), startFen: '  ' }).error).toContain('startFen');
    expect(validateLineShape({ ...makeLine(), moves: 'e4 e5' }).error).toContain('moves');
    expect(validateLineShape({ ...makeLine(), moves: ['e4', 7] }).error).toContain('moves[1]');
    expect(validateLineShape({ ...makeLine(), userColor: 'white' }).error).toContain('userColor');
    expect(validateLineShape({ ...makeLine(), notes: 3 }).error).toContain('notes');
    expect(validateLineShape({ ...makeLine(), createdAt: NaN }).error).toContain('createdAt');
    expect(validateLineShape({ ...makeLine(), updatedAt: '2000' }).error).toContain('updatedAt');
  });
});

describe('toLine', () => {
  it('keeps only schema fields and trims strings', () => {
    const line = toLine({ ...makeLine(), startFen: ` ${START_FEN} `, extra: 'junk' });
    expect(line).not.toBeNull();
    expect(line?.startFen).toBe(START_FEN);
    expect(Object.keys(line as Line).sort()).toEqual([
      'createdAt',
      'id',
      'moves',
      'name',
      'startFen',
      'updatedAt',
      'userColor',
    ]);
  });

  it('returns null for a malformed candidate', () => {
    expect(toLine({ id: 'x' })).toBeNull();
  });
});

describe('lineLabel', () => {
  it('uses the name when present and falls back to the index', () => {
    expect(lineLabel({ name: 'Sicilian' }, 0)).toBe('Sicilian');
    expect(lineLabel({ name: '   ' }, 2)).toBe('(unnamed line #3)');
    expect(lineLabel(null, 4)).toBe('(unnamed line #5)');
  });
});

describe('migrate — absent or empty store', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['whitespace', '   '],
  ])('treats %s as an empty repertoire without an error', (_label, raw) => {
    const res = migrate(raw);
    expect(res.error).toBeUndefined();
    expect(res.changed).toBe(false);
    expect(res.file).toEqual(emptyLinesFile());
    expect(res.file.schemaVersion).toBe(LINES_SCHEMA_VERSION);
    expect(res.file.lines).toEqual([]);
  });
});

describe('migrate — unusable payloads', () => {
  it('never throws for arbitrary junk', () => {
    const junk: unknown[] = [
      'not json at all',
      '{"schemaVersion":}',
      '[]',
      '"a json string"',
      '42',
      42,
      true,
      [],
      {},
      { schemaVersion: 'one', lines: [] },
      { schemaVersion: NaN, lines: [] },
      { schemaVersion: 1.5, lines: [] },
      { schemaVersion: 0, lines: [] },
      { schemaVersion: 1 },
      { schemaVersion: 1, lines: null },
      { schemaVersion: 1, lines: 'e4' },
    ];
    for (const raw of junk) {
      const res = migrate(raw);
      expect(res.error, JSON.stringify(raw)).toBeTruthy();
      expect(res.file.lines).toEqual([]);
      // Nothing may be written back for a payload we did not understand.
      expect(res.changed).toBe(false);
    }
  });

  it('refuses a future schemaVersion instead of guessing', () => {
    const res = migrate(
      JSON.stringify({ schemaVersion: LINES_SCHEMA_VERSION + 1, exportedAt: 1, lines: [] }),
    );
    expect(res.error).toContain('newer version');
    expect(res.error).toContain(String(LINES_SCHEMA_VERSION + 1));
    expect(res.changed).toBe(false);
    expect(res.file.lines).toEqual([]);
  });

  it('reports a missing schemaVersion', () => {
    expect(migrate(JSON.stringify({ lines: [] })).error).toContain('schemaVersion');
  });
});

describe('migrate — usable payloads', () => {
  const good = makeLine();

  it('accepts a JSON string', () => {
    const res = migrate(JSON.stringify({ schemaVersion: 1, exportedAt: 5, lines: [good] }));
    expect(res.error).toBeUndefined();
    expect(res.changed).toBe(false);
    expect(res.file).toEqual({ schemaVersion: 1, exportedAt: 5, lines: [good] });
  });

  it('accepts an already-parsed object', () => {
    const res = migrate({ schemaVersion: 1, exportedAt: 5, lines: [good] });
    expect(res.error).toBeUndefined();
    expect(res.file.lines).toEqual([good]);
  });

  it('drops individual malformed lines, keeps the rest, and says so', () => {
    const res = migrate({
      schemaVersion: 1,
      exportedAt: 5,
      lines: [good, { id: 'x', name: 'Broken' }, null, makeLine({ id: 'id-2', name: 'French' })],
    });
    expect(res.file.lines.map((l) => l.id)).toEqual(['id-1', 'id-2']);
    expect(res.changed).toBe(true);
    expect(res.error).toContain('2 unreadable line(s)');
    expect(res.error).toContain('Broken');
    expect(res.error).toContain('(unnamed line #3)');
  });

  it('repairs a missing exportedAt and flags the change', () => {
    const res = migrate({ schemaVersion: 1, lines: [good] });
    expect(res.error).toBeUndefined();
    expect(res.changed).toBe(true);
    expect(res.file.exportedAt).toBe(0);
  });

  it('does not mutate the input payload', () => {
    const payload = { schemaVersion: 1, exportedAt: 5, lines: [good, { id: 'broken' }] };
    const snapshot = JSON.stringify(payload);
    migrate(payload);
    expect(JSON.stringify(payload)).toBe(snapshot);
  });
});

describe('parseLinesFilePayload', () => {
  it('returns the raw lines untouched for a valid envelope', () => {
    const res = parseLinesFilePayload(
      JSON.stringify({ schemaVersion: 1, exportedAt: 9, lines: [{ id: 'raw' }] }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.schemaVersion).toBe(1);
      expect(res.exportedAt).toBe(9);
      expect(res.rawLines).toEqual([{ id: 'raw' }]);
    }
  });

  it('reports invalid JSON without throwing', () => {
    const res = parseLinesFilePayload('{oops');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('Not valid JSON');
  });
});
