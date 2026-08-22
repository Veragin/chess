/**
 * Piece palette for `PositionEditor`: pick a piece then tap squares, or drag a piece straight
 * onto the board. Pointer Events only, like the board itself (README §8.6) — the parent owns the
 * drag state, this component only reports events and shows which tool is armed.
 */

import type { PointerEvent as ReactPointerEvent } from 'react';
import styled from 'styled-components';
import type { EditorPiece } from '../../chess/editor';
import type { Color, PieceType } from '../../chess/game';
import { Piece, pieceName } from '../Board/Piece';

/** The armed editing tool: a piece to place, or the eraser. */
export type PaletteTool = { kind: 'piece'; piece: EditorPiece } | { kind: 'erase' };

export function sameTool(a: PaletteTool | null, b: PaletteTool | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'erase' || b.kind === 'erase') return true;
  return a.piece.color === b.piece.color && a.piece.type === b.piece.type;
}

const ORDER: readonly PieceType[] = ['k', 'q', 'r', 'b', 'n', 'p'];
const COLORS: readonly Color[] = ['w', 'b'];

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.xs};
  min-width: 0;
`;

const Rows = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.xs};
`;

const RowEl = styled.div`
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: ${(p) => p.theme.space.xs};
  min-width: 0;
`;

const Slot = styled.button<{ $active: boolean }>`
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 1;
  padding: 6%;
  border: 2px solid ${(p) => (p.$active ? p.theme.color.focus : p.theme.color.border)};
  border-radius: ${(p) => p.theme.radius.sm};
  background: ${(p) => (p.$active ? p.theme.board.selected : p.theme.color.surfaceAlt)};
  cursor: grab;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.color.focus};
    outline-offset: 2px;
  }
`;

const EraseButton = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${(p) => p.theme.space.sm};
  min-height: 40px;
  padding: 0 ${(p) => p.theme.space.md};
  border: 1px solid ${(p) => (p.$active ? p.theme.color.danger : p.theme.color.border)};
  border-radius: ${(p) => p.theme.radius.md};
  background: ${(p) => (p.$active ? p.theme.color.danger : p.theme.color.surfaceAlt)};
  color: ${(p) => (p.$active ? p.theme.color.accentText : p.theme.color.text)};
  font-family: inherit;
  font-size: ${(p) => p.theme.font.size.sm};
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
`;

const Hint = styled.p`
  margin: 0;
  color: ${(p) => p.theme.color.textFaint};
  font-size: ${(p) => p.theme.font.size.sm};
`;

export interface PiecePaletteProps {
  tool: PaletteTool | null;
  /** Passing the armed tool again disarms it (the parent decides; this just reports the click). */
  onSelect: (tool: PaletteTool | null) => void;
  /** Pointer-down on a piece slot: the parent may start a drag from here. */
  onPiecePointerDown: (piece: EditorPiece, event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}

export function PiecePalette({
  tool,
  onSelect,
  onPiecePointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: PiecePaletteProps) {
  const eraseActive = tool?.kind === 'erase';

  return (
    <Wrap>
      <Rows>
        {COLORS.map((color) => (
          <RowEl key={color} role="group" aria-label={color === 'w' ? 'White pieces' : 'Black pieces'}>
            {ORDER.map((type) => {
              const piece: EditorPiece = { color, type };
              const active = sameTool(tool, { kind: 'piece', piece });
              return (
                <Slot
                  key={`${color}${type}`}
                  type="button"
                  $active={active}
                  aria-pressed={active}
                  aria-label={pieceName(color, type)}
                  title={pieceName(color, type)}
                  data-palette={`${color}${type}`}
                  onPointerDown={(event) => onPiecePointerDown(piece, event)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerCancel}
                  onClick={() => onSelect(active ? null : { kind: 'piece', piece })}
                >
                  <Piece color={color} type={type} />
                </Slot>
              );
            })}
          </RowEl>
        ))}
      </Rows>
      <EraseButton
        type="button"
        $active={eraseActive}
        aria-pressed={eraseActive}
        data-palette="erase"
        onClick={() => onSelect(eraseActive ? null : { kind: 'erase' })}
      >
        <span aria-hidden="true">⌫</span> Erase
      </EraseButton>
      <Hint>
        {tool === null
          ? 'Pick a piece, then tap squares. Drag a piece off the board to remove it.'
          : eraseActive
            ? 'Tap a square to clear it.'
            : 'Tap squares to place. Tap the piece again to put it down.'}
      </Hint>
    </Wrap>
  );
}
