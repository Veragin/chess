/**
 * `#/training/new` and `#/training/:id/edit` — the line editor (README §7 Phase 5).
 *
 * Fields: name, folder, trained-as colour, starting position, notes, and the move tree itself,
 * entered by playing moves on the board — playing a different move anywhere in the line adds a
 * branch from there — with an optional comment and threats on every move.
 *
 * The folder is **picked, not typed**: a select of every folder the repertoire already has, with
 * the folder this line came from (`?folder=`, or the line's own on an edit) already selected — so
 * "New line" inside a folder files it there with nothing to choose. Folders are still implicit
 * (`storage/folders.ts`), so the last option, "New folder…", swaps in the free-text field that
 * creates one on save.
 *
 * What this file deliberately does NOT own:
 *  - the starting position editor — that is Phase 4's `components/PositionEditor`, reused as the
 *    spec requires;
 *  - move-tree mechanics — `chess/treeHistory.ts` (playing at the cursor, navigation, delete,
 *    make main line, comments, rebasing onto a new start position);
 *  - the tree view — `components/MoveTree`;
 *  - validation, dirty-tracking and the draft→`Line` mapping — `./lines/draft.ts`, unit-tested.
 *
 * Editing semantics are documented in `./lines/draft.ts`: nothing is ever truncated, and the
 * saved line is the whole tree. A branch is added by selecting a move's parent in the tree and
 * playing a different move.
 *
 * Threats (`chess/threats.ts`) are entered on the board too: "Add threat" hands the turn back to
 * the side that just moved, and every move played is recorded as a threat of the selected move
 * instead of joining the tree, until "Done".
 */

import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import styled, { useTheme } from 'styled-components';
import { Board } from '../../components/Board';
import { MoveTree } from '../../components/MoveTree';
import { PositionEditor } from '../../components/PositionEditor';
import { Button, Panel, RotateButton } from '../../components/ui';
import { createGame, type Color, type MoveInput } from '../../chess/game';
import { flipOrientation, type Orientation } from '../../chess/position';
import { threatFen, threatMarks, threatSan } from '../../chess/threats';
import type { NodePath } from '../../chess/tree';
import {
  applyMoveAt,
  canPromote,
  commentAt,
  deleteFromCursor,
  fenAt,
  isAtStart,
  jumpTo,
  lastMoveAt,
  moveLabelAt,
  movesFromCursor,
  promoteToMainLine,
  rebaseTree,
  setCommentAt,
  sideToMoveAt,
  startColorOf,
  startMoveNumberOf,
  setThreatsAt,
  threatsAt,
  type TreeHistoryState,
} from '../../chess/treeHistory';
import { allFolderPaths, folderLabel } from '../../storage/folders';
import { createLine, getLine, isServerLine, listLines, updateLine } from '../../storage/lines';
import { normaliseFolderPath } from '../../storage/schema';
import { clearStagedLine, peekStagedLine, type StagedLine } from '../../state/newLine';
import { ConfirmDialog } from './lines/ConfirmDialog';
import { linesPath } from './lines/folderNav';
import { Notice, NoticeTitle } from './lines/Notice';
import {
  draftFromLine,
  emptyDraft,
  isDirty,
  loadMoves,
  toLineInput,
  validateDraft,
  type LineDraft,
} from './lines/draft';
import { colorLabel, isStandardStart, lineSizeLabel, moveCountLabel } from './lines/lineFormat';

/**
 * Sentinel value of the folder picker's last option. Not a legal folder path — `/` is the path
 * separator, so `normaliseFolderPath` can never produce this string from anything typed.
 */
const NEW_FOLDER = '/new-folder/';

interface EditorState {
  /** The `:id` this state was built for; used to re-seed when the route changes in place. */
  routeId: string | null;
  status: 'new' | 'edit' | 'missing';
  draft: LineDraft;
  /** What was loaded (or a blank draft), for the unsaved-changes check. */
  baseline: LineDraft;
  /** Set when loading a stored line had to drop moves that no longer replay. */
  loadNotice: string | null;
  /** Editing a bundled line: saving stores the user's own copy (see `storage/lines.ts`). */
  server?: boolean;
}

