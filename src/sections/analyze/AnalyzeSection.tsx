/**
 * Analyze section (README §7 Phase 4): free exploration with a continuous Stockfish evaluation.
 *
 * The user moves BOTH colours — there is no engine opponent (README §1). Everything stateful is
 * borrowed rather than reinvented: the position and move list live in `state/analysis.ts` (so
 * they survive navigating away and back), all history transitions in `chess/history.ts`, and the
 * engine in `engine/useEngine.ts`.
 *
 * Layout is mobile-first with the single 900px breakpoint (README §6):
 *  - narrow: thin horizontal eval strip, board full width, engine lines + move list in one panel
 *    below;
 *  - wide: vertical eval strip left of the board, engine lines above the move list on the right.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { EngineLines } from '../../components/EngineLines';
import { EvalBar } from '../../components/EvalBar';
import { MoveList } from '../../components/MoveList';
import { Board } from '../../components/Board';
import { PositionEditor } from '../../components/PositionEditor';
import { Button, Panel, RotateButton } from '../../components/ui';
import { createGame, type MoveInput } from '../../chess/game';
import {
  currentFen,
  jumpTo,
  lastMoveOf,
  sansOf,
  startColor,
  startMoveNumber,
  applyMove,
} from '../../chess/history';
import { flipOrientation, START_FEN, type Orientation } from '../../chess/position';
import { useEngine } from '../../engine/useEngine';
import { useAnalysis } from '../../state/analysis';
import { useIsWideLayout } from './useIsWideLayout';

export function AnalyzeSection() {
  const { history, setHistory, loadPosition } = useAnalysis();
  const [orientation, setOrientation] = useState<Orientation>('white');
  const [editing, setEditing] = useState(false);
  const wide = useIsWideLayout();

  const fen = currentFen(history);
  // While the position editor is open there is nothing to analyse: idling the engine keeps a
  // phone's CPU (and battery) out of it.
  const { state: engine, analyze } = useEngine({ enabled: !editing });

  useEffect(() => {
    if (editing) return;
    analyze(fen);
  }, [analyze, editing, fen]);

  const onMove = useCallback(
    (move: MoveInput) => {
      // Truncating the future when the cursor is mid-history is `applyMove`'s job.
      const next = applyMove(history, move);
      if (next !== null) setHistory(next);
    },
    [history, setHistory],
  );

  const onJump = useCallback(
    (index: number) => {
      setHistory(jumpTo(history, index));
    },
    [history, setHistory],
  );

  const startFresh = useCallback(() => {
    setEditing(false);
    setOrientation('white');
    loadPosition(START_FEN);
  }, [loadPosition]);

  const confirmCustom = useCallback(
    (customFen: string) => {
      loadPosition(customFen);
      setEditing(false);
    },
    [loadPosition],
  );

  const caption = useMemo(() => describePosition(fen), [fen]);

  // Only lines produced for the position on screen may drive the eval bar (README §8.4) —
  // otherwise flicking through the history leaves a stale number behind.
  const top = engine.fen === fen ? (engine.lines[0] ?? null) : null;

  const moves = sansOf(history);

  if (editing) {
    return (
      <Panel
        title="Custom position"
        actions={
          <RotateButton orientation={orientation} onClick={() => setOrientation(flipOrientation)} />
        }
      >
        <PositionEditor
          initialFen={fen}
          orientation={orientation}
          confirmLabel="Start analysis"
          onConfirm={confirmCustom}
          onCancel={() => setEditing(false)}
        />
      </Panel>
    );
  }

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
      <Button data-testid="start-position" onClick={startFresh}>
        Start position
      </Button>
      <Button data-testid="custom-position" onClick={() => setEditing(true)}>
        Custom position…
      </Button>
      <Caption data-testid="turn-caption">{caption}</Caption>
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

  const engineLines = <EngineLines fen={fen} state={engine} />;
  const moveList = (
    <MoveList
      moves={moves}
      cursor={history.cursor}
      onJump={onJump}
      startColor={startColor(history)}
      startMoveNumber={startMoveNumber(history)}
    />
  );

  return (
    <Section data-testid="analyze-section">
      {toolbar}
      {engineNotice}

      {wide ? (
        <WideGrid>
          <BoardArea>
            <EvalCell>
              <EvalBar cp={top?.cp ?? null} mate={top?.mate ?? null} orientation={orientation} layout="vertical" />
            </EvalCell>
            <BoardCell>{board}</BoardCell>
          </BoardArea>
          <SideColumn>
            {engineLines}
            {moveList}
          </SideColumn>
        </WideGrid>
      ) : (
        <>
          <EvalBar cp={top?.cp ?? null} mate={top?.mate ?? null} orientation={orientation} layout="horizontal" />
          {board}
          <Panel title="Analysis" padded={false}>
            <NarrowPanelBody>
              {engineLines}
              {moveList}
            </NarrowPanelBody>
          </Panel>
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
  if (status.isCheckmate) {
    return `Checkmate — ${status.turn === 'w' ? 'Black' : 'White'} wins`;
  }
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
  border: 1px solid
    ${(p) => (p.$tone === 'error' ? p.theme.color.danger : p.theme.color.border)};
  border-radius: ${(p) => p.theme.radius.md};
  background: ${(p) => p.theme.color.surface};
  color: ${(p) => (p.$tone === 'error' ? p.theme.color.danger : p.theme.color.textMuted)};
  font-size: ${(p) => p.theme.font.size.sm};
`;

const WideGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(272px, 340px);
  gap: ${(p) => p.theme.space.lg};
  align-items: start;
  min-width: 0;
`;

/**
 * Row of [eval strip, board]. `align-items: stretch` with the board as the only item that has a
 * height (its own `aspect-ratio: 1`) gives the vertical `EvalBar` the definite-height parent it
 * needs — a percentage height against `min-height` alone resolves to nothing.
 */
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
  /* The board is square, so its width is also its height: cap it against the viewport height so
     a wide window never pushes the bottom of the board (or the toolbar) off-screen. */
  max-width: min(720px, calc(100dvh - 190px));
`;

const SideColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.md};
  min-width: 0;
`;

const NarrowPanelBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.sm};
  padding: ${(p) => p.theme.space.sm};
  min-width: 0;
`;
