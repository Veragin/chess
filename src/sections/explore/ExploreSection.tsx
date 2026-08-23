/**
 * `#/training/explore` — free play on a board that keeps answering one question: **is this
 * covered?**
 *
 * A screen of the Training tab (routed by `TrainingSection`, reached from the Explore button
 * beside Drill) rather than a section of its own: what it reads and what it writes are both the
 * repertoire.
 *
 * It is the analyse screen's engine (eval bar + top lines, `engine/useEngine.ts`) next to the
 * repertoire's own answer for the same position (`./coverage.ts`): every saved line that
 * transposes here, and the move each of them plays next. Engine says `Nf3`, repertoire says
 * nothing — that is the gap the screen is for, and "Save as new line" is how it gets closed.
 *
 * Nothing stateful is reinvented:
 *  - the position and move list live in `state/explore.ts`, so navigating to Training to fix a
 *    line and coming back does not lose the exploration;
 *  - every history transition is `chess/history.ts` (playing a move mid-history truncates the
 *    future, exactly as in analyse);
 *  - the coverage index is pure, unit-tested and built once per line list, not per move;
 *  - saving hands the moves to `LineEditor` through `state/newLine.ts` rather than growing a
 *    second save form here.
 *
 * `?folder=` scopes which lines count as coverage, using the same convention (and the same URL
 * helpers) as the rest of Training, so "Explore" from inside a folder checks *that* repertoire —
 * and the way back out lands in that same folder.
 *
 * Layout follows analyse and the single 900px breakpoint (README §6): a thin eval strip and
 * stacked panels on a phone, eval strip beside the board with a side column on a wide screen.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import styled from 'styled-components';
import { Board } from '../../components/Board';
import { EngineLines } from '../../components/EngineLines';
import { EvalBar } from '../../components/EvalBar';
import { MoveList } from '../../components/MoveList';
import { Button, Panel, RotateButton } from '../../components/ui';
import { createGame, type MoveInput } from '../../chess/game';
import {
  applyMove,
  currentFen,
  jumpTo,
  lastMoveOf,
  sansOf,
  startColor,
  startMoveNumber,
} from '../../chess/history';
import { flipOrientation, START_FEN, type Orientation } from '../../chess/position';
import { useEngine } from '../../engine/useEngine';
import { useExploration } from '../../state/explore';
import { stageNewLine } from '../../state/newLine';
import { allFolderPaths, folderLabel, linesUnderFolder } from '../../storage/folders';
import { listLines } from '../../storage/lines';
import { normaliseFolderPath } from '../../storage/schema';
import { useIsWideLayout } from '../analyze/useIsWideLayout';
import { draftMoves } from '../training/lines/draft';
import { linesPath, newLineFromExplorePath } from '../training/lines/folderNav';
import { moveCountLabel } from '../training/lines/lineFormat';
import { CoveragePanel } from './CoveragePanel';
import { buildCoverageIndex, coverageAt } from './coverage';

export function ExploreSection() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const folder = normaliseFolderPath(params.get('folder'));
  const { history, setHistory, loadExploration } = useExploration();
  const [orientation, setOrientation] = useState<Orientation>('white');
  const wide = useIsWideLayout();

  const fen = currentFen(history);
  const { state: engine, analyze } = useEngine();

  useEffect(() => {
    analyze(fen);
  }, [analyze, fen]);

  // Read once per visit: the section unmounts on navigation, so going to Training, saving a
  // line and coming back re-reads the store — while a walk through the tree never does.
  const lines = useMemo(() => listLines(), []);
  const folders = useMemo(() => allFolderPaths(lines), [lines]);
  const scope = useMemo(() => linesUnderFolder(lines, folder), [lines, folder]);
  // Built from the scope, not from the position: one replay of each line, then a lookup per move.
  const index = useMemo(() => buildCoverageIndex(scope), [scope]);
  const coverage = useMemo(() => coverageAt(index, fen), [index, fen]);

  const onMove = useCallback(
    (move: MoveInput | string) => {
      const next = applyMove(history, move);
      if (next !== null) setHistory(next);
    },
    [history, setHistory],
  );

  const onJump = useCallback(
    (cursor: number) => {
      setHistory(jumpTo(history, cursor));
    },
    [history, setHistory],
  );

  const setScope = useCallback(
    (next: string) => {
      const normalised = normaliseFolderPath(next);
      if (normalised.length === 0) setParams({});
      else setParams({ folder: normalised });
    },
    [setParams],
  );

  /** Hands the moves up to the cursor to the line editor (see `state/newLine.ts`). */
  const saveAsLine = useCallback(() => {
    stageNewLine({
      startFen: history.startFen,
      moves: draftMoves(history),
      folder,
      // The side that moves first from the start position is the likelier side to train; the
      // editor shows it as a choice either way.
      userColor: startColor(history),
    });
    navigate(newLineFromExplorePath(folder));
  }, [folder, history, navigate]);

  const savable = draftMoves(history).length;
  const caption = useMemo(() => describePosition(fen), [fen]);

  // Only lines produced for the position on screen may drive the eval bar (README §8.4).
  const top = engine.fen === fen ? (engine.lines[0] ?? null) : null;

  const engineNotice =
    engine.status === 'error' ? (
      <Notice $tone="error" role="alert" data-testid="engine-notice">
        {engine.error ?? 'The engine failed to start.'}
      </Notice>
    ) : engine.status === 'loading' ? (
      <Notice role="status" data-testid="engine-notice">
        Loading Stockfish… the first load downloads about 7 MB.
      </Notice>
    ) : null;

  const toolbar = (
    <Toolbar>
      {/* Explore is not a tab, so the way back to the lines it compares against has to be on the
          screen — and it returns to the folder that scoped this exploration. */}
      <BackLink to={linesPath(folder)} data-testid="explore-back">
        ‹ Lines
      </BackLink>
      <Button data-testid="explore-start" onClick={() => loadExploration(START_FEN)}>
        Start position
      </Button>
      <ScopeField>
        <ScopeLabel htmlFor="explore-scope">Compare against</ScopeLabel>
        <ScopeSelect
          id="explore-scope"
          value={folder}
          data-testid="explore-scope"
          onChange={(event) => setScope(event.target.value)}
        >
          <option value="">{folderLabel('')}</option>
          {folders.map((path) => (
            <option key={path} value={path}>
              {path}
            </option>
          ))}
        </ScopeSelect>
      </ScopeField>
      <Caption data-testid="explore-caption">{caption}</Caption>
      <RotateButton orientation={orientation} onClick={() => setOrientation(flipOrientation)} />
    </Toolbar>
  );

  const board = (
    <Board
      fen={fen}
      orientation={orientation}
      onMove={onMove}
      lastMove={lastMoveOf(history)}
      movableFor="both"
    />
  );

  const coveragePanel = (
    <CoveragePanel
      coverage={coverage}
      scopeSize={scope.length}
      folder={folder}
      onPlay={onMove}
      brokenCount={index.broken.length}
    />
  );

  const engineLines = <EngineLines fen={fen} state={engine} />;

  const moveHistory = (
    <Panel
      title="Move history"
      actions={
        <Button
          size="sm"
          variant="primary"
          disabled={savable === 0}
          data-testid="explore-save-line"
          onClick={saveAsLine}
        >
          Save as new line
        </Button>
      }
      padded={false}
    >
      <HistoryBody>
        <MoveList
          moves={sansOf(history)}
          cursor={history.cursor}
          onJump={onJump}
          startColor={startColor(history)}
          startMoveNumber={startMoveNumber(history)}
        />
        <Hint data-testid="explore-save-hint">
          {savable === 0
            ? 'Play the moves you want to keep, then save them as a line.'
            : `Saves ${moveCountLabel(savable)} up to the cursor into ${folderLabel(folder)}.`}
        </Hint>
      </HistoryBody>
    </Panel>
  );

  return (
    <Section data-testid="explore-section" data-folder={folder}>
      {toolbar}
      {engineNotice}

      {wide ? (
        <WideGrid>
          <BoardArea>
            <EvalCell>
              <EvalBar
                cp={top?.cp ?? null}
                mate={top?.mate ?? null}
                orientation={orientation}
                layout="vertical"
              />
            </EvalCell>
            <BoardCell>{board}</BoardCell>
          </BoardArea>
          <SideColumn>
            {coveragePanel}
            {engineLines}
            {moveHistory}
          </SideColumn>
        </WideGrid>
      ) : (
        <>
          <EvalBar
            cp={top?.cp ?? null}
            mate={top?.mate ?? null}
            orientation={orientation}
            layout="horizontal"
          />
          {board}
          {coveragePanel}
          {engineLines}
          {moveHistory}
        </>
      )}
    </Section>
  );
}

