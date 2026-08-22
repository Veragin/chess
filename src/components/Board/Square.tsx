import { memo, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import styled from 'styled-components';
import type { Square as SquareName } from '../../chess/position';

export type DestinationMarker = 'none' | 'quiet' | 'capture';
export type ExtraHighlight = 'error' | 'hint' | 'success';

const Cell = styled.div<{ $shade: 'light' | 'dark'; $grabbable: boolean }>`
  position: relative;
  min-width: 0;
  min-height: 0;
  background: ${(p) => (p.$shade === 'light' ? p.theme.board.light : p.theme.board.dark)};
  cursor: ${(p) => (p.$grabbable ? 'grab' : 'default')};
  -webkit-tap-highlight-color: transparent;
`;

const Overlay = styled.span`
  position: absolute;
  inset: 0;
  pointer-events: none;
`;

const LastMoveTint = styled(Overlay)`
  background: ${(p) => p.theme.board.lastMove};
`;

const SelectedTint = styled(Overlay)`
  background: ${(p) => p.theme.board.selected};
  opacity: 0.55;
`;

const CheckGlow = styled(Overlay)`
  background: radial-gradient(
    circle at center,
    ${(p) => p.theme.board.check} 0%,
    ${(p) => p.theme.board.check} 30%,
    rgba(0, 0, 0, 0) 78%
  );
`;

const ExtraTint = styled(Overlay)<{ $kind: ExtraHighlight }>`
  background: ${(p) => p.theme.board[p.$kind]};
  box-shadow: inset 0 0 0 clamp(2px, 0.9cqi, 5px) ${(p) => p.theme.board[p.$kind]};
`;

/** Quiet legal destination: a centred dot. */
const QuietDot = styled(Overlay)`
  display: grid;
  place-items: center;

  &::after {
    content: '';
    width: 30%;
    height: 30%;
    border-radius: 50%;
    background: ${(p) => p.theme.board.legal};
  }
`;

/** Capturing legal destination: a ring hugging the square edge, so the piece stays visible. */
const CaptureRing = styled(Overlay)`
  border-radius: 50%;
  box-shadow: inset 0 0 0 clamp(3px, 1.4cqi, 8px) ${(p) => p.theme.board.legalCapture};
`;

const Coordinate = styled.span<{ $shade: 'light' | 'dark' }>`
  position: absolute;
  font-size: clamp(8px, 2.3cqi, 18px);
  font-weight: 700;
  line-height: 1;
  pointer-events: none;
  user-select: none;
  color: ${(p) => (p.$shade === 'light' ? p.theme.board.coordinate : p.theme.board.light)};
`;

const RankCoordinate = styled(Coordinate)`
  top: 4%;
  left: 5%;
`;

const FileCoordinate = styled(Coordinate)`
  right: 5%;
  bottom: 4%;
`;

export interface SquareProps {
  square: SquareName;
  shade: 'light' | 'dark';
  selected: boolean;
  marker: DestinationMarker;
  lastMove: boolean;
  check: boolean;
  extra?: ExtraHighlight;
  /** Shows a grab cursor; purely cosmetic, the board decides what is actually pickable. */
  grabbable: boolean;
  /** Coordinate strip labels, already orientation-resolved by the board. */
  rankLabel?: string;
  fileLabel?: string;
  /** Appended to the accessible name; omitted when pieces are hidden. */
  pieceLabel?: string;
  onPointerDown: (square: SquareName, event: ReactPointerEvent<HTMLDivElement>) => void;
  children?: ReactNode;
}

function SquareImpl({
  square,
  shade,
  selected,
  marker,
  lastMove,
  check,
  extra,
  grabbable,
  rankLabel,
  fileLabel,
  pieceLabel,
  onPointerDown,
  children,
}: SquareProps) {
  return (
    <Cell
      role="gridcell"
      data-square={square}
      aria-label={pieceLabel === undefined ? square : `${square}, ${pieceLabel}`}
      $shade={shade}
      $grabbable={grabbable}
      onPointerDown={(event) => onPointerDown(square, event)}
    >
      {lastMove && <LastMoveTint />}
      {check && <CheckGlow />}
      {selected && <SelectedTint />}
      {extra !== undefined && <ExtraTint $kind={extra} />}
      {children}
      {marker === 'quiet' && <QuietDot data-marker="quiet" />}
      {marker === 'capture' && <CaptureRing data-marker="capture" />}
      {rankLabel !== undefined && <RankCoordinate $shade={shade}>{rankLabel}</RankCoordinate>}
      {fileLabel !== undefined && <FileCoordinate $shade={shade}>{fileLabel}</FileCoordinate>}
    </Cell>
  );
}

/**
 * Memoised: a drag re-renders the board on every pointermove, and only the dragged piece's
 * origin square and the floating ghost actually change.
 */
export const Square = memo(SquareImpl);
