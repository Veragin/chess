import styled from 'styled-components';
import type { Color, PieceType } from '../../chess/game';

const PIECE_NAMES: Record<PieceType, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

/** Human name, e.g. 'white knight'. Used for alt text and aria labels. */
export function pieceName(color: Color, type: PieceType): string {
  return `${color === 'w' ? 'white' : 'black'} ${PIECE_NAMES[type]}`;
}

/**
 * Asset URL for a vendored cburnett SVG.
 *
 * Built from `import.meta.env.BASE_URL` (which always ends in '/') so the app keeps working
 * when deployed under a subpath — never a leading-slash absolute path (README §8.2).
 */
export function pieceAssetUrl(color: Color, type: PieceType): string {
  return `${import.meta.env.BASE_URL}pieces/${color}${type.toUpperCase()}.svg`;
}

const Img = styled.img<{ $faded: boolean }>`
  display: block;
  width: 100%;
  height: 100%;
  opacity: ${(p) => (p.$faded ? 0.28 : 1)};
  /* Pointer events must reach the square underneath — the board owns all interaction. */
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
`;

export interface PieceProps {
  color: Color;
  type: PieceType;
  /** Dimmed while this piece is being dragged away from its origin square. */
  faded?: boolean;
  className?: string;
}

export function Piece({ color, type, faded = false, className }: PieceProps) {
  return (
    <Img
      className={className}
      src={pieceAssetUrl(color, type)}
      alt={pieceName(color, type)}
      draggable={false}
      $faded={faded}
      data-piece={`${color}${type}`}
    />
  );
}