/** "White to move", "Black is in check", "Checkmate — White wins", … */
function describePosition(fen: string): string {
  let status;
  try {
    status = createGame(fen).status();
  } catch {
    return 'Invalid position';
  }
  const mover = status.turn === 'w' ? 'White' : 'Black';
  if (status.isCheckmate) return `Checkmate — ${status.turn === 'w' ? 'Black' : 'White'} wins`;
  if (status.isStalemate) return 'Stalemate — draw';
  if (status.isDraw) return 'Draw';
  if (status.inCheck) return `${mover} to move — in check`;
  return `${mover} to move`;
}

/* ----------------------------------- styles ----------------------------------- */

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.md};
  min-width: 0;
`;

const Toolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${(p) => p.theme.space.sm};
  min-width: 0;
`;

const BackLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  min-height: 44px;
  color: ${(p) => p.theme.color.textMuted};
  font-size: ${(p) => p.theme.font.size.sm};
  text-decoration: none;

  &:hover {
    color: ${(p) => p.theme.color.text};
  }
`;

const ScopeField = styled.div`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.space.xs};
  min-width: 0;
`;

const ScopeLabel = styled.label`
  color: ${(p) => p.theme.color.textMuted};
  font-size: ${(p) => p.theme.font.size.sm};
  white-space: nowrap;
