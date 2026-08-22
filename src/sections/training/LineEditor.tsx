/**
 * `#/training/new` and `#/training/:id/edit` — the line editor (README §7 Phase 5).
 *
 * Fields: name, trained-as colour, starting position, notes, and the move list itself, entered
 * by playing moves on the board.
 *
 * What this file deliberately does NOT own:
 *  - the starting position editor — that is Phase 4's `components/PositionEditor`, reused as the
 *    spec requires;
 *  - move-list mechanics — `chess/history.ts` provides truncation, cursor navigation and
 *    `historyFromSan`, so undo is `stepBack` and redo is `stepForward`;
 *  - validation, dirty-tracking and the draft→`Line` mapping — `./lines/draft.ts`, unit-tested.
 *
 * Undo/redo semantics are documented in `./lines/draft.ts`: undo walks the cursor back and the
 * saved line is the moves *up to the cursor*, so undone moves are recoverable with Redo right up
 * until either Save or a different move truncates them.
 */

import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import styled from 'styled-components';
import { Board } from '../../components/Board';
import { MoveList } from '../../components/MoveList';
import { PositionEditor } from '../../components/PositionEditor';
import { Button, Panel, RotateButton } from '../../components/ui';
import { createGame, type Color, type MoveInput } from '../../chess/game';
import {
  applyMove,
  createHistory,
  currentFen,
  isAtEnd,
  isAtStart,
  jumpTo,
  lastMoveOf,
  sansOf,
  sideToMove,
  startColor,
  startMoveNumber,
  stepBack,
  stepForward,
  type HistoryState,
} from '../../chess/history';
import { flipOrientation, type Orientation } from '../../chess/position';
import { allFolderPaths, folderLabel } from '../../storage/folders';
import { createLine, getLine, listLines, updateLine } from '../../storage/lines';
import { normaliseFolderPath } from '../../storage/schema';
import { ConfirmDialog } from './lines/ConfirmDialog';
import { linesPath } from './lines/folderNav';
import { Notice, NoticeTitle } from './lines/Notice';
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
} from './lines/draft';
import { colorLabel, isStandardStart, moveCountLabel } from './lines/lineFormat';

interface EditorState {
  /** The `:id` this state was built for; used to re-seed when the route changes in place. */
  routeId: string | null;
  status: 'new' | 'edit' | 'missing';
  draft: LineDraft;
  /** What was loaded (or a blank draft), for the unsaved-changes check. */
  baseline: LineDraft;
  /** Set when loading a stored line had to drop moves that no longer replay. */
  loadNotice: string | null;
}

function seedState(id: string | undefined, folder: string): EditorState {
  if (id === undefined) {
    // A new line lands in whichever folder the list was showing, so "New line" inside a folder
    // files it there without the user having to retype the path.
    const draft = emptyDraft(folder);
    return { routeId: null, status: 'new', draft, baseline: draft, loadNotice: null };
  }
  const line = getLine(id);
  if (line === null) {
    const draft = emptyDraft();
    return { routeId: id, status: 'missing', draft, baseline: draft, loadNotice: null };
  }
  const { draft, dropped } = draftFromLine(line);
  return {
    routeId: id,
    status: 'edit',
    draft,
    baseline: draft,
    loadNotice:
      dropped > 0
        ? `${dropped} stored move(s) could not be replayed from this starting position and were ` +
          `dropped. Nothing has been saved yet — fix the line or leave without saving.`
        : null,
  };
}

