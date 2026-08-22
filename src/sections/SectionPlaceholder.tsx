import type { ReactNode } from 'react';
import styled from 'styled-components';

const Wrap = styled.section`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space.sm};
  background: ${({ theme }) => theme.color.surface};
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.lg};
  padding: ${({ theme }) => theme.space.lg};
`;

const Title = styled.h1`
  font-size: ${({ theme }) => theme.font.size.xl};
`;

const Body = styled.p`
  color: ${({ theme }) => theme.color.textMuted};
  max-width: 60ch;
`;

export interface SectionPlaceholderProps {
  title: string;
  children: ReactNode;
}

/** Temporary shell content for a route that has not been implemented yet. */
export function SectionPlaceholder({ title, children }: SectionPlaceholderProps) {
  return (
    <Wrap>
      <Title>{title}</Title>
      <Body>{children}</Body>
    </Wrap>
  );
}
