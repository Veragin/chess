import { describe, expect, it } from 'vitest';
import { applyMove, createHistory, stepBack } from '../../../chess/history';
import { START_FEN } from '../../../chess/position';
import { treeFromMoves, treeKey, type MoveTree } from '../../../chess/tree';
import {
  applyMoveAt,
  deleteFromCursor,
  jumpTo,
  promoteToMainLine,
  rebaseTree,
  setCommentAt,
  stepBack as treeStepBack,
  toStart,
} from '../../../chess/treeHistory';
import type { Line } from '../../../storage/schema';
import {
  draftFromLine,
  draftMoves,
  emptyDraft,
  isDirty,
  loadMoves,
  toLineInput,
  validateDraft,
  type LineDraft,
} from './draft';

/** Plays SAN moves from the draft's cursor, failing loudly if the test's own moves are wrong. */
function play(draft: LineDraft, ...sans: string[]): LineDraft {
  let history = draft.history;
  for (const san of sans) {
    const next = applyMoveAt(history, san);
    if (next === null) throw new Error(`test fixture: ${san} is illegal`);
    history = next;
  }
  return { ...draft, history };
}

function storedLine(partial: Partial<Line>): Line {
  return {
    id: 'l1',
    name: 'Stored',
    startFen: START_FEN,
    tree: treeFromMoves(['e4', 'c5']),
    userColor: 'w',
    createdAt: 1,
    updatedAt: 2,
    ...partial,
  };
}

/** 1.e4 c5 (1...e5 2.Nf3 {Main}) 2.Nf3 {Open Sicilian} d6 — with comments. */
const BRANCHED: MoveTree = [
  {
    san: 'e4',
    comment: 'Best by test',
    next: [
      { san: 'c5', next: [{ san: 'Nf3', comment: 'Open Sicilian', next: [{ san: 'd6', next: [] }] }] },
      { san: 'e5', next: [{ san: 'Nf3', comment: 'Main', next: [] }] },
    ],
  },
];

describe('emptyDraft', () => {
  it('starts blank, White, on the standard start position', () => {
    const d = emptyDraft();
    expect(d.name).toBe('');
    expect(d.notes).toBe('');
    expect(d.userColor).toBe('w');
    expect(d.history.startFen).toBe(START_FEN);
    expect(d.history.tree).toEqual([]);
    expect(d.history.cursor).toEqual([]);
  });
});

describe('draftMoves (linear hand-off helper)', () => {
  it('returns the moves up to the cursor of a linear history', () => {
    let h = createHistory(START_FEN);
    for (const san of ['e4', 'e5', 'Nf3']) h = applyMove(h, san)!;
    expect(draftMoves(h)).toEqual(['e4', 'e5', 'Nf3']);
    expect(draftMoves(stepBack(h))).toEqual(['e4', 'e5']);
    expect(draftMoves({ ...h, cursor: 99 })).toEqual(['e4', 'e5', 'Nf3']);
    expect(draftMoves({ ...h, cursor: -7 })).toEqual([]);
  });
});

describe('tree editing in a draft', () => {
  it('adds a branch instead of truncating when a different move is played mid-line', () => {
    const d = play(emptyDraft(), 'e4', 'e5', 'Nf3');
    const back = { ...d, history: jumpTo(d.history, [0]) };
    const diverged = play(back, 'c5');
    expect(treeKey(diverged.history.tree)).toBe('e4(c5,e5(Nf3))');
    expect(diverged.history.cursor).toEqual([0, 1]);
  });

  it('saves the whole tree wherever the cursor is', () => {
    const d = play({ ...emptyDraft(), name: 'X' }, 'e4', 'e5');
    const atStart = { ...d, history: toStart(d.history) };
    expect(toLineInput(atStart).tree).toEqual(treeFromMoves(['e4', 'e5']));
    expect(validateDraft(atStart).ok).toBe(true);
  });
});