export function LineEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // Where the user came from in the list, and (for a new line) the folder to file it in.
  const [params] = useSearchParams();
  const fromFolder = normaliseFolderPath(params.get('folder'));
  const backTo = linesPath(fromFolder);

  const [state, setState] = useState<EditorState>(() => seedState(id, fromFolder));
  /** Existing folder paths, for the field's autocomplete. Read once — the editor is the writer. */
  const knownFolders = useMemo(() => allFolderPaths(listLines()), []);
  const [orientation, setOrientation] = useState<Orientation>(() =>
    seedOrientation(state.draft.userColor),
  );
  const [editingPosition, setEditingPosition] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [positionNotice, setPositionNotice] = useState<string | null>(null);
  /** Non-null while the "discard unsaved changes?" dialog is open; holds where to go next. */
  const [pendingLeave, setPendingLeave] = useState<string | null>(null);

  // `Routes` renders `<LineEditor />` at the same position for both /new and /:id/edit, so the
  // component instance can survive an id change. Re-seed during render (React's documented
  // "adjust state when a prop changes" pattern) rather than in an effect, which would paint the
  // wrong line for one frame.
  if (state.routeId !== (id ?? null)) {
    const next = seedState(id, fromFolder);
    setState(next);
    setOrientation(seedOrientation(next.draft.userColor));
    setEditingPosition(false);
    setError(null);
    setPositionNotice(null);
    setPendingLeave(null);
  }

  const { draft, baseline, status } = state;
  const history = draft.history;

  const patch = useCallback((next: Partial<LineDraft>) => {
    setError(null);
    setState((prev) => ({ ...prev, draft: { ...prev.draft, ...next } }));
  }, []);

  const dirty = useMemo(() => isDirty(draft, baseline), [draft, baseline]);
  const moves = sansOf(history);
  const savedMoves = draftMoves(history);
  const undone = pendingRedoCount(history);
  const fen = currentFen(history);

  const onMove = useCallback(
    (move: MoveInput) => {
      setError(null);
      setState((prev) => {
        const next = applyMove(prev.draft.history, move);
        if (next === null) return prev;
        return { ...prev, draft: { ...prev.draft, history: next } };
      });
    },
    [],
  );

  const setHistory = useCallback((fn: (h: HistoryState) => HistoryState) => {
    setError(null);
    setState((prev) => ({ ...prev, draft: { ...prev.draft, history: fn(prev.draft.history) } }));
  }, []);

  const onChooseColor = useCallback(
    (color: Color) => {
      patch({ userColor: color });
      setOrientation(seedOrientation(color));
    },
    [patch],
  );

  const onConfirmPosition = useCallback(
    (nextFen: string) => {
      // Keeps the longest legal prefix of what has been entered so far; anything the new
      // position makes illegal is dropped and reported rather than silently kept.
      const rebased = rebaseHistory(nextFen, draftMoves(history));
      setEditingPosition(false);
      setPositionNotice(
        rebased.dropped > 0
          ? `${moveCountLabel(rebased.dropped)} ${rebased.dropped === 1 ? 'was' : 'were'} dropped: ` +
            `not legal from the new starting position.`
          : null,
      );
      patch({ history: rebased.history });
    },
    [history, patch],
  );

  const onSave = useCallback(() => {
    const validation = validateDraft(draft);
    if (!validation.ok) {
      setError(validation.error ?? 'This line cannot be saved yet.');
      return;
    }
    const input = toLineInput(draft);
    // Persist the SAN exactly as chess.js normalises it, so drill/line-play comparisons are
    // against canonical strings.
    input.moves = validation.moves;
    if (status === 'edit' && id !== undefined) {
      if (updateLine(id, input) === null) {
        setError('That line no longer exists — it may have been deleted in another tab.');
        return;
      }
    } else {
      createLine(input);
    }
    // A write that only reached the in-memory fallback still counts as saved for this session;
    // the list surfaces `storageWarning()` prominently, so it is reported there, not here.
    // Return to the line's *own* folder rather than where the user came from: after moving a
    // line to another folder, an empty list at the old location looks like the save failed.
    navigate(linesPath(input.folder ?? ''));
  }, [draft, id, navigate, status]);

  const leave = useCallback(
    (to: string) => {
      if (dirty) setPendingLeave(to);
      else navigate(to);
    },
    [dirty, navigate],
  );

  if (status === 'missing') {
    return (
      <Wrap data-testid="line-editor">
        <Panel title="Line not found">
          <EmptyBody data-testid="line-not-found">
            <p>There is no saved line with that id. It may have been deleted, or the link is old.</p>
            <Button variant="primary" onClick={() => navigate(backTo)}>
              Back to lines
            </Button>
          </EmptyBody>
        </Panel>
      </Wrap>
    );
  }

  if (editingPosition) {
    return (
      <Wrap data-testid="line-editor">
        <Panel
          title="Starting position"
          actions={
            <RotateButton
              orientation={orientation}
              onClick={() => setOrientation(flipOrientation)}
            />
          }
        >
          <PositionEditor
            initialFen={history.startFen}
            orientation={orientation}
            confirmLabel="Use this position"
            onConfirm={onConfirmPosition}
            onCancel={() => setEditingPosition(false)}
          />
        </Panel>
      </Wrap>
    );
  }

  const turn = sideToMove(history);

  return (
    <Wrap data-testid="line-editor">
      <TopBar>
        <Heading>{status === 'edit' ? 'Edit line' : 'New line'}</Heading>
        <Grow />
        <Button data-testid="cancel-edit" onClick={() => leave(backTo)}>
          {dirty ? 'Discard' : 'Back'}
        </Button>
        <Button variant="primary" data-testid="save-line" onClick={onSave}>
          Save
        </Button>
      </TopBar>

      {state.loadNotice !== null && (
        <Notice $tone="warn" role="alert" data-testid="load-notice">
          {state.loadNotice}
        </Notice>
      )}
      {error !== null && (
        <Notice $tone="error" role="alert" data-testid="save-error">
          <NoticeTitle>Cannot save yet</NoticeTitle>
          {error}
        </Notice>
      )}

      <Columns>
        <BoardColumn>
          <Panel
            title="Moves"
            actions={
              <RotateButton
                orientation={orientation}
                onClick={() => setOrientation(flipOrientation)}
              />
            }
          >
            <BoardStack>
              <Caption data-testid="editor-caption">
                {describeTurn(fen, turn)} · {moveCountLabel(savedMoves.length)} in this line
              </Caption>
              <BoardCell>
                <Board
                  fen={fen}
                  orientation={orientation}
                  onMove={onMove}
                  movableFor="both"
                  lastMove={lastMoveOf(history)}
                />
              </BoardCell>
              <ButtonRow>
                <Button
                  data-testid="undo-move"
                  disabled={isAtStart(history)}
                  onClick={() => setHistory(stepBack)}
                >
                  Undo
                </Button>
                <Button
                  data-testid="redo-move"
                  disabled={isAtEnd(history)}
                  onClick={() => setHistory(stepForward)}
                >
                  Redo
                </Button>
                <Button
                  variant="danger"
                  data-testid="clear-moves"
                  disabled={moves.length === 0}
                  onClick={() => setHistory((h) => createHistory(h.startFen))}
                >
                  Clear moves
                </Button>
              </ButtonRow>
              {undone > 0 && (
                <Notice $tone="warn" role="status" data-testid="undone-notice">
                  {moveCountLabel(undone)} after the cursor {undone === 1 ? 'has' : 'have'} been
                  undone and will not be saved. Press Redo to keep {undone === 1 ? 'it' : 'them'}.
                </Notice>
              )}
              <MoveList
                moves={moves}
                cursor={history.cursor}
                onJump={(index) => setHistory((h) => jumpTo(h, index))}
                startColor={startColor(history)}
                startMoveNumber={startMoveNumber(history)}
              />
            </BoardStack>
          </Panel>
        </BoardColumn>

        <FormColumn>
          <Panel title="Line">
            <Fields>
              <Field>
                <FieldLabel htmlFor="line-name">Name</FieldLabel>
                <TextInput
                  id="line-name"
                  value={draft.name}
                  placeholder="e.g. Najdorf — 6.Bg5 main line"
                  autoComplete="off"
                  data-testid="name-input"
                  onChange={(event) => patch({ name: event.target.value })}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="line-folder">Folder (optional)</FieldLabel>
                <TextInput
                  id="line-folder"
                  value={draft.folder}
                  placeholder="e.g. Black/Sicilian"
                  autoComplete="off"
                  list="line-folder-options"
                  data-testid="folder-input"
                  onChange={(event) => patch({ folder: event.target.value })}
                />
                {/* Folders are implicit: typing a path that does not exist yet creates it on
                    save, and the last line to leave a folder removes it. */}
                <datalist id="line-folder-options">
                  {knownFolders.map((path) => (
                    <option key={path} value={path} />
                  ))}
                </datalist>
                <Hint data-testid="folder-hint">
                  {normaliseFolderPath(draft.folder).length === 0
                    ? `Leave blank to keep this line in ${folderLabel('')}.`
                    : `Filed under ${normaliseFolderPath(draft.folder)}. Use “/” to nest.`}
                </Hint>
              </Field>

              <Field>
                <FieldLabel as="span">Trained as</FieldLabel>
                <ChipRow role="group" aria-label="Trained as">
                  {(['w', 'b'] as Color[]).map((color) => (
                    <Chip
                      key={color}
                      type="button"
                      $on={draft.userColor === color}
                      aria-pressed={draft.userColor === color}
                      data-testid={`color-${color}`}
                      onClick={() => onChooseColor(color)}
                    >
                      {colorLabel(color)}
                    </Chip>
                  ))}
                </ChipRow>
                <Hint>
                  The side you play in line play and drill. The other side is auto-played from the
                  line.
                </Hint>
              </Field>

              <Field>
                <FieldLabel as="span">Starting position</FieldLabel>
                <StartFen
                  $standard={isStandardStart(history.startFen)}
                  data-testid="start-fen"
                  title={history.startFen}
                >
                  {isStandardStart(history.startFen)
                    ? 'Standard start position'
                    : history.startFen}
                </StartFen>
                <ButtonRow>
                  <Button data-testid="edit-position" onClick={() => setEditingPosition(true)}>
                    Change position…
                  </Button>
                </ButtonRow>
                {positionNotice !== null && (
                  <Notice $tone="warn" role="status" data-testid="position-notice">
                    {positionNotice}
                  </Notice>
                )}
              </Field>

              <Field>
                <FieldLabel htmlFor="line-notes">Notes (optional)</FieldLabel>
                <TextArea
                  id="line-notes"
                  rows={4}
                  value={draft.notes}
                  placeholder="Ideas, traps, what to avoid…"
                  data-testid="notes-input"
                  onChange={(event) => patch({ notes: event.target.value })}
                />
              </Field>
            </Fields>
          </Panel>
        </FormColumn>
      </Columns>

      {pendingLeave !== null && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          onCancel={() => setPendingLeave(null)}
          onConfirm={() => {
            const to = pendingLeave;
            setPendingLeave(null);
            navigate(to);
          }}
        >
          This line has changes that have not been saved. Leaving now loses them.
        </ConfirmDialog>
      )}
    </Wrap>
  );
}

