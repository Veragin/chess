import { describe, expect, it } from 'vitest';
import { applyMove, sansOf, stepBack, stepForward } from '../../../chess/history';
import { START_FEN } from '../../../chess/position';
import type { Line } from '../../../storage/schema';
import {
  draftFromLine,
  draftMoves,
  emptyDraft,
  isDirty,
  pendingRedoCount,
  rebaseHistory,
  toLineInput,
  validateDraft,
  type LineDraft,
} from './draft';

/** Plays SAN moves onto a fresh draft, failing loudly if the test's own moves are wrong. */
function play(draft: LineDraft, ...sans: string[]): LineDraft {
  let history = draft.history;
  for (const san of sans) {
    const next = applyMove(history, san);
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
    moves: ['e4', 'c5'],
    userColor: 'w',
    createdAt: 1,
    updatedAt: 2,
    ...partial,
  };
}

describe('emptyDraft', () => {
  it('starts blank, White, on the standard start position', () => {
    const d = emptyDraft();
    expect(d.name).toBe('');
    expect(d.notes).toBe('');
    expect(d.userColor).toBe('w');
    expect(d.history.startFen).toBe(START_FEN);
    expect(draftMoves(d.history)).toEqual([]);
  });
});

describe('draftMoves / pendingRedoCount — undo/redo semantics', () => {
  it('saves the moves up to the cursor, so an undone move is excluded', () => {
    const d = play(emptyDraft(), 'e4', 'e5', 'Nf3');
    expect(draftMoves(d.history)).toEqual(['e4', 'e5', 'Nf3']);
    expect(pendingRedoCount(d.history)).toBe(0);

    const undone = { ...d, history: stepBack(d.history) };
    expect(draftMoves(undone.history)).toEqual(['e4', 'e5']);
    expect(pendingRedoCount(undone.history)).toBe(1);
    // The move itself is still there — Redo can get it back.
    expect(sansOf(undone.history)).toEqual(['e4', 'e5', 'Nf3']);

    const redone = { ...undone, history: stepForward(undone.history) };
    expect(draftMoves(redone.history)).toEqual(['e4', 'e5', 'Nf3']);
    expect(pendingRedoCount(redone.history)).toBe(0);
  });

  it('truncates the future when a different move is played mid-history', () => {
    const d = play(emptyDraft(), 'e4', 'e5', 'Nf3');
    const undone = stepBack(stepBack(d.history)); // cursor after e4
    const diverged = applyMove(undone, 'c5');
    expect(diverged).not.toBeNull();
    expect(sansOf(diverged!)).toEqual(['e4', 'c5']);
    expect(pendingRedoCount(diverged!)).toBe(0);
  });

  it('clamps a nonsense cursor instead of returning phantom moves', () => {
    const d = play(emptyDraft(), 'e4');
    expect(draftMoves({ ...d.history, cursor: 99 })).toEqual(['e4']);
    expect(draftMoves({ ...d.history, cursor: -7 })).toEqual([]);
  });
});

describe('rebaseHistory', () => {
  it('keeps every move that is still legal from the new start position', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const result = rebaseHistory(fen, ['e4', 'e5', 'Nf3']);
    expect(result.dropped).toBe(0);
    expect(sansOf(result.history)).toEqual(['e4', 'e5', 'Nf3']);
    expect(result.history.cursor).toBe(2);
  });

  it('keeps the legal prefix and reports how many moves were dropped', () => {
    // Black to move: 'e4' is impossible, so everything goes.
    const result = rebaseHistory('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1', [
      'e4',
      'e5',
    ]);
    expect(result.dropped).toBe(2);
    expect(sansOf(result.history)).toEqual([]);
    expect(result.history.cursor).toBe(-1);
  });

  it('drops only the moves that stop being legal', () => {
    // A position where 1.e4 works but 1...e5 does not (Black has no pawn on e7).
    const fen = 'rnbqkbnr/pppp1ppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const result = rebaseHistory(fen, ['e4', 'e5', 'Nf3']);
    expect(sansOf(result.history)).toEqual(['e4']);
    expect(result.dropped).toBe(2);
  });

  it('never throws on an unparseable FEN', () => {
    const result = rebaseHistory('not a fen', ['e4']);
    expect(result.dropped).toBe(1);
    expect(sansOf(result.history)).toEqual([]);
  });

  it('keeps every fenAfter aligned with its move', () => {
    const result = rebaseHistory(START_FEN, ['e4', 'e5']);
    expect(result.history.entries[0]?.fenAfter).toContain(' b ');
    expect(result.history.entries[1]?.fenAfter).toContain(' w ');
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
    expect(draftMoves(draft.history)).toEqual(['e4', 'c5']);
  });

  it('turns an absent notes field into an empty string', () => {
    expect(draftFromLine(storedLine({})).draft.notes).toBe('');
  });

  it('opens a corrupt stored line instead of throwing, reporting the dropped moves', () => {
    const { draft, dropped } = draftFromLine(storedLine({ moves: ['e4', 'Qh9', 'Nf3'] }));
    expect(dropped).toBe(2);
    expect(draftMoves(draft.history)).toEqual(['e4']);
  });
});

