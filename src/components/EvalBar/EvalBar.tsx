/**
 * The evaluation strip. Purely presentational: it is handed an already White-normalised score
 * (README §6 — nothing outside `uci.ts` ever flips a sign) and turns it into a filled bar.
 *
 * Layout follows README §6: a thin horizontal strip above the board on narrow screens, a
 * vertical strip beside the board on wide ones. `orientation` decides which end is White's, so
 * the bar always grows towards the side of the board that player is sitting at.
 */

import styled, { css } from 'styled-components';
import type { Orientation } from '../../chess/position';
import { formatScore, winProbability } from '../../engine/uci';

export interface EvalBarProps {
  cp: number | null;
  mate: number | null;
  orientation?: Orientation;
  layout: 'vertical' | 'horizontal';
}

type Layout = EvalBarProps['layout'];

const VERTICAL_THICKNESS = '28px';
const HORIZONTAL_THICKNESS = '20px';

const Track = styled.div<{ $layout: Layout }>`
  position: relative;
  overflow: hidden;
  border-radius: ${({ theme }) => theme.radius.sm};
  border: 1px solid ${({ theme }) => theme.color.border};
  /* The unfilled remainder is Black's share. */
  background: #22262b;
  ${({ $layout }) =>
    $layout === 'vertical'
      ? css`
          width: ${VERTICAL_THICKNESS};
          min-width: ${VERTICAL_THICKNESS};
          height: 100%;
          min-height: 120px;
        `
      : css`
          width: 100%;
          height: ${HORIZONTAL_THICKNESS};
          min-height: ${HORIZONTAL_THICKNESS};
        `}
`;

/**
 * Absolutely positioned rather than a flex child on purpose: a percentage `flex-basis` in a
 * column flex container silently resolves to zero whenever the track's height comes from
 * `min-height` instead of a definite parent height, which is exactly the case for the
 * vertical strip beside the board.
 */
const WhiteShare = styled.div<{ $layout: Layout; $orientation: Orientation; $share: number }>`
  position: absolute;
  background: #eef1f5;
  transition:
    height 140ms ease-out,
    width 140ms ease-out;
  ${({ $layout, $orientation, $share }) => {
    const size = `${($share * 100).toFixed(2)}%`;
    return $layout === 'vertical'
      ? css`
          left: 0;
          right: 0;
          height: ${size};
          /* White's share grows from the bottom when the board is seen from White's side. */
          ${$orientation === 'white' ? 'bottom: 0;' : 'top: 0;'}
        `
      : css`
          top: 0;
          bottom: 0;
          width: ${size};
          ${$orientation === 'white' ? 'left: 0;' : 'right: 0;'}
        `;
  }}
`;

const Label = styled.span<{ $layout: Layout; $orientation: Orientation; $whiteAhead: boolean }>`
  position: absolute;
  font-family: ${({ theme }) => theme.font.mono};
  font-size: 9px;
  line-height: 1;
  letter-spacing: -0.04em;
  white-space: nowrap;
  pointer-events: none;
  /* Sits on White's end of the bar, so it needs the dark ink when White is ahead. */
  color: ${({ $whiteAhead, theme }) => ($whiteAhead ? '#1a1d21' : theme.color.textMuted)};
  ${({ $layout, $orientation }) =>
    $layout === 'vertical'
      ? css`
          left: 0;
          right: 0;
          text-align: center;
          ${$orientation === 'white' ? 'bottom: 3px;' : 'top: 3px;'}
        `
      : css`
          top: 50%;
          transform: translateY(-50%);
          ${$orientation === 'white' ? 'left: 4px;' : 'right: 4px;'}
        `}
`;

export function EvalBar({ cp, mate, orientation = 'white', layout }: EvalBarProps) {
  const share = winProbability(cp, mate);
  const label = formatScore(cp, mate);
  const whiteAhead = share >= 0.5;
  const percent = Math.round(share * 100);

  return (
    <Track
      $layout={layout}
      role="img"
      aria-label={`Evaluation ${label}; White win probability ${percent}%`}
      title={`Evaluation ${label}`}
      data-testid="eval-bar"
    >
      <WhiteShare $layout={layout} $orientation={orientation} $share={share} />
      <Label $layout={layout} $orientation={orientation} $whiteAhead={whiteAhead}>
        {label}
      </Label>
    </Track>
  );
}