`;

const ScopeSelect = styled.select`
  max-width: 16rem;
  min-width: 0;
  min-height: 36px;
  padding: 0 ${(p) => p.theme.space.sm};
  background: ${(p) => p.theme.color.surfaceAlt};
  color: ${(p) => p.theme.color.text};
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radius.md};
  font-family: inherit;
  font-size: ${(p) => p.theme.font.size.sm};

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.color.focus};
    outline-offset: 1px;
  }
`;

const Caption = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  color: ${(p) => p.theme.color.textMuted};
  font-size: ${(p) => p.theme.font.size.sm};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  @media ${(p) => p.theme.media.wide} {
    text-align: right;
  }
`;

const Notice = styled.p<{ $tone?: 'error' }>`
  margin: 0;
  padding: ${(p) => p.theme.space.sm} ${(p) => p.theme.space.md};
  border: 1px solid ${(p) => (p.$tone === 'error' ? p.theme.color.danger : p.theme.color.border)};
  border-radius: ${(p) => p.theme.radius.md};
  background: ${(p) => p.theme.color.surface};
  color: ${(p) => (p.$tone === 'error' ? p.theme.color.danger : p.theme.color.textMuted)};
  font-size: ${(p) => p.theme.font.size.sm};
`;

const WideGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(272px, 360px);
  gap: ${(p) => p.theme.space.lg};
  align-items: start;
  min-width: 0;
`;

/** Row of [eval strip, board]; see the same comment in `AnalyzeSection`. */
const BoardArea = styled.div`
  display: flex;
  align-items: stretch;
  justify-content: center;
  gap: ${(p) => p.theme.space.md};
  min-width: 0;
`;

const EvalCell = styled.div`
  display: flex;
  flex: 0 0 auto;
`;

const BoardCell = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  max-width: min(720px, calc(100dvh - 190px));
`;

const SideColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.md};
  min-width: 0;
`;

const HistoryBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.sm};
  padding: ${(p) => p.theme.space.sm};
  min-width: 0;
`;

const Hint = styled.p`
  margin: 0;
  color: ${(p) => p.theme.color.textFaint};
  font-size: ${(p) => p.theme.font.size.sm};
`;