describe('validateDraft', () => {
  it('accepts a named line with at least one legal move', () => {
    const d = play({ ...emptyDraft(), name: 'Open game' }, 'e4', 'e5');
    const result = validateDraft(d);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.moves).toEqual(['e4', 'e5']);
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

  it('refuses a line whose moves were all undone', () => {
    const d = play({ ...emptyDraft(), name: 'Undone' }, 'e4');
    const result = validateDraft({ ...d, history: stepBack(d.history) });
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

  it('refuses a move list that is illegal from the start position, naming the move', () => {
    const d: LineDraft = {
      ...emptyDraft(),
      name: 'Bad ply 3',
      history: {
        startFen: START_FEN,
        entries: [
          { san: 'e4', fenAfter: START_FEN },
          { san: 'e5', fenAfter: START_FEN },
          { san: 'Qh5xf7', fenAfter: START_FEN },
        ],
        cursor: 2,
      },
    };
    const result = validateDraft(d);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Move 3');
    expect(result.error).toContain('Qh5xf7');
  });

  it('returns SAN normalised by chess.js', () => {
    const d: LineDraft = {
      ...emptyDraft(),
      name: 'Loose SAN',
      history: {
        startFen: START_FEN,
        entries: [{ san: 'e2e4', fenAfter: START_FEN }],
        cursor: 0,
      },
    };
    const result = validateDraft(d);
    expect(result.ok).toBe(true);
    expect(result.moves).toEqual(['e4']);
  });
});

describe('toLineInput', () => {
  it('trims the name and omits blank notes', () => {
    const d = play({ ...emptyDraft(), name: '  Najdorf  ', notes: '   ' }, 'e4', 'c5');
    const input = toLineInput(d);
    expect(input.name).toBe('Najdorf');
    expect(input.moves).toEqual(['e4', 'c5']);
    expect(input.userColor).toBe('w');
    expect('notes' in input).toBe(false);
  });

  it('keeps trimmed notes when present', () => {
    const d = play({ ...emptyDraft(), name: 'X', notes: '  watch d5  ' }, 'e4');
    expect(toLineInput(d).notes).toBe('watch d5');
  });

  it('excludes undone moves', () => {
    const d = play({ ...emptyDraft(), name: 'X' }, 'e4', 'e5');
    expect(toLineInput({ ...d, history: stepBack(d.history) }).moves).toEqual(['e4']);
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
      isDirty({ ...base, history: rebaseHistory('4k3/8/8/8/8/8/8/4K3 w - - 0 1', []).history }, base),
    ).toBe(true);
  });

  it('ignores whitespace-only notes edits', () => {
    const base = draftFromLine(storedLine({ notes: 'a' })).draft;
    expect(isDirty({ ...base, notes: '  a  ' }, base)).toBe(false);
  });

  it('ignores pure cursor navigation that ends where it started', () => {
    const base = draftFromLine(storedLine({})).draft;
    const wandered = { ...base, history: stepForward(stepBack(base.history)) };
    expect(isDirty(wandered, base)).toBe(false);
  });

  it('treats an undone move as a change, because it would not be saved', () => {
    const base = draftFromLine(storedLine({})).draft;
    expect(isDirty({ ...base, history: stepBack(base.history) }, base)).toBe(true);
  });
});
