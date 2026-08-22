/**
 * The editable grid used by `PositionEditor`.
 *
 * Deliberately NOT `Board`: `Board` owns move-based interaction (legal destinations, promotion
 * dialog) and would refuse everything the editor needs. This renders the same `Square`/`Piece`
 * primitives so the two look identical, and reports raw pointer events upwards — all editing
 * decisions live in `PositionEditor`, and all model changes in `chess/editor.ts`.
 */

import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import styled from 'styled-components';
import { pieceAt, type EditorModel } from '../../chess/editor';
import {
  fileLabels,
  orderedSquares,
  rankLabels,
  squareShade,
  type Orientation,
  type Square,
} from '../../chess/position';
import { Piece } from '../Board/Piece';
import { Square as BoardSquare } from '../Board/Square';

const ROWS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

const Grid = styled.div`
  position: relative;
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  grid-template-rows: repeat(8, 1fr);
  width: 100%;
  aspect-ratio: 1;
  container-type: inline-size;
  border-radius: ${(p) => p.theme.radius.sm};
  overflow: hidden;
  /* Pointer Events only (README §8.6): no browser pan/zoom stealing a drag. */
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
`;

const GridRow = styled.div`
  display: contents;
`;

export interface EditorBoardProps {
  model: EditorModel;
  orientation: Orientation;
  /** Needed by the parent for pointer→square maths during a drag. */
  gridRef: RefObject<HTMLDivElement | null>;
  /** Square whose piece is being dragged away; rendered faded. */
  draggingFrom?: Square | null;
  /** Square currently under the pointer during a drag; highlighted as the drop target. */
  hoverSquare?: Square | null;
  onSquarePointerDown: (square: Square, event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

export function EditorBoard({
  model,
  orientation,
  gridRef,
  draggingFrom = null,
  hoverSquare = null,
  onSquarePointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: EditorBoardProps) {
  const squares = orderedSquares(orientation);
  const files = fileLabels(orientation);
  const ranks = rankLabels(orientation);

  return (
    <Grid
      ref={gridRef}
      role="grid"
      aria-label="Position editor board"
      data-orientation={orientation}
      data-testid="editor-board"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(event) => event.preventDefault()}
    >
      {ROWS.map((row) => (
        <GridRow role="row" key={row}>
          {ROWS.map((col) => {
            const square = squares[row * 8 + col] as Square;
            const piece = pieceAt(model, square);
            return (
              <BoardSquare
                key={square}
                square={square}
                shade={squareShade(square)}
                selected={hoverSquare === square}
                marker="none"
                lastMove={false}
                check={false}
                grabbable={piece !== null}
                rankLabel={col === 0 ? ranks[row] : undefined}
                fileLabel={row === 7 ? files[col] : undefined}
                pieceLabel={
                  piece === null ? undefined : `${piece.color === 'w' ? 'white' : 'black'} ${piece.type}`
                }
                onPointerDown={onSquarePointerDown}
              >
                {piece !== null && (
                  <Piece color={piece.color} type={piece.type} faded={draggingFrom === square} />
                )}
              </BoardSquare>
            );
          })}
        </GridRow>
      ))}
    </Grid>
  );
}
