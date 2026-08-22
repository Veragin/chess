import type { ButtonHTMLAttributes } from 'react';
import styled, { css } from 'styled-components';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface StyleProps {
  $variant: ButtonVariant;
  $size: ButtonSize;
  $full: boolean;
}

/**
 * Touch targets are >= 44px on narrow screens (Apple/Material minimum) and are allowed to
 * shrink on pointer-precise wide layouts.
 */
const sizeCss = {
  sm: css`
    min-height: 44px;
    padding: 0 ${(p) => p.theme.space.sm};
    font-size: ${(p) => p.theme.font.size.sm};
    @media ${(p) => p.theme.media.wide} {
      min-height: 30px;
    }
  `,
  md: css`
    min-height: 44px;
    padding: 0 ${(p) => p.theme.space.md};
    font-size: ${(p) => p.theme.font.size.md};
    @media ${(p) => p.theme.media.wide} {
      min-height: 36px;
    }
  `,
  lg: css`
    min-height: 52px;
    padding: 0 ${(p) => p.theme.space.lg};
    font-size: ${(p) => p.theme.font.size.lg};
  `,
} as const;

const variantCss = {
  primary: css`
    background: ${(p) => p.theme.color.accent};
    color: ${(p) => p.theme.color.accentText};
    border-color: ${(p) => p.theme.color.accent};
    &:hover:not(:disabled) {
      filter: brightness(1.1);
    }
  `,
  secondary: css`
    background: ${(p) => p.theme.color.surfaceAlt};
    color: ${(p) => p.theme.color.text};
    border-color: ${(p) => p.theme.color.border};
    &:hover:not(:disabled) {
      border-color: ${(p) => p.theme.color.textFaint};
    }
  `,
  danger: css`
    background: transparent;
    color: ${(p) => p.theme.color.danger};
    border-color: ${(p) => p.theme.color.danger};
    &:hover:not(:disabled) {
      background: ${(p) => p.theme.color.danger};
      color: ${(p) => p.theme.color.accentText};
    }
  `,
} as const;

const StyledButton = styled.button<StyleProps>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${(p) => p.theme.space.sm};
  width: ${(p) => (p.$full ? '100%' : 'auto')};
  border: 1px solid transparent;
  border-radius: ${(p) => p.theme.radius.md};
  font-family: inherit;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition:
    background 120ms ease,
    border-color 120ms ease,
    filter 120ms ease;

  ${(p) => sizeCss[p.$size]}
  ${(p) => variantCss[p.$variant]}

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.color.focus};
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  type = 'button',
  ...rest
}: ButtonProps) {
  return <StyledButton $variant={variant} $size={size} $full={fullWidth} type={type} {...rest} />;
}