describe('loadMoves', () => {
  it('keeps every move that is still legal and puts the cursor at the end', () => {
    const { history, dropped } = loadMoves(START_FEN, ['e4', 'e5', 'Nf3']);
    expect(dropped).toBe(0);
    expect(history.tree).toEqual(treeFromMoves(['e4', 'e5', 'Nf3']));
    expect(history.cursor).toEqual([0, 0, 0]);
  });

  it('keeps the legal prefix and reports how many moves were dropped', () => {
    const result = loadMoves('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1', [
      'e4',
      'e5',
    ]);
    expect(result.dropped).toBe(2);
    expect(result.history.tree).toEqual([]);
    expect(result.history.cursor).toEqual([]);
  });

  it('never throws on an unparseable FEN', () => {
    const result = loadMoves('not a fen', ['e4']);
    expect(result.dropped).toBe(1);
    expect(result.history.tree).toEqual([]);
  });
});

describe('draftFromLine', () => {
  it('round-trips a stored line into an editable draft', () => {
    const { draft, dropped } = draftFromLine(
      storedLine({ name: 'Sicilian', userColor: 'b', notes: 'sharp' }),
    );
    expect(dropped).toBe(0);
    expect(draft.name).toBe('Sicilian');
    expect(draft.userColor).toBe('b');
    expect(draft.notes).toBe('sharp');
    expect(draft.history.tree).toEqual(treeFromMoves(['e4', 'c5']));
    expect(draft.history.cursor).toEqual([0, 0]);
  });

  it('loads every branch and comment, cursor at the end of the main line', () => {
    const { draft, dropped } = draftFromLine(storedLine({ tree: BRANCHED }));
    expect(dropped).toBe(0);
    expect(draft.history.tree).toEqual(BRANCHED);
    expect(draft.history.cursor).toEqual([0, 0, 0, 0]);
  });

  it('turns an absent notes field into an empty string', () => {
    expect(draftFromLine(storedLine({})).draft.notes).toBe('');
  });

  it('opens a corrupt stored line instead of throwing, reporting the dropped moves', () => {
    const { draft, dropped } = draftFromLine(storedLine({ tree: treeFromMoves(['e4', 'Qh9', 'Nf3']) }));
    expect(dropped).toBe(2);
    expect(draft.history.tree).toEqual(treeFromMoves(['e4']));
  });

  it('cuts only the broken branch of a damaged tree', () => {
    const tree: MoveTree = [
      { san: 'e4', next: [{ san: 'Qh9', next: [] }, { san: 'c5', comment: 'kept', next: [] }] },
    ];
    const { draft, dropped } = draftFromLine(storedLine({ tree }));
    expect(dropped).toBe(1);
    expect(draft.history.tree).toEqual([{ san: 'e4', next: [{ san: 'c5', comment: 'kept', next: [] }] }]);
  });

  it('normalises SANs and merges siblings that only differed in notation', () => {
    const tree: MoveTree = [
      { san: 'Ng1f3', comment: 'a', next: [] },
      { san: 'Nf3', comment: 'b', next: [{ san: 'd5', next: [] }] },
    ];
    const { draft } = draftFromLine(storedLine({ tree }));
    expect(draft.history.tree).toEqual([
      { san: 'Nf3', comment: 'a\nb', next: [{ san: 'd5', next: [] }] },
    ]);
  });
});