/** Board orientation that puts the trained colour at the bottom. */
function seedOrientation(color: Color): Orientation {
  return color === 'b' ? 'black' : 'white';
}

function describeTurn(fen: string, turn: Color): string {
  let status;
  try {
    status = createGame(fen).status();
  } catch {
    return 'Invalid position';
  }
  if (status.isCheckmate) return 'Checkmate — the line ends here';
  if (status.isStalemate) return 'Stalemate';
  const mover = colorLabel(turn);
  return status.inCheck ? `${mover} to move — in check` : `${mover} to move`;
}

/* ----------------------------------- styles ----------------------------------- */

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.md};
  min-width: 0;
`;

const TopBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${(p) => p.theme.space.sm};
  min-width: 0;
`;

const Heading = styled.h1`
  margin: 0;
  font-size: ${(p) => p.theme.font.size.xl};
`;

const Grow = styled.div`
  flex: 1 1 auto;
  min-width: 0;
`;

const Columns = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: ${(p) => p.theme.space.md};
  align-items: start;
  min-width: 0;

  @media ${(p) => p.theme.media.wide} {
    grid-template-columns: minmax(0, 1fr) minmax(280px, 400px);
    gap: ${(p) => p.theme.space.lg};
  }
`;

const BoardColumn = styled.div`
  min-width: 0;
