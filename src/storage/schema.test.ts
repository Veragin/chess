import { describe, expect, it } from 'vitest';
import {
  LINES_SCHEMA_VERSION,
  MAX_TREE_DEPTH,
  MAX_TREE_NODES,
  emptyLinesFile,
  lineLabel,
  migrate,
  parseLinesFilePayload,
  serialiseLinesFile,
  toLine,
  toStoredLine,
  validateLineShape,
  type Line,
  type StoredLine,
} from './schema';
import { START_FEN } from '../chess/position';
import { treeFromMoves, type MoveNode } from '../chess/tree';
import { encodeTree } from './treeFormat';

function makeLine(over: Partial<Line> = {}): Line {
  return {
    id: 'id-1',
    name: 'Italian',
    startFen: START_FEN,
    tree: treeFromMoves(['e4', 'e5', 'Nf3']),
    userColor: 'w',
    createdAt: 1_000,
    updatedAt: 2_000,
    ...over,
  };
}

/** `makeLine` as the current schema stores it: the tree in its PGN-like array form. */
function makeStored(over: Partial<Line> = {}): StoredLine {
  return toStoredLine(makeLine(over));
}

/** A current-version payload holding `lines` (in-memory lines, stored as the schema writes them). */
function fileOf(lines: Line[], exportedAt = 5): Record<string, unknown> {
  return { schemaVersion: LINES_SCHEMA_VERSION, exportedAt, lines: lines.map(toStoredLine) };
}

/** The same line as a schema v1 payload wrote it: a linear `moves` array, no `tree`. */
function makeV1Line(over: Record<string, unknown> = {}): Record<string, unknown> {
  const { tree: _tree, ...rest } = makeLine();
  void _tree;
  return { ...rest, moves: ['e4', 'e5', 'Nf3'], ...over };
}

describe('validateLineShape', () => {
  it('accepts a well-formed line, with and without notes', () => {
    expect(validateLineShape(makeStored()).valid).toBe(true);
    expect(validateLineShape(makeStored({ notes: 'main line' })).valid).toBe(true);
  });

  it('accepts an empty move list and an empty name', () => {
    expect(validateLineShape(makeStored({ tree: [] })).valid).toBe(true);
    expect(validateLineShape(makeStored({ name: '' })).valid).toBe(true);
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
    expect(validateLineShape({ ...makeStored(), id: 1 }).error).toContain('id');
    expect(validateLineShape({ ...makeStored(), name: undefined }).error).toContain('name');
    expect(validateLineShape({ ...makeStored(), startFen: '  ' }).error).toContain('startFen');
    expect(validateLineShape({ ...makeStored(), tree: 'e4 e5' }).error).toContain('tree');
    expect(validateLineShape({ ...makeStored(), userColor: 'white' }).error).toContain('userColor');
    expect(validateLineShape({ ...makeStored(), notes: 3 }).error).toContain('notes');
    expect(validateLineShape({ ...makeStored(), createdAt: NaN }).error).toContain('createdAt');
    expect(validateLineShape({ ...makeStored(), updatedAt: '2000' }).error).toContain('updatedAt');
  });
});

describe('toLine', () => {
  it('keeps only schema fields and trims strings', () => {
    const line = toLine({ ...makeStored(), startFen: ` ${START_FEN} `, extra: 'junk' });
    expect(line).not.toBeNull();
    expect(line?.startFen).toBe(START_FEN);
    expect(Object.keys(line as Line).sort()).toEqual([
      'createdAt',
      'id',
      'name',
      'startFen',
      'tree',
      'updatedAt',
      'userColor',
    ]);
  });

  it('returns null for a malformed candidate', () => {
    expect(toLine({ id: 'x' })).toBeNull();
  });
});

const branched: MoveNode[] = [
  {
    san: 'e4',
    next: [
      { san: 'e5', comment: 'symmetrical', next: [{ san: 'Nf3', next: [] }] },
      { san: 'c5', next: [] },
    ],
  },
];

