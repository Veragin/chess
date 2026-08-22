/**
 * Top-3 principal variations. Scores arrive already White-normalised (README §6); the PV
 * arrives as UCI and is converted to SAN through `chess/game.ts`, which is the only module
 * allowed to know the rules.
 *
 * `state.fen` is the position the lines were produced for. When it does not match the `fen`
 * prop the lines belong to a position the user has already left, so they are not rendered —
 * that is the UI half of the stale-result rule (README §8.4).
 */

import { useMemo } from 'react';
import type { ReactNode } from 'react';
import styled, { keyframes } from 'styled-components';
import { pvToSan } from '../../chess/game';
import { formatScore } from '../../engine/uci';
import type { EngineState } from '../../engine/uci';

export interface EngineLinesProps {
  fen: string;
  state: EngineState;
}

const MAX_PV_PLIES = 14;

const Wrap = styled.section`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space.xs};
  background: ${({ theme }) => theme.color.surface};
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.md};
  padding: ${({ theme }) => theme.space.sm};
`;

const Header = styled.header`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: ${({ theme }) => theme.space.sm};
  color: ${({ theme }) => theme.color.textMuted};
  font-size: ${({ theme }) => theme.font.size.sm};
`;

const Title = styled.h3`
  margin: 0;
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.color.textMuted};
`;

const Meta = styled.span`
  font-family: ${({ theme }) => theme.font.mono};
  font-size: 11px;
  color: ${({ theme }) => theme.color.textFaint};
`;

const Row = styled.li`
  display: grid;
  grid-template-columns: 4.5rem 2.5rem 1fr;
  gap: ${({ theme }) => theme.space.sm};
  align-items: baseline;
  padding: 3px 0;
  border-top: 1px solid ${({ theme }) => theme.color.border};
  font-size: ${({ theme }) => theme.font.size.sm};
`;

const Rows = styled.ol`
  list-style: none;
  margin: 0;
  padding: 0;
`;

const Score = styled.span<{ $good: boolean }>`
  font-family: ${({ theme }) => theme.font.mono};
  font-weight: 600;
  color: ${({ $good, theme }) => ($good ? theme.color.text : theme.color.textMuted)};
`;

const Depth = styled.span`
  font-family: ${({ theme }) => theme.font.mono};
  font-size: 11px;
  color: ${({ theme }) => theme.color.textFaint};
`;

const Pv = styled.span`
  font-family: ${({ theme }) => theme.font.mono};
  color: ${({ theme }) => theme.color.text};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Notice = styled.p<{ $tone?: 'error' }>`
  margin: 0;
  padding: ${({ theme }) => theme.space.xs} 0;
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ $tone, theme }) => ($tone === 'error' ? theme.color.danger : theme.color.textMuted)};
`;

const pulse = keyframes`
  0%, 100% { opacity: 0.35; }
  50% { opacity: 0.75; }
`;

const Placeholder = styled.div`
  height: 1.15rem;
  border-radius: ${({ theme }) => theme.radius.sm};
  background: ${({ theme }) => theme.color.surfaceAlt};
  animation: ${pulse} 1.1s ease-in-out infinite;
`;

const PlaceholderStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space.xs};
`;

/** Numbers a SAN sequence starting from the move number / side to move encoded in `fen`. */
function numberPv(fen: string, sans: string[]): string {
  const fields = fen.trim().split(/\s+/);
  const blackToMove = fields[1] === 'b';
  const parsed = Number.parseInt(fields[5] ?? '1', 10);
  let moveNumber = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;

  const out: string[] = [];
  let blackTurn = blackToMove;
  sans.forEach((san, index) => {
    if (blackTurn) {
      if (index === 0) out.push(`${moveNumber}...`);
      out.push(san);
      moveNumber += 1;
    } else {
      out.push(`${moveNumber}.`);
      out.push(san);
    }
    blackTurn = !blackTurn;
  });
  return out.join(' ');
}

export function EngineLines({ fen, state }: EngineLinesProps) {
  const { status, error, nps } = state;
  const engineFen = state.fen;
  const engineLines = state.lines;

  const { rendered, topDepth } = useMemo(() => {
    // Only lines produced for the position on screen may be shown (README §8.4).
    const fresh = engineFen === fen ? engineLines : [];
    return {
      rendered: fresh.map((line) => ({
        key: line.multipv,
        score: formatScore(line.cp, line.mate),
        good: (line.mate ?? 0) > 0 || (line.cp ?? 0) >= 0,
        depth: line.depth,
        text: numberPv(fen, pvToSan(fen, line.pv).slice(0, MAX_PV_PLIES)),
      })),
      topDepth: fresh.reduce((max, line) => Math.max(max, line.depth), 0),
    };
  }, [engineFen, engineLines, fen]);

  const metaParts: string[] = [];
  if (topDepth > 0) metaParts.push(`depth ${topDepth}`);
  if (topDepth > 0 && status === 'ready') metaParts.push('done');
  if (nps !== undefined && topDepth > 0) metaParts.push(`${Math.round(nps / 1000)} kn/s`);
  const meta = metaParts.join(' · ');

  let body: ReactNode;
  if (status === 'error') {
    body = <Notice $tone="error">{error ?? 'The engine failed to start.'}</Notice>;
  } else if (status === 'loading') {
    body = (
      <>
        <Notice>Loading engine… the first load downloads about 7 MB.</Notice>
        <PlaceholderStack>
          <Placeholder />
          <Placeholder />
          <Placeholder />
        </PlaceholderStack>
      </>
    );
  } else if (status === 'idle') {
    body = <Notice>Engine idle.</Notice>;
  } else if (rendered.length === 0) {
    body = (
      <PlaceholderStack>
        <Placeholder />
        <Placeholder />
        <Placeholder />
      </PlaceholderStack>
    );
  } else {
    body = (
      <Rows>
        {rendered.map((line) => (
          <Row key={line.key}>
            <Score $good={line.good}>{line.score}</Score>
            <Depth>d{line.depth}</Depth>
            <Pv title={line.text}>{line.text}</Pv>
          </Row>
        ))}
      </Rows>
    );
  }

  return (
    <Wrap aria-busy={status === 'loading' || status === 'analyzing'} data-testid="engine-lines">
      <Header>
        <Title>Engine</Title>
        <Meta>{meta}</Meta>
      </Header>
      {body}
    </Wrap>
  );
}