`;

const FormColumn = styled.div`
  min-width: 0;
`;

const BoardStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.sm};
  min-width: 0;
`;

/** The board is square, so its width is also its height — cap it against the viewport height. */
const BoardCell = styled.div`
  width: 100%;
  min-width: 0;
  align-self: center;

  @media ${(p) => p.theme.media.wide} {
    max-width: min(560px, calc(100dvh - 300px));
  }
`;

const Caption = styled.p`
  margin: 0;
  color: ${(p) => p.theme.color.textMuted};
  font-size: ${(p) => p.theme.font.size.sm};
`;

const ButtonRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${(p) => p.theme.space.sm};
`;

const Fields = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.md};
  min-width: 0;
`;

const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.xs};
  min-width: 0;
`;

const FieldLabel = styled.label`
  font-size: ${(p) => p.theme.font.size.sm};
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: ${(p) => p.theme.color.textMuted};
`;

const Hint = styled.p`
  margin: 0;
  color: ${(p) => p.theme.color.textFaint};
  font-size: ${(p) => p.theme.font.size.sm};
`;

const TextInput = styled.input`
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 0 ${(p) => p.theme.space.sm};
  background: ${(p) => p.theme.color.bg};
  color: ${(p) => p.theme.color.text};
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radius.md};
  font-family: inherit;
  font-size: ${(p) => p.theme.font.size.md};

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.color.focus};
    outline-offset: 1px;
  }
`;

const TextArea = styled.textarea`
  width: 100%;
  min-width: 0;
  padding: ${(p) => p.theme.space.sm};
  background: ${(p) => p.theme.color.bg};
  color: ${(p) => p.theme.color.text};
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radius.md};
  font-family: inherit;
  font-size: ${(p) => p.theme.font.size.md};
  resize: vertical;

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.color.focus};
    outline-offset: 1px;
  }
`;

const ChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${(p) => p.theme.space.xs};
  min-width: 0;
`;

const Chip = styled.button<{ $on: boolean }>`
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0 ${(p) => p.theme.space.md};
  border: 1px solid ${(p) => (p.$on ? p.theme.color.accent : p.theme.color.border)};
  border-radius: ${(p) => p.theme.radius.md};
  background: ${(p) => (p.$on ? p.theme.color.accent : p.theme.color.surfaceAlt)};
  color: ${(p) => (p.$on ? p.theme.color.accentText : p.theme.color.text)};
  font-family: inherit;
  font-size: ${(p) => p.theme.font.size.md};
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.color.focus};
    outline-offset: 2px;
  }
`;

const StartFen = styled.p<{ $standard: boolean }>`
  margin: 0;
  min-width: 0;
  color: ${(p) => p.theme.color.text};
  font-family: ${(p) => (p.$standard ? p.theme.font.body : p.theme.font.mono)};
  font-size: ${(p) => p.theme.font.size.sm};
  overflow-wrap: anywhere;
`;

const EmptyBody = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: ${(p) => p.theme.space.md};
  color: ${(p) => p.theme.color.textMuted};
  max-width: 60ch;

  p {
    margin: 0;
  }
`;