describe('validateDraft', () => {
  it('accepts a named line with at least one legal move', () => {
    const d = play({ ...emptyDraft(), name: 'Open game' }, 'e4', 'e5');
    const result = validateDraft(d);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.tree).toEqual(treeFromMoves(['e4', 'e5']));
  });

  it('refuses an empty name with a reason', () => {
    const d = play({ ...emptyDraft(), name: '   ' }, 'e4');
    const result = validateDraft(d);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/name/i);
  });

  it('refuses an empty move list with a reason', () => {
    const result = validateDraft({ ...emptyDraft(), name: 'Empty' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/at least one move/i);
  });

  it('refuses a line whose moves were all deleted', () => {
    const d = play({ ...emptyDraft(), name: 'Deleted' }, 'e4');
    const result = validateDraft({ ...d, history: deleteFromCursor(d.history) });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/at least one move/i);
  });

  it('refuses an illegal starting position', () => {
    const d = { ...emptyDraft(), name: 'No kings' };
    const broken = { ...d, history: { ...d.history, startFen: '8/8/8/8/8/8/8/8 w - - 0 1' } };
    const result = validateDraft(broken);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/starting position/i);
  });

  it('refuses a move that is illegal from the start position, naming the move', () => {
    const d: LineDraft = {
      ...emptyDraft(),
      name: 'Bad ply 3',
      history: { startFen: START_FEN, tree: treeFromMoves(['e4', 'e5', 'Qh5xf7']), cursor: [] },
    };
    const result = validateDraft(d);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Move 3');
    expect(result.error).toContain('Qh5xf7');
    expect(result.error).not.toContain('branch');
  });

  it('names the branch of an illegal move when the line has several', () => {
    const tree: MoveTree = [
      { san: 'e4', next: [{ san: 'e5', next: [] }, { san: 'c5', next: [{ san: 'Bb5', next: [{ san: 'Ke3', next: [] }] }] }] },
    ];
    const d: LineDraft = {
      ...emptyDraft(),
      name: 'Bad branch',
      history: { startFen: START_FEN, tree, cursor: [] },
    };
    const result = validateDraft(d);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Move 4');
    expect(result.error).toContain('branch 2');
  });

  it('returns SAN normalised by chess.js with duplicate siblings merged', () => {
    const d: LineDraft = {
      ...emptyDraft(),
      name: 'Loose SAN',
      history: {
        startFen: START_FEN,
        tree: [
          { san: 'e2e4', next: [] },
          { san: 'e4', next: [{ san: 'e5', next: [] }] },
        ],
        cursor: [],
      },
    };
    const result = validateDraft(d);
    expect(result.ok).toBe(true);
    expect(result.tree).toEqual(treeFromMoves(['e4', 'e5']));
  });

  it('keeps every branch and trims comments', () => {
    let d = draftFromLine(storedLine({ name: 'B', tree: BRANCHED })).draft;
    d = { ...d, history: setCommentAt(jumpTo(d.history, [0, 1]), '  solid  ') };
    const result = validateDraft(d);
    expect(result.ok).toBe(true);
    expect(result.tree[0]?.next[1]?.comment).toBe('solid');
    expect(result.tree[0]?.comment).toBe('Best by test');
    expect(treeKey(result.tree)).toBe(treeKey(BRANCHED));
  });
});

describe('toLineInput', () => {
  it('trims the name and omits blank notes', () => {
    const d = play({ ...emptyDraft(), name: '  Najdorf  ', notes: '   ' }, 'e4', 'c5');
    const input = toLineInput(d);
    expect(input.name).toBe('Najdorf');
    expect(input.tree).toEqual(treeFromMoves(['e4', 'c5']));
    expect(input.userColor).toBe('w');
    expect('notes' in input).toBe(false);
  });

  it('keeps trimmed notes when present', () => {
    const d = play({ ...emptyDraft(), name: 'X', notes: '  watch d5  ' }, 'e4');
    expect(toLineInput(d).notes).toBe('watch d5');
  });

  it('round-trips a branched, commented line unchanged (edit then save)', () => {
    const line = storedLine({ name: 'Branched', tree: BRANCHED });
    const { draft } = draftFromLine(line);
    const validation = validateDraft(draft);
    expect(validation.ok).toBe(true);
    const input = toLineInput(draft, validation.tree);
    expect(input.tree).toEqual(BRANCHED);
    // A deep copy: storage must not share structure with editor state.
    expect(input.tree[0]).not.toBe(draft.history.tree[0]);
  });

  it('saves added branches and comments alongside the stored ones', () => {
    let d = draftFromLine(storedLine({ name: 'Grow', tree: BRANCHED })).draft;
    d = play({ ...d, history: jumpTo(d.history, [0]) }, 'c6');
    d = { ...d, history: setCommentAt(d.history, 'Caro-Kann') };
    const validation = validateDraft(d);
    const input = toLineInput(d, validation.tree);
    expect(treeKey(input.tree)).toBe('e4(c5(Nf3(d6)),c6,e5(Nf3))');
    expect(input.tree[0]?.next[2]).toEqual({ san: 'c6', comment: 'Caro-Kann', next: [] });
    expect(input.tree[0]?.next[0]?.next[0]?.comment).toBe('Open Sicilian');
  });
});

