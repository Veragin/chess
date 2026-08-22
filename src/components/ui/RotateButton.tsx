import type { Orientation } from '../../chess/position';
import { IconButton } from './IconButton';

export interface RotateButtonProps {
  /** Current orientation — used only for the accessible label. */
  orientation?: Orientation;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Flips board orientation. Lives in `ui/` rather than in `Board/` on purpose: orientation is
 * presentation-only state owned by the *section* (README §8.12), so the section holds the
 * `Orientation` and passes it to both `<Board orientation>` and this button.
 */
export function RotateButton({ orientation, onClick, disabled, className }: RotateButtonProps) {
  const label =
    orientation === undefined
      ? 'Flip board'
      : `Flip board (currently ${orientation === 'white' ? 'White' : 'Black'} at the bottom)`;
  return (
    <IconButton label={label} onClick={onClick} disabled={disabled} className={className}>
      <span aria-hidden="true">⇅</span>
    </IconButton>
  );
}
