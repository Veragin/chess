import styled from 'styled-components';
import type { AppTheme } from '../../theme';

type SpaceKey = keyof AppTheme['space'];

interface FlexProps {
  $gap?: SpaceKey;
  $align?: string;
  $justify?: string;
  $wrap?: boolean;
  $grow?: boolean;
}

/** Horizontal flex row. Usage: `<Row $gap="sm" $align="center">`. */
export const Row = styled.div<FlexProps>`
  display: flex;
  flex-direction: row;
  min-width: 0;
  gap: ${(p) => (p.$gap === undefined ? '0' : p.theme.space[p.$gap])};
  align-items: ${(p) => p.$align ?? 'center'};
  justify-content: ${(p) => p.$justify ?? 'flex-start'};
  flex-wrap: ${(p) => (p.$wrap === true ? 'wrap' : 'nowrap')};
  ${(p) => (p.$grow === true ? 'flex: 1 1 auto;' : '')}
`;

/** Vertical flex stack. Usage: `<Stack $gap="md">`. */
export const Stack = styled.div<FlexProps>`
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: ${(p) => (p.$gap === undefined ? '0' : p.theme.space[p.$gap])};
  align-items: ${(p) => p.$align ?? 'stretch'};
  justify-content: ${(p) => p.$justify ?? 'flex-start'};
  ${(p) => (p.$grow === true ? 'flex: 1 1 auto;' : '')}
`;

/** Pushes whatever follows it to the far end of a Row. */
export const Spacer = styled.div`
  flex: 1 1 auto;
  min-width: 0;
`;
