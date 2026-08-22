/**
 * Interactive line play (README §7 Phase 6): walk one saved line, move by move.
 *
 * Guided practice, not free analysis — so there is no engine and no eval on this screen, the
 * board only accepts the trained colour (`movableFor`), and a legal move that is not the
 * line's move is refused with the position untouched.
 *
 * All state transitions come from `useLineSession` / `chess/line.ts`; this file is layout,
 * wording and the board wiring. "Switch sides" is a *view* of the same stored line: it flips
 * session state only and never writes to storage.
 */

import styled from 'styled-components';
import { Link } from 'react-router';
import { Board } from '../../../components/Board';
import { MoveList } from '../../../components/MoveList';
import { Button, Panel, RotateButton } from '../../../components/ui';
import { sessionExpectedSquares, type ResolvedLine } from '../../../chess/line';
import type { Square } from '../../../chess/position';
import type { Line } from '../../../storage/schema';
import { useLineSession } from './useLineSession';

export interface LineRunnerProps {
  /** The stored line, for its name and notes. Never written to from this screen. */
  line: Line;
  /** The same line, replayed and validated once by the caller. */
  resolved: ResolvedLine;
}

function colorName(color: 'w' | 'b'): string {
  return color === 'w' ? 'White' : 'Black';
}

export function LineRunner({ line, resolved }: LineRunnerProps) {
  const c = useLineSession(resolved);
  const { session } = c;
  const trainedAs = colorName(session.userColor);
  const opponent = colorName(session.userColor === 'w' ? 'b' : 'w');

  // Error flash and hint markers. The rejected move wins where they overlap: it is the more
  // urgent piece of feedback.
  const highlights: Partial<Record<Square, 'error' | 'hint' | 'success'>> = {};
  if (session.revealed !== null) {
    const squares = sessionExpectedSquares(session);
    if (squares !== null) {
      highlights[squares.from] = 'hint';
      highlights[squares.to] = 'hint';
    }
  }
  if (session.rejected !== null) {
    highlights[session.rejected.from] = 'error';
    highlights[session.rejected.to] = 'error';
  }

  const status = c.complete
    ? 'End of line'
    : c.autoPlaying
      ? `${opponent} is replying…`
      : `Your move — ${trainedAs} to play`;

  return (
    <Section data-testid="line-play">
      <TopBar>
        <BackLink to="/training">‹ Lines</BackLink>
        <Name data-testid="line-name">{line.name.trim().length > 0 ? line.name : 'Untitled line'}</Name>
        <Badge data-testid="line-side">Training as {trainedAs}</Badge>
      </TopBar>

      <StatusRow>
        <Progress data-testid="line-progress">{c.progress.label}</Progress>
        <Status data-testid="line-status" role="status">
          {status}
        </Status>
      </StatusRow>

      <BoardArea>
        <BoardCell>
          <Board
            fen={c.fen}
            orientation={c.orientation}
            onMove={c.attempt}
            movableFor={session.userColor}
            lastMove={c.lastMove}
            highlights={highlights}
          />
        </BoardCell>
      </BoardArea>

      {session.rejected !== null && (
        <Notice $tone="error" role="alert" data-testid="line-error">
          <strong>{session.rejected.san}</strong> is legal, but it is not this line. The position
          is unchanged — try again, or reveal the move.
        </Notice>
      )}

      {session.revealed !== null && session.rejected === null && (
        <Notice $tone="hint" role="status" data-testid="line-reveal">
          The line plays <strong>{session.revealed}</strong>.
        </Notice>
      )}

      {c.complete && (
        <Notice $tone="good" role="status" data-testid="line-complete">
          End of line — all {c.progress.total} {c.progress.total === 1 ? 'move' : 'moves'} played
          as {trainedAs}.
        </Notice>
      )}

      <Controls>
        <Button size="sm" data-testid="line-restart" onClick={c.restart}>
          Restart
        </Button>
        <Button size="sm" data-testid="line-back" onClick={c.stepBack} disabled={!c.canStepBack}>
          Step back
        </Button>
        <Button
          size="sm"
          data-testid="line-reveal-button"
          onClick={c.reveal}
          disabled={c.complete || session.revealed !== null}
        >
          Reveal next move
        </Button>
        <Button size="sm" data-testid="line-switch" variant="primary" onClick={c.flipSides}>
          Switch sides
        </Button>
        <RotateButton orientation={c.orientation} onClick={c.rotate} />
      </Controls>

      <Panel title="Moves so far" padded={false}>
        {c.playedSans.length === 0 ? (
          <Empty data-testid="line-moves-empty">Nothing played yet.</Empty>
        ) : (
          <MoveList
            moves={c.playedSans}
            cursor={c.playedSans.length - 1}
            onJump={(index) => c.jump(index + 1)}
            startColor={resolved.startColor}
            keyboardNavigation={false}
          />
        )}
      </Panel>

      {line.notes !== undefined && line.notes.trim().length > 0 && (
        <Panel title="Notes">
          <Notes data-testid="line-notes">{line.notes}</Notes>
        </Panel>
      )}
    </Section>
  );
}

