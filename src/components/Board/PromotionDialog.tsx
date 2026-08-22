import { useEffect, useRef } from 'react';
import styled from 'styled-components';
import type { Color, PromotionPiece } from '../../chess/game';
import { pieceAssetUrl, pieceName } from './Piece';

const PROMOTION_CHOICES: readonly PromotionPiece[] = ['q', 'r', 'b', 'n'];

const Backdrop = styled.div`
  position: absolute;
  inset: 0;
  z-index: ${(p) => p.theme.z.dialog};
  display: grid;
  place-items: center;
  background: rgba(10, 13, 16, 0.72);
  touch-action: none;
`;

const Sheet = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.sm};
  max-width: 92%;
  padding: ${(p) => p.theme.space.md};
  background: ${(p) => p.theme.color.surface};
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radius.lg};
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
`;

const Legend = styled.p`
  margin: 0;
  text-align: center;
  font-size: ${(p) => p.theme.font.size.sm};
  color: ${(p) => p.theme.color.textMuted};
`;

const Choices = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: ${(p) => p.theme.space.sm};
`;

const Choice = styled.button`
  display: grid;
  place-items: center;
  width: clamp(52px, 14vw, 68px);
  height: clamp(52px, 14vw, 68px);
  padding: 4px;
  background: ${(p) => p.theme.color.surfaceAlt};
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radius.md};
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;

  &:hover,
  &:focus-visible {
    border-color: ${(p) => p.theme.color.focus};
    background: ${(p) => p.theme.color.border};
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.color.focus};
    outline-offset: 1px;
  }

  img {
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
`;

const Cancel = styled.button`
  min-height: 44px;
  background: none;
  border: none;
  color: ${(p) => p.theme.color.textMuted};
  font-family: inherit;
  font-size: ${(p) => p.theme.font.size.sm};
  cursor: pointer;

  &:hover {
    color: ${(p) => p.theme.color.text};
  }
`;

export interface PromotionDialogProps {
  /** Colour of the promoting pawn. */
  color: Color;
  onSelect: (piece: PromotionPiece) => void;
  onCancel: () => void;
}

/**
 * Overlays the board. Nothing is applied to the position until a piece is picked — cancelling
 * (Escape, backdrop tap, or the Cancel button) must leave the game untouched.
 */
export function PromotionDialog({ color, onSelect, onCancel }: PromotionDialogProps) {
  const firstRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        onCancel();
        return;
      }
      const key = event.key.toLowerCase();
      if ((PROMOTION_CHOICES as readonly string[]).includes(key)) {
        event.preventDefault();
        onSelect(key as PromotionPiece);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel, onSelect]);

  return (
    <Backdrop
      data-testid="promotion-dialog"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <Sheet role="dialog" aria-modal="true" aria-label="Choose promotion piece">
        <Legend>Promote to</Legend>
        <Choices>
          {PROMOTION_CHOICES.map((piece, index) => (
            <Choice
              key={piece}
              ref={index === 0 ? firstRef : undefined}
              type="button"
              data-promotion={piece}
              aria-label={pieceName(color, piece)}
              title={pieceName(color, piece)}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onSelect(piece)}
            >
              <img src={pieceAssetUrl(color, piece)} alt="" draggable={false} />
            </Choice>
          ))}
        </Choices>
        <Cancel type="button" onClick={onCancel}>
          Cancel
        </Cancel>
      </Sheet>
    </Backdrop>
  );
}
