import styled, { useTheme } from 'styled-components';
import { squareToCoords, type Orientation, type Square } from '../../chess/position';

export interface BoardArrow {
  from: Square;
  to: Square;
  /** 0..1 — how prominent the arrow is (opacity and width). Default 1. */
  weight?: number;
  /** Colour of a border drawn around the arrow; none when omitted. */
  outline?: string;
}

export interface ArrowsProps {
  arrows: readonly BoardArrow[];
  orientation: Orientation;
}

/** Centre of `square` in board units (one square = 1), as seen by `orientation`. */
function centre(square: Square, orientation: Orientation): { x: number; y: number } {
  const { file, rank } = squareToCoords(square);
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;
  return { x: col + 0.5, y: row + 0.5 };
}

/**
 * Arrow shape from `from` to `to`, as one closed polygon: a shaft starting a little off the origin
 * square's centre and a head whose tip stops short of the target's centre, so the piece standing
 * there stays readable.
 */
function arrowPoints(
  from: { x: number; y: number },
  to: { x: number; y: number },
  width: number,
): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  // Perpendicular unit vector.
  const px = -uy;
  const py = ux;

  const start = 0.2;
  const tip = length - 0.15;
  const headLength = Math.min(width * 2.4, tip - start);
  const neck = tip - headLength;
  const half = width / 2;
  const headHalf = width * 1.35;

  const at = (along: number, across: number) =>
    `${(from.x + ux * along + px * across).toFixed(3)},${(from.y + uy * along + py * across).toFixed(3)}`;

  return [
    at(start, -half),
    at(neck, -half),
    at(neck, -headHalf),
    at(tip, 0),
    at(neck, headHalf),
    at(neck, half),
    at(start, half),
  ].join(' ');
}

/** Presentation-only arrow layer laid over the board grid; never intercepts pointer input. */
export function Arrows({ arrows, orientation }: ArrowsProps) {
  const theme = useTheme();
  if (arrows.length === 0) return null;
  return (
    <Layer viewBox="0 0 8 8" aria-hidden="true" data-testid="board-arrows">
      {arrows.map((arrow) => {
        if (arrow.from === arrow.to) return null;
        const weight = Math.min(1, Math.max(0, arrow.weight ?? 1));
        return (
          <polygon
            key={`${arrow.from}${arrow.to}`}
            data-testid="board-arrow"
            data-from={arrow.from}
            data-to={arrow.to}
            points={arrowPoints(
              centre(arrow.from, orientation),
              centre(arrow.to, orientation),
              0.1 + 0.08 * weight,
            )}
            fill={theme.board.arrow}
            fillOpacity={0.45 + 0.4 * weight}
            stroke={arrow.outline}
            strokeWidth={arrow.outline === undefined ? undefined : 0.05}
            strokeLinejoin="round"
          />
        );
      })}
    </Layer>
  );
}

const Layer = styled.svg`
  position: absolute;
  inset: 0;
  z-index: 4;
  width: 100%;
  height: 100%;
  pointer-events: none;
`;
