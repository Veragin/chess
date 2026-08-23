import { Link } from 'react-router';
import styled, { css } from 'styled-components';

/**
 * A router `Link` that looks like `ui/Button`.
 *
 * The list navigates with real anchors (`#/training/drill?line=…`, `#/training/drill`) rather than
 * `onClick` + `navigate`, so the targets are visible in the status bar, openable in a new tab,
 * and reachable by assistive tech as links. `ui/Button` is a plain `<button>` component and
 * cannot be re-tagged, hence this small sibling rather than a hack around it.
 */
export const LinkButton = styled(Link)<{ $variant?: 'primary' | 'secondary'; $size?: 'sm' | 'md' }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${(p) => p.theme.space.sm};
  border: 1px solid transparent;
  border-radius: ${(p) => p.theme.radius.md};
  font-family: inherit;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;

  ${(p) =>
    p.$size === 'sm'
      ? css`
          min-height: 44px;
          padding: 0 ${p.theme.space.sm};
          font-size: ${p.theme.font.size.sm};
          @media ${p.theme.media.wide} {
            min-height: 30px;
          }
        `
      : css`
          min-height: 44px;
          padding: 0 ${p.theme.space.md};
          font-size: ${p.theme.font.size.md};
          @media ${p.theme.media.wide} {
            min-height: 36px;
          }
        `}

  ${(p) =>
    p.$variant === 'primary'
      ? css`
          background: ${p.theme.color.accent};
          color: ${p.theme.color.accentText};
          border-color: ${p.theme.color.accent};
          &:hover {
            filter: brightness(1.1);
          }
        `
      : css`
          background: ${p.theme.color.surfaceAlt};
          color: ${p.theme.color.text};
          border-color: ${p.theme.color.border};
          &:hover {
            border-color: ${p.theme.color.textFaint};
          }
        `}

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.color.focus};
    outline-offset: 2px;
  }
`;