describe('move trees (stored PGN-like)', () => {
  const bad = (tree: unknown) => validateLineShape({ ...makeStored(), tree }).error;

  it('stores the main line flat and an alternative right after the move it replaces', () => {
    expect(encodeTree(branched)).toEqual([
      'e4',
      { san: 'e5', comment: 'symmetrical' },
      ['c5'],
      'Nf3',
    ]);
  });

  it('accepts a branched tree with comments and reads it back exactly', () => {
    const stored = makeStored({ tree: branched });
    expect(validateLineShape(stored).valid).toBe(true);
    expect(toLine(stored)?.tree).toEqual(branched);
  });

  it('keeps sibling order with several alternatives, nested ones included', () => {
    const tree = encodeTree(branched);
    const wide: MoveNode[] = [
      { san: 'd4', next: [] },
      { san: 'e4', next: branched[0]?.next ?? [] },
      { san: 'c4', next: [{ san: 'e5', next: [] }, { san: 'c5', next: [] }] },
    ];
    expect(toLine({ ...makeStored(), tree })?.tree).toEqual(branched);
    expect(toLine(makeStored({ tree: wide }))?.tree).toEqual(wide);
  });

  it('names the offending item', () => {
    expect(bad([''])).toContain('tree[0]');
    expect(bad(['e4', 5])).toContain('tree[1]');
    expect(bad(['e4', { san: '' }])).toContain('tree[1].san');
    expect(bad(['e4', { san: 'e5', comment: 7 }])).toContain('tree[1].comment');
    expect(bad(['e4', { san: 'e5', threats: 'Qh5' }])).toContain('tree[1].threats');
    expect(bad(['e4', { san: 'e5', threats: [3] }])).toContain('tree[1].threats');
    expect(bad([['e4']])).toContain('no move before it');
    expect(bad(['e4', []])).toContain('empty variation');
    expect(bad(['e4', ['d4', null]])).toContain('tree[1][1]');
    expect(bad(undefined)).toContain('tree');
  });

  it('refuses a nested { san, next } node instead of dropping its continuations', () => {
    expect(bad([{ san: 'e4', next: [{ san: 'e5', next: [] }] }])).toContain('"next"');
  });

  it('refuses absurdly deep, nested or large trees instead of overflowing', () => {
    expect(bad(Array.from({ length: MAX_TREE_DEPTH + 1 }, () => 'Nf3'))).toContain('deeper');
    let nested: unknown[] = ['e4'];
    for (let i = 0; i <= MAX_TREE_DEPTH; i++) nested = ['e4', nested];
    expect(bad(nested)).toContain('nests');
    const wide = ['e4', ...Array.from({ length: MAX_TREE_NODES }, () => ['d4'])];
    expect(bad(wide)).toContain('more than');
  });

  it('trims SANs and drops blank comments when reading', () => {
    const line = toLine({ ...makeStored(), tree: [{ san: ' e4 ', comment: '  ' }, { san: 'e5', comment: ' ok ' }] });
    expect(line?.tree).toEqual([{ san: 'e4', next: [{ san: 'e5', comment: 'ok', next: [] }] }]);
  });

  it('stores threats with the move and reads them back trimmed, without blanks or repeats', () => {
    const tree: MoveNode[] = [
      { san: 'e4', next: [{ san: 'e5', next: [{ san: 'Bc4', threats: ['Qh5', 'Bxf7+'], next: [] }] }] },
    ];
    expect(encodeTree(tree)).toEqual(['e4', 'e5', { san: 'Bc4', threats: ['Qh5', 'Bxf7+'] }]);
    expect(toLine(makeStored({ tree }))?.tree).toEqual(tree);
    const messy = toLine({ ...makeStored(), tree: [{ san: 'e4', threats: [' d4 ', '', 'd4'] }] });
    expect(messy?.tree).toEqual([{ san: 'e4', threats: ['d4'], next: [] }]);
    const empty = toLine({ ...makeStored(), tree: [{ san: 'e4', threats: [] }] });
    expect(empty?.tree).toEqual([{ san: 'e4', next: [] }]);
  });

  it('round-trips through migrate unchanged', () => {
    const line = makeLine({ tree: branched, notes: 'n', folder: 'White/Open' });
    const res = migrate(JSON.stringify(fileOf([line])));
    expect(res.error).toBeUndefined();
    expect(res.changed).toBe(false);
    expect(res.file).toEqual({ schemaVersion: LINES_SCHEMA_VERSION, exportedAt: 5, lines: [line] });
  });

  it('round-trips through serialiseLinesFile, compact and pretty', () => {
    const file = { schemaVersion: LINES_SCHEMA_VERSION, exportedAt: 5, lines: [makeLine({ tree: branched })] };
    for (const pretty of [false, true]) {
      const res = migrate(serialiseLinesFile(file, pretty));
      expect(res.changed).toBe(false);
      expect(res.file).toEqual(file);
    }
  });
});

