import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styled from 'styled-components';

const StyledIconButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  padding: 0;
  background: ${(p) => p.theme.color.surfaceAlt};
  color: ${(p) => p.theme.color.text};
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radius.md};
  font-family: inherit;
  font-size: ${(p) => p.theme.font.size.md};
  line-height: 1;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;

  @media ${(p) => p.theme.media.wide} {
    min-width: 36px;
    min-height: 36px;
  }

  &:hover:not(:disabled) {
    border-color: ${(p) => p.theme.color.textFaint};
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.color.focus};
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Accessible name — icon buttons have no visible text. */
  label: string;
  children: ReactNode;
}

export function IconButton({ label, children, type = 'button', ...rest }: IconButtonProps) {
  return (
    <StyledIconButton type={type} aria-label={label} title={label} {...rest}>
      {children}
    </StyledIconButton>
  );
}
