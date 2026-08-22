import styled from 'styled-components';

export type NoticeTone = 'ok' | 'warn' | 'error' | 'info';

/**
 * Tone-coloured message box, shared by the list (storage warning, import report) and the editor
 * (validation errors, rebase warnings) so every message in Phase 5 looks the same.
 */
export const Notice = styled.div<{ $tone: NoticeTone }>`
  min-width: 0;
  padding: ${(p) => p.theme.space.sm} ${(p) => p.theme.space.md};
  border: 1px solid
    ${(p) =>
      p.$tone === 'error'
        ? p.theme.color.danger
        : p.$tone === 'warn'
          ? p.theme.color.warn
          : p.$tone === 'ok'
            ? p.theme.color.good
            : p.theme.color.border};
  border-radius: ${(p) => p.theme.radius.md};
  background: ${(p) => p.theme.color.surface};
  color: ${(p) =>
    p.$tone === 'error'
      ? p.theme.color.danger
      : p.$tone === 'warn'
        ? p.theme.color.warn
        : p.$tone === 'ok'
          ? p.theme.color.good
          : p.theme.color.textMuted};
  font-size: ${(p) => p.theme.font.size.sm};
`;

export const NoticeTitle = styled.p`
  margin: 0;
  font-weight: 600;
`;

export const NoticeList = styled.ul`
  margin: ${(p) => p.theme.space.xs} 0 0;
  padding-left: 1.2em;
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: ${(p) => p.theme.color.textMuted};
  overflow-wrap: anywhere;
`;