describe('migrate — schema v1', () => {
  it('turns each move list into a single-branch tree and flags the upgrade', () => {
    const res = migrate({
      schemaVersion: 1,
      exportedAt: 5,
      lines: [makeV1Line({ notes: 'keep me', folder: 'White/Italian' }), makeV1Line({ id: 'id-2', moves: [] })],
    });
    expect(res.error).toBeUndefined();
    expect(res.changed).toBe(true);
    expect(res.file.schemaVersion).toBe(LINES_SCHEMA_VERSION);
    expect(res.file.lines).toEqual([
      makeLine({ notes: 'keep me', folder: 'White/Italian' }),
      makeLine({ id: 'id-2', tree: [] }),
    ]);
    expect('moves' in (res.file.lines[0] as object)).toBe(false);
  });

  it('still validates v1 move lists', () => {
    const res = migrate({
      schemaVersion: 1,
      exportedAt: 5,
      lines: [makeV1Line({ moves: ['e4', 7] }), makeV1Line({ id: 'b', moves: 'e4' }), makeStored()],
    });
    expect(res.file.lines).toEqual([]);
    expect(res.error).toContain('moves[1]');
    expect(res.error).toContain('"moves" must be an array');
    // A tree-shaped line inside a v1 file has no `moves`, so it is refused too.
    expect(res.error).toContain('3 unreadable line(s)');
  });

  it('refuses version 3', () => {
    const res = migrate({ schemaVersion: 3, exportedAt: 5, lines: [] });
    expect(res.error).toContain('newer version');
    expect(res.changed).toBe(false);
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
  const goodStored = toStoredLine(good);

  it('accepts a JSON string', () => {
    const res = migrate(JSON.stringify(fileOf([good])));
    expect(res.error).toBeUndefined();
    expect(res.changed).toBe(false);
    expect(res.file).toEqual({ schemaVersion: LINES_SCHEMA_VERSION, exportedAt: 5, lines: [good] });
  });

  it('accepts an already-parsed object', () => {
    const res = migrate(fileOf([good]));
    expect(res.error).toBeUndefined();
    expect(res.file.lines).toEqual([good]);
  });

  it('drops individual malformed lines, keeps the rest, and says so', () => {
    const res = migrate({
      schemaVersion: LINES_SCHEMA_VERSION,
      exportedAt: 5,
      lines: [goodStored, { id: 'x', name: 'Broken' }, null, makeStored({ id: 'id-2', name: 'French' })],
    });
    expect(res.file.lines.map((l) => l.id)).toEqual(['id-1', 'id-2']);
    expect(res.changed).toBe(true);
    expect(res.error).toContain('2 unreadable line(s)');
    expect(res.error).toContain('Broken');
    expect(res.error).toContain('(unnamed line #3)');
  });

  it('repairs a missing exportedAt and flags the change', () => {
    const res = migrate({ schemaVersion: LINES_SCHEMA_VERSION, lines: [goodStored] });
    expect(res.error).toBeUndefined();
    expect(res.changed).toBe(true);
    expect(res.file.exportedAt).toBe(0);
  });

  it('does not mutate the input payload', () => {
    const payload = { schemaVersion: LINES_SCHEMA_VERSION, exportedAt: 5, lines: [goodStored, { id: 'broken' }] };
    const snapshot = JSON.stringify(payload);
    migrate(payload);
    expect(JSON.stringify(payload)).toBe(snapshot);
  });
});

describe('parseLinesFilePayload', () => {
  it('returns the raw lines untouched for a valid envelope', () => {
    const res = parseLinesFilePayload(
      JSON.stringify({ schemaVersion: LINES_SCHEMA_VERSION, exportedAt: 9, lines: [{ id: 'raw' }] }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.schemaVersion).toBe(LINES_SCHEMA_VERSION);
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

describe('the folder field', () => {
  it('is optional, and any string is a valid folder', () => {
    expect(validateLineShape(makeStored()).valid).toBe(true);
    expect(validateLineShape(makeStored({ folder: '' })).valid).toBe(true);
    expect(validateLineShape(makeStored({ folder: 'Black/Sicilian' })).valid).toBe(true);
  });

  it('rejects a folder of the wrong type', () => {
    expect(validateLineShape({ ...makeStored(), folder: 42 }).error).toMatch(/folder/);
    expect(validateLineShape({ ...makeStored(), folder: ['a'] }).error).toMatch(/folder/);
  });

  it('is normalised by toLine, and omitted when it comes to nothing', () => {
    expect(toLine(makeStored({ folder: ' Black // Sicilian / ' }))?.folder).toBe('Black/Sicilian');
    expect('folder' in (toLine(makeStored({ folder: '  ' })) as object)).toBe(false);
    expect('folder' in (toLine(makeStored()) as object)).toBe(false);
  });

  it('survives a round trip through migrate', () => {
    const result = migrate(fileOf([makeLine({ folder: 'White/Italian' })]));
    expect(result.error).toBeUndefined();
    expect(result.file.lines[0]?.folder).toBe('White/Italian');
  });

  it('reads a pre-folders file as a repertoire with no folders at all', () => {
    const result = migrate(fileOf([makeLine()]));
    expect(result.error).toBeUndefined();
    expect(result.changed).toBe(false);
    expect(result.file.lines[0]?.folder).toBeUndefined();
  });
});
