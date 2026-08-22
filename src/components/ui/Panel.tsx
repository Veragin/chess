import type { ReactNode } from 'react';
import styled from 'styled-components';

const Surface = styled.section`
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: ${(p) => p.theme.color.surface};
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radius.lg};
  overflow: hidden;
`;

const Header = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${(p) => p.theme.space.sm};
  padding: ${(p) => p.theme.space.sm} ${(p) => p.theme.space.md};
  border-bottom: 1px solid ${(p) => p.theme.color.border};
  background: ${(p) => p.theme.color.surfaceAlt};
`;

const Title = styled.h2`
  margin: 0;
  font-size: ${(p) => p.theme.font.size.sm};
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: ${(p) => p.theme.color.textMuted};
`;

const Body = styled.div<{ $padded: boolean }>`
  min-width: 0;
  padding: ${(p) => (p.$padded ? p.theme.space.md : '0')};
`;

export interface PanelProps {
  title?: ReactNode;
  /** Rendered at the right of the header (buttons, toggles). */
  actions?: ReactNode;
  /** Set false when the body owns its own padding (e.g. a full-bleed list). */
  padded?: boolean;
  className?: string;
  children?: ReactNode;
}

export function Panel({ title, actions, padded = true, className, children }: PanelProps) {
  return (
    <Surface className={className}>
      {(title !== undefined || actions !== undefined) && (
        <Header>
          {title === undefined ? <span /> : <Title>{title}</Title>}
          {actions}
        </Header>
      )}
      <Body $padded={padded}>{children}</Body>
    </Surface>
  );
}