/* ----------------------------------- styles ----------------------------------- */

/**
 * Single column, full width on a phone. Capped and centred on a wide screen: this screen has
 * no side panels, so a full-width column would strand the board in the middle of nothing.
 */
const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.md};
  width: 100%;
  max-width: 620px;
  margin: 0 auto;
  min-width: 0;
`;

const TopBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${(p) => p.theme.space.sm};
  min-width: 0;
`;

const BackLink = styled(Link)`
  flex: 0 0 auto;
  color: ${(p) => p.theme.color.textMuted};
  font-size: ${(p) => p.theme.font.size.sm};
  text-decoration: none;

  &:hover {
    color: ${(p) => p.theme.color.text};
  }
`;

const Name = styled.h1`
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font-size: ${(p) => p.theme.font.size.lg};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Badge = styled.span`
  flex: 0 0 auto;
  padding: 2px ${(p) => p.theme.space.sm};
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radius.sm};
  background: ${(p) => p.theme.color.surfaceAlt};
  color: ${(p) => p.theme.color.textMuted};
  font-size: ${(p) => p.theme.font.size.sm};
  white-space: nowrap;
`;

const StatusRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: ${(p) => p.theme.space.sm};
  min-width: 0;
`;

const Progress = styled.span`
  font-size: ${(p) => p.theme.font.size.md};
  font-weight: 600;
`;

const Status = styled.span`
  color: ${(p) => p.theme.color.textMuted};
  font-size: ${(p) => p.theme.font.size.sm};
`;

/** Board full width on a phone, capped so a wide window keeps it on screen. */
const BoardArea = styled.div`
  display: flex;
  justify-content: center;
  min-width: 0;
`;

const BoardCell = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  max-width: min(560px, calc(100dvh - 260px));
`;

const Notice = styled.p<{ $tone: 'error' | 'hint' | 'good' }>`
  margin: 0;
  padding: ${(p) => p.theme.space.sm} ${(p) => p.theme.space.md};
  border: 1px solid
    ${(p) =>
      p.$tone === 'error'
        ? p.theme.color.danger
        : p.$tone === 'good'
          ? p.theme.color.good
          : p.theme.color.border};
  border-radius: ${(p) => p.theme.radius.md};
  background: ${(p) => p.theme.color.surface};
  color: ${(p) => (p.$tone === 'error' ? p.theme.color.danger : p.theme.color.text)};
  font-size: ${(p) => p.theme.font.size.sm};
`;

const Controls = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${(p) => p.theme.space.sm};
  min-width: 0;
`;

const Empty = styled.p`
  margin: 0;
  padding: ${(p) => p.theme.space.md};
  color: ${(p) => p.theme.color.textMuted};
  font-size: ${(p) => p.theme.font.size.sm};
`;

const Notes = styled.p`
  margin: 0;
  color: ${(p) => p.theme.color.textMuted};
  font-size: ${(p) => p.theme.font.size.sm};
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;