/** A "Delete from here" waiting for confirmation. */
interface PendingRemoval {
  /** How many moves it removes. */
  count: number;
  /** `12…Nf3`, for the dialog text. */
  label: string | null;
}

function seedState(
  id: string | undefined,
  folder: string,
  staged: StagedLine | null,
): EditorState {
  if (id === undefined) {
    // A new line lands in whichever folder the list was showing, so "New line" inside a folder
    // files it there without the user having to retype the path.
    const draft = emptyDraft(folder);
    if (staged === null) {
      return { routeId: null, status: 'new', draft, baseline: draft, loadNotice: null };
    }
    // Moves handed over by explore or analyse — a linear list, loaded as a single-branch tree.
    // Replayed rather than trusted: the staged list came from a live board, but the editor
    // re-derives every position it shows from the start FEN anyway.
    const rebased = loadMoves(staged.startFen, staged.moves);
    const seeded: LineDraft = {
      ...draft,
      folder: normaliseFolderPath(staged.folder),
      userColor: staged.userColor,
      history: rebased.history,
    };
    return {
      routeId: null,
      status: 'new',
      draft: seeded,
      // A blank baseline, so leaving without saving still counts as discarding something.
      baseline: draft,
      loadNotice:
        rebased.dropped > 0
          ? `${rebased.dropped} handed-over move(s) could not be replayed and were dropped.`
          : null,
    };
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
    server: isServerLine(line),
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
  const theme = useTheme();
  // Where the user came from in the list, and (for a new line) the folder to file it in.
  const [params] = useSearchParams();
  const fromFolder = normaliseFolderPath(params.get('folder'));
  const backTo = linesPath(fromFolder);
  // Only a hand-off that says so may claim the staged moves (see `state/newLine.ts`); peeking is
  // side-effect-free, so it is safe here and under StrictMode's double-invoked initialisers.
  const handoff = params.get('from');
  const staged = handoff === 'explore' || handoff === 'analyze' ? peekStagedLine() : null;

  const [state, setState] = useState<EditorState>(() => seedState(id, fromFolder, staged));
  /** Existing folder paths, for the folder picker. Read once — the editor is the writer. */
  const knownFolders = useMemo(() => allFolderPaths(listLines()), []);
  /** True while the folder is being typed rather than picked (a folder that does not exist yet). */
  const [typingFolder, setTypingFolder] = useState(false);
  const [orientation, setOrientation] = useState<Orientation>(() =>
    seedOrientation(state.draft.userColor),
  );
  const [editingPosition, setEditingPosition] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [positionNotice, setPositionNotice] = useState<string | null>(null);
  /** Non-null while the "discard unsaved changes?" dialog is open; holds where to go next. */
  const [pendingLeave, setPendingLeave] = useState<string | null>(null);
  /** Non-null while "Delete from here" waits for confirmation. */
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);
  /**
   * While adding threats: the cursor (as `pathKey`) they are being added to. Moving the cursor
   * ends the mode by derivation, without a state-resetting effect.
   */
  const [threatModeAt, setThreatModeAt] = useState<string | null>(null);

  // `Routes` renders `<LineEditor />` at the same position for both /new and /:id/edit, so the
  // component instance can survive an id change. Re-seed during render (React's documented
  // "adjust state when a prop changes" pattern) rather than in an effect, which would paint the
  // wrong line for one frame.
  if (state.routeId !== (id ?? null)) {
    const next = seedState(id, fromFolder, staged);
    setState(next);
    setOrientation(seedOrientation(next.draft.userColor));
    setTypingFolder(false);
    setEditingPosition(false);
    setError(null);
    setPositionNotice(null);
    setPendingLeave(null);
    setPendingRemoval(null);
    setThreatModeAt(null);
  }

  const { draft, baseline, status } = state;
  const history = draft.history;

  const patch = useCallback((next: Partial<LineDraft>) => {
    setError(null);
    setState((prev) => ({ ...prev, draft: { ...prev.draft, ...next } }));
  }, []);

  /**
   * Every way out of the editor. A staged hand-off is over the moment the editor closes —
   * saved, discarded or abandoned — so it is dropped here rather than at each exit.
   */
  const goTo = useCallback(
    (to: string) => {
      clearStagedLine();
      navigate(to);
    },
    [navigate],
  );

  /** The draft's folder as it will be stored — also what the picker shows as selected. */
  const selectedFolder = normaliseFolderPath(draft.folder);
  /**
   * What the picker offers: every folder some line already names, plus this line's own folder.
   * The latter matters for a line filed somewhere that no longer exists (its last sibling was
   * moved away) — the option has to be there or the select would silently show something else.
   */
  const folderOptions = useMemo(() => {
    if (selectedFolder.length === 0 || knownFolders.includes(selectedFolder)) return knownFolders;
    return [...knownFolders, selectedFolder].sort((a, b) => a.localeCompare(b));
  }, [knownFolders, selectedFolder]);

  const dirty = useMemo(() => isDirty(draft, baseline), [draft, baseline]);
  const fen = useMemo(() => fenAt(history), [history]);
  const lastMove = useMemo(() => lastMoveAt(history), [history]);
  const cursorLabel = moveLabelAt(history, history.cursor);
  const threats = threatsAt(history);
  /** The position with the turn handed back, where threats are played; null when impossible. */
  const threatBoardFen = useMemo(() => threatFen(fen), [fen]);
  const addingThreat =
    threatModeAt === pathKey(history.cursor) && !isAtStart(history) && threatBoardFen !== null;
  const threatArrows = useMemo(
    () =>
      threatMarks(fen, threats).map((threat) => ({
        from: threat.from,
        to: threat.to,
        color: theme.board.threat,
      })),
    [fen, threats, theme],
  );

  const onMove = useCallback(
    (move: MoveInput) => {
      setError(null);
      setState((prev) => {
        const next = applyMoveAt(prev.draft.history, move);
        if (next === null) return prev;
        return { ...prev, draft: { ...prev.draft, history: next } };
      });
    },
    [],
  );

  const setHistory = useCallback((fn: (h: TreeHistoryState) => TreeHistoryState) => {
    setError(null);
    setState((prev) => ({ ...prev, draft: { ...prev.draft, history: fn(prev.draft.history) } }));
  }, []);

  /** A move played while adding threats: recorded on the selected move, the tree is untouched. */
  const onThreat = useCallback(
    (move: MoveInput) => {
      const san = threatSan(fen, move);
      if (san === null || threats.includes(san)) return;
      setHistory((h) => setThreatsAt(h, [...threatsAt(h), san]));
    },
    [fen, threats, setHistory],
  );

  /** Pure navigation: never clears a save error, since nothing that is saved changed. */
  const onSelect = useCallback((path: NodePath) => {
    setState((prev) => ({
      ...prev,
      draft: { ...prev.draft, history: jumpTo(prev.draft.history, path) },
    }));
  }, []);

  /** "Delete from here": straight away for a single move, after a confirmation for more. */
  const onDeleteFromHere = useCallback(() => {
    const count = movesFromCursor(history);
    if (count === 0) return;
    if (count === 1) setHistory(deleteFromCursor);
    else setPendingRemoval({ count, label: moveLabelAt(history, history.cursor) });
  }, [history, setHistory]);

  const onConfirmRemoval = useCallback(() => {
    const removal = pendingRemoval;
    setPendingRemoval(null);
    if (removal === null) return;
    setHistory(deleteFromCursor);
  }, [pendingRemoval, setHistory]);

  const onChooseColor = useCallback(
    (color: Color) => {
      patch({ userColor: color });
      setOrientation(seedOrientation(color));
    },
    [patch],
  );

  const onConfirmPosition = useCallback(
    (nextFen: string) => {
      // Keeps every move (and branch, and comment) still legal from the new position; anything
      // it makes illegal is dropped with its continuations and reported rather than silently kept.
      const rebased = rebaseTree(history, nextFen);
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
    // Persist the validated tree: every branch and comment, SANs exactly as chess.js normalises
    // them (so drill comparisons are against canonical strings), duplicate siblings merged.
    const input = toLineInput(draft, validation.tree);
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
    goTo(linesPath(input.folder ?? ''));
  }, [draft, goTo, id, status]);

  const leave = useCallback(
    (to: string) => {
      if (dirty) setPendingLeave(to);
      else goTo(to);
    },
    [dirty, goTo],
  );

  if (status === 'missing') {
    return (
      <Wrap data-testid="line-editor">
        <Panel title="Line not found">
          <EmptyBody data-testid="line-not-found">
            <p>There is no saved line with that id. It may have been deleted, or the link is old.</p>
            <Button variant="primary" onClick={() => goTo(backTo)}>
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

  const turn = sideToMoveAt(history);
  const atStart = isAtStart(history);

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

      {state.server === true && (
        <Notice $tone="info" data-testid="server-line-notice">
          This is a bundled line. Saving stores your own copy in place of it; the bundled
          original stays out of your list.
        </Notice>
      )}
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
                {describeTurn(fen, turn)} · {lineSizeLabel(history.tree)} in this line
              </Caption>
              <BoardCell>
                <Board
                  fen={addingThreat && threatBoardFen !== null ? threatBoardFen : fen}
                  orientation={orientation}
                  onMove={addingThreat ? onThreat : onMove}
                  movableFor="both"
                  lastMove={lastMove}
                  arrows={threatArrows}
                />
              </BoardCell>
              <ButtonRow>
                <Button
                  data-testid="make-main-line"
                  disabled={!canPromote(history)}
                  title="Make this move's branch the main line"
                  onClick={() => setHistory(promoteToMainLine)}
                >
                  Make main line
                </Button>
                <Button
                  variant="danger"
                  data-testid="delete-from-here"
                  disabled={atStart}
                  title="Remove this move and everything after it"
                  onClick={onDeleteFromHere}
                >
                  Delete from here
                </Button>
              </ButtonRow>
              <MoveTree
                tree={history.tree}
                cursor={history.cursor}
                onSelect={onSelect}
                startColor={startColorOf(history)}
                startMoveNumber={startMoveNumberOf(history)}
                keyboardNavigation={pendingRemoval === null && pendingLeave === null}
              />
              <Field>
                <FieldLabel htmlFor="move-comment">
                  {cursorLabel === null ? (
                    'Comment'
                  ) : (
                    <>
                      Comment on <MoveRef>{cursorLabel}</MoveRef>
                    </>
                  )}
                </FieldLabel>
                <TextArea
                  id="move-comment"
                  rows={2}
                  disabled={atStart}
                  value={commentAt(history)}
                  placeholder={
                    atStart ? 'Select a move to comment on it' : 'What to know about this move…'
                  }
                  data-testid="comment-input"
                  onChange={(event) => {
                    const text = event.target.value;
                    setHistory((h) => setCommentAt(h, text));
                  }}
                />
                {atStart && (
                  <Hint>Comments belong to a move — play or select one in the tree above.</Hint>
                )}
              </Field>
              <Field>
                <FieldLabel as="span" id="move-threats-label">
                  {cursorLabel === null ? (
                    'Threats'
                  ) : (
                    <>
                      Threats after <MoveRef>{cursorLabel}</MoveRef>
                    </>
                  )}
                </FieldLabel>
                <ThreatRow role="group" aria-labelledby="move-threats-label">
                  {threats.map((move) => (
                    <ThreatChip key={move} data-testid="threat-chip">
                      <MoveRef>{move}</MoveRef>
                      <ThreatRemove
                        type="button"
                        aria-label={`Remove threat ${move}`}
                        title="Remove this threat"
                        onClick={() =>
                          setHistory((h) => setThreatsAt(h, threatsAt(h).filter((t) => t !== move)))
                        }
                      >
                        ×
                      </ThreatRemove>
                    </ThreatChip>
                  ))}
                  <Button
                    variant={addingThreat ? 'primary' : undefined}
                    data-testid="add-threat"
                    disabled={atStart || threatBoardFen === null}
                    title={
                      threatBoardFen === null && !atStart
                        ? 'The side to move is in check — there is nothing to threaten'
                        : 'Play the moves this position threatens on the board'
                    }
                    onClick={() =>
                      setThreatModeAt(addingThreat ? null : pathKey(history.cursor))
                    }
                  >
                    {addingThreat ? 'Done' : 'Add threat'}
                  </Button>
                </ThreatRow>
                {addingThreat && (
                  <Hint data-testid="threat-hint">
                    Play a move {colorLabel(turn === 'w' ? 'b' : 'w')} threatens on the board; it
                    is recorded as a threat, not added to the line.
                  </Hint>
                )}
                {atStart && <Hint>Threats belong to a move, like comments.</Hint>}
              </Field>
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
                <FieldLabel htmlFor="line-folder">Folder</FieldLabel>
                {typingFolder ? (
                  <>
                    <TextInput
                      id="line-folder"
                      autoFocus
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
                    <ButtonRow>
                      <Button
                        data-testid="folder-pick-existing"
                        onClick={() => setTypingFolder(false)}
                      >
                        Pick an existing folder
                      </Button>
                    </ButtonRow>
                  </>
                ) : (
                  /* Pre-selected to the folder the line came from, so "New line" inside a folder
                     files it there with nothing to choose or retype. */
                  <FolderSelect
                    id="line-folder"
                    value={selectedFolder}
                    data-testid="folder-select"
                    onChange={(event) => {
                      if (event.target.value === NEW_FOLDER) setTypingFolder(true);
                      else patch({ folder: event.target.value });
                    }}
                  >
                    <option value="">{folderLabel('')}</option>
                    {folderOptions.map((path) => (
                      <option key={path} value={path}>
                        {path}
                      </option>
                    ))}
                    <option value={NEW_FOLDER}>New folder…</option>
                  </FolderSelect>
                )}
                <Hint data-testid="folder-hint">
                  {selectedFolder.length === 0
                    ? `This line stays in ${folderLabel('')}.`
                    : `Filed under ${selectedFolder}. Use “/” to nest.`}
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

      {pendingRemoval !== null && (
        <ConfirmDialog
          title="Delete these moves?"
          confirmLabel="Delete"
          onCancel={() => setPendingRemoval(null)}
          onConfirm={onConfirmRemoval}
        >
          {`This removes ${pendingRemoval.label ?? 'this move'} and everything after it — ` +
            `${moveCountLabel(pendingRemoval.count)} in all, comments included.`}{' '}
          Nothing is saved until you press Save.
        </ConfirmDialog>
      )}

      {pendingLeave !== null && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          onCancel={() => setPendingLeave(null)}
          onConfirm={() => {
            const to = pendingLeave;
            setPendingLeave(null);
            goTo(to);
          }}
        >
          This line has changes that have not been saved. Leaving now loses them.
        </ConfirmDialog>
      )}
    </Wrap>
  );
}

/** A cursor as a comparable string. */
function pathKey(path: NodePath): string {
  return path.join('.');
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

/** A move inside an uppercase label: SAN is case-sensitive (`Bc4` vs `bc4`), so keep it as is. */
const MoveRef = styled.span`
  font-family: ${(p) => p.theme.font.mono};
  letter-spacing: 0;
  text-transform: none;
`;

const ThreatRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${(p) => p.theme.space.sm};
`;

const ThreatChip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: ${(p) => p.theme.space.xs};
  min-height: 36px;
  padding: 0 ${(p) => p.theme.space.xs} 0 ${(p) => p.theme.space.sm};
  background: ${(p) => p.theme.color.bg};
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radius.md};
`;

const ThreatRemove = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: none;
  border: none;
  border-radius: ${(p) => p.theme.radius.sm};
  color: ${(p) => p.theme.color.textMuted};
  font-size: ${(p) => p.theme.font.size.md};
  cursor: pointer;

  &:hover {
    color: ${(p) => p.theme.color.text};
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.color.focus};
  }
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

const FolderSelect = styled.select`
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

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

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