describe('isDirty', () => {
  it('is false for an untouched draft', () => {
    const base = draftFromLine(storedLine({})).draft;
    expect(isDirty(base, base)).toBe(false);
  });

  it('notices a name, colour, notes, position or move change', () => {
    const base = draftFromLine(storedLine({})).draft;
    expect(isDirty({ ...base, name: 'Other' }, base)).toBe(true);
    expect(isDirty({ ...base, userColor: 'b' }, base)).toBe(true);
    expect(isDirty({ ...base, notes: 'new' }, base)).toBe(true);
    expect(isDirty(play(base, 'Nf3'), base)).toBe(true);
    expect(
      isDirty(
        { ...base, history: rebaseTree(base.history, '4k3/8/8/8/8/8/8/4K3 w - - 0 1').history },
        base,
      ),
    ).toBe(true);
  });

  it('ignores whitespace-only notes edits', () => {
    const base = draftFromLine(storedLine({ notes: 'a' })).draft;
    expect(isDirty({ ...base, notes: '  a  ' }, base)).toBe(false);
  });

  it('ignores cursor navigation, and replaying an existing move', () => {
    const base = draftFromLine(storedLine({})).draft;
    expect(isDirty({ ...base, history: treeStepBack(base.history) }, base)).toBe(false);
    const replayed = play({ ...base, history: toStart(base.history) }, 'e4', 'c5');
    expect(isDirty(replayed, base)).toBe(false);
  });

  it('notices a deletion, a comment edit and a main-line change', () => {
    const base = draftFromLine(storedLine({ tree: BRANCHED })).draft;
    expect(isDirty({ ...base, history: deleteFromCursor(base.history) }, base)).toBe(true);
    const commented = setCommentAt(jumpTo(base.history, [0, 0]), 'sharp');
    expect(isDirty({ ...base, history: commented }, base)).toBe(true);
    // Only whitespace added to an existing comment: nothing that would be saved changed.
    const padded = setCommentAt(jumpTo(base.history, [0]), 'Best by test  ');
    expect(isDirty({ ...base, history: padded }, base)).toBe(false);
    const promoted = promoteToMainLine(jumpTo(base.history, [0, 1]));
    expect(isDirty({ ...base, history: promoted }, base)).toBe(true);
  });
});

describe('folders in the draft', () => {
  it('starts at the root, or in the folder the editor was opened from', () => {
    expect(emptyDraft().folder).toBe('');
    expect(emptyDraft('  Black / Sicilian ').folder).toBe('Black/Sicilian');
  });

  it('loads a stored folder and normalises a hand-edited one', () => {
    expect(draftFromLine(storedLine({})).draft.folder).toBe('');
    expect(draftFromLine(storedLine({ folder: 'White/Italian' })).draft.folder).toBe(
      'White/Italian',
    );
    expect(draftFromLine(storedLine({ folder: '/White//Italian/' })).draft.folder).toBe(
      'White/Italian',
    );
  });

  it('always sends a folder to storage, so clearing the field moves a line to the root', () => {
    const filed = play({ ...emptyDraft(), name: 'X', folder: ' White / Italian ' }, 'e4');
    expect(toLineInput(filed).folder).toBe('White/Italian');

    const cleared = play({ ...emptyDraft(), name: 'X', folder: '   ' }, 'e4');
    expect('folder' in toLineInput(cleared)).toBe(true);
    expect(toLineInput(cleared).folder).toBe('');
  });

  it('is not saveable-blocking: a folder is a label, never a validation failure', () => {
    const d = play({ ...emptyDraft(), name: 'X', folder: '///' }, 'e4');
    expect(validateDraft(d).ok).toBe(true);
  });

  it('counts a folder change as dirty, but not a re-typing of the same path', () => {
    const base = draftFromLine(storedLine({ folder: 'White' })).draft;
    expect(isDirty({ ...base, folder: 'Black' }, base)).toBe(true);
    expect(isDirty({ ...base, folder: '' }, base)).toBe(true);
    expect(isDirty({ ...base, folder: ' White / ' }, base)).toBe(false);
  });
});
