/**
 * One drill run: board, one line of status, a hint button, and the end-of-line summary.
 *
 * Everything this screen does *not* render is the point (README §8.11 — "no eval, no engine, no
 * move list, no line name, and nothing in the DOM or React devtools tree that a curious user
 * would read"):
 *
 *  - no engine and no eval bar — `useEngine` is not imported anywhere under `drill/`;
 *  - no move list, no line name, no notes, no line id;
 *  - no total move count while playing. The count alone would narrow down which line this is,
 *    and once you know the line you know the answer. The total appears only in the summary,
 *    after the line is over.
 *
 * The only answer that may ever enter the DOM is the hint, and only after the user asks. The
 * wrong-move notice deliberately says nothing about what was expected — the state it reads
 * (`DrillView.wrong`) does not carry it (see `chess/drill.ts` `drillRejected`).
 *
 * The run itself is held outside React by `useDrillRun`; this component only ever sees a
 * `DrillView`.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import styled from 'styled-components';
import type { Color } from '../../../chess/game';
import type { Square } from '../../../chess/position';
import { Board } from '../../../components/Board';
import { Button } from '../../../components/ui';
import { drillSummaryLabel } from '../../../chess/drill';
import { folderName } from '../../../storage/folders';
import { useDrillRun } from './useDrillRun';

export interface DrillRunProps {
  /** Which line to serve. Opaque to the screen — never rendered. */
  lineId: string;
  /**
   * Folder the pool was scoped to, or `''` for the whole repertoire. Safe to render, unlike
   * anything else about the line: it is the scope the user just chose, so it tells them nothing
   * they did not already type. It does not narrow *which* line this is beyond their own choice.
   */
  folder?: string;
  /** Where the exit links go — back to the folder the drill was started from. */
  exitTo?: string;
  /**
   * True when this is the last line of the drill — every other line in the pool has been served.
   * Only changes the wording: `onNext` then lands on the end-of-drill screen. A count of what is
   * left is deliberately not passed; that would narrow down how big the pool is mid-run.
   */
  last?: boolean;
  /** Serve the next line from the cycle, or end the drill when this was the last one. */
  onNext: () => void;
}

function colorName(color: Color): string {
  return color === 'w' ? 'White' : 'Black';
}

/** How long the hint button stays armed before it disarms itself. */
const HINT_ARM_MS = 4000;

export function DrillRun({
  lineId,
  folder = '',
  exitTo = '/training',
  last = false,
  onNext,
}: DrillRunProps) {
  const { run, attempt, hint } = useDrillRun(lineId);

  /**
   * The hint is two taps. It has to be within thumb reach on a phone, which also makes it easy
   * to brush by accident, and an accidental reveal destroys the repetition — so the first tap
   * only arms it, and it disarms itself after a few seconds.
   *
   * Stored as the ply it was armed at rather than a boolean, so any change of position disarms
   * it by derivation instead of via a state-resetting effect.
   */
  const [armedAtPly, setArmedAtPly] = useState<number | null>(null);
  const ply = run.status === 'ready' ? run.view.ply : -1;
  const armed = armedAtPly === ply;

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmedAtPly(null), HINT_ARM_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  if (run.status !== 'ready') {
    return (
      <Wrap data-testid="drill-unavailable">
        <TopBar>
          <ExitLink to={exitTo}>‹ Exit drill</ExitLink>
        </TopBar>
        <Notice $tone="error" role="alert">
          {run.status === 'missing'
            ? 'That line was removed while you were drilling.'
            : 'That line can no longer be replayed. Open it in line management to fix its moves.'}
        </Notice>
        <Controls>
          <Button variant="primary" data-testid="drill-next" onClick={onNext}>
            {last ? 'Finish drill' : 'Next line'}
          </Button>
        </Controls>
      </Wrap>
    );
  }

  const { view } = run;
  const you = colorName(view.userColor);
  const opponent = colorName(view.userColor === 'w' ? 'b' : 'w');
  const complete = view.phase === 'complete';

  // The refused move wins where the two overlap: it is the more urgent feedback.
  const highlights: Partial<Record<Square, 'error' | 'hint' | 'success'>> = {};
  if (view.hint !== null) {
    highlights[view.hint.from] = 'hint';
    highlights[view.hint.to] = 'hint';
  }
  if (view.wrong !== null) {
    highlights[view.wrong.from] = 'error';
    highlights[view.wrong.to] = 'error';
  }

  const status = complete
    ? 'Line complete'
    : view.phase === 'auto-reply'
      ? `${opponent} replies…`
      : `Your move — ${you} to play`;

  return (
    <Wrap data-testid="drill-run">
      <TopBar>
        <ExitLink to={exitTo}>‹ Exit drill</ExitLink>
        <Badges>
          {folder.length > 0 && (
            /* Leaf name only: the full path is the tooltip, so a deep folder cannot push the
               "Playing White" badge off a narrow screen. */
            <FolderBadge data-testid="drill-folder" title={folder}>
              {folderName(folder)}
            </FolderBadge>
          )}
          <Badge data-testid="drill-side">Playing {you}</Badge>
        </Badges>
      </TopBar>

      <StatusRow>
        <Progress data-testid="drill-progress">
          {complete ? 'Done' : `Move ${view.moveNumber}`}
        </Progress>
        <Status data-testid="drill-status" role="status">
          {status}
        </Status>
      </StatusRow>

      <BoardArea>
        <BoardCell>
          <Board
            fen={view.fen}
            orientation={view.orientation}
            onMove={attempt}
            movableFor={view.userColor}
            lastMove={view.lastMove}
            highlights={highlights}
          />
        </BoardCell>
      </BoardArea>

      {view.wrong !== null && (
        <Notice $tone="error" role="alert" data-testid="drill-wrong">
          <strong>{view.wrong.san}</strong> is not the move here. The position is unchanged — try
          again.
        </Notice>
      )}

      {view.hint !== null && view.wrong === null && (
        <Notice $tone="hint" role="status" data-testid="drill-hint">
          The line plays <strong>{view.hint.san}</strong>. This counts as a miss.
        </Notice>
      )}

      {complete ? (
        <Summary data-testid="drill-summary" role="status">
          <SummaryHead>{view.summary.perfect ? 'Clean run' : 'Line complete'}</SummaryHead>
          <SummaryLine data-testid="drill-summary-score">
            {drillSummaryLabel(view.summary)}
          </SummaryLine>
          {view.summary.wrongAttempts > 0 && (
            <SummaryMuted data-testid="drill-summary-wrong">
              {view.summary.wrongAttempts} wrong{' '}
              {view.summary.wrongAttempts === 1 ? 'attempt' : 'attempts'}
            </SummaryMuted>
          )}
          <Controls>
            <Button size="lg" variant="primary" data-testid="drill-next" onClick={onNext}>
              {last ? 'Finish drill' : 'Next line'}
            </Button>
            <ExitButton to={exitTo} data-testid="drill-exit">
              Exit
            </ExitButton>
          </Controls>
        </Summary>
      ) : (
        <HintZone>
          <HintButton
            size="lg"
            variant={armed ? 'danger' : 'secondary'}
            data-testid="drill-hint-button"
            data-armed={armed ? 'yes' : 'no'}
            disabled={!view.canHint}
            onClick={() => {
              if (!armed) {
                setArmedAtPly(ply);
                return;
              }
              setArmedAtPly(null);
              hint();
            }}
          >
            {armed ? 'Tap again to show the move' : 'Hint'}
          </HintButton>
          <HintHelp>A hint counts as a miss.</HintHelp>
        </HintZone>
      )}
    </Wrap>
  );
}

/* ----------------------------------- styles ----------------------------------- */

/**
 * Single column, full width on a phone; capped and centred on a wide screen, since there are no
 * side panels to fill the space with (and nothing else is allowed on this screen anyway).
 */
const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.md};
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
  min-width: 0;
`;

const TopBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${(p) => p.theme.space.sm};
  min-width: 0;
`;

const ExitLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  flex: 0 0 auto;
  color: ${(p) => p.theme.color.textMuted};
  font-size: ${(p) => p.theme.font.size.sm};
  text-decoration: none;

  &:hover {
    color: ${(p) => p.theme.color.text};
  }
`;

const Badges = styled.div`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.space.xs};
  min-width: 0;
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

const FolderBadge = styled(Badge)`
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
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

const BoardArea = styled.div`
  display: flex;
  justify-content: center;
  min-width: 0;
`;

/**
 * Board full width on a phone, but capped against the viewport height so the hint button and
 * the summary stay above the fold on a short window — the two things the user reaches for.
 */
const BoardCell = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  max-width: min(520px, calc(100dvh - 360px));
`;

const Notice = styled.p<{ $tone: 'error' | 'hint' }>`
  margin: 0;
  padding: ${(p) => p.theme.space.sm} ${(p) => p.theme.space.md};
  border: 1px solid
    ${(p) => (p.$tone === 'error' ? p.theme.color.danger : p.theme.color.border)};
  border-radius: ${(p) => p.theme.radius.md};
  background: ${(p) => p.theme.color.surface};
  color: ${(p) => (p.$tone === 'error' ? p.theme.color.danger : p.theme.color.text)};
  font-size: ${(p) => p.theme.font.size.sm};
`;

/**
 * The hint sits on its own, separated from everything tappable, so it is within thumb reach
 * without being next to anything else — the second half of "easy to reach, hard to hit by
 * accident" (the first half is the two-tap arm above).
 */
const HintZone = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${(p) => p.theme.space.xs};
  margin-top: ${(p) => p.theme.space.sm};
  min-width: 0;
`;

const HintButton = styled(Button)`
  width: 100%;
  max-width: 320px;
`;

const HintHelp = styled.span`
  color: ${(p) => p.theme.color.textFaint};
  font-size: ${(p) => p.theme.font.size.sm};
`;

const Summary = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.sm};
  padding: ${(p) => p.theme.space.md};
  border: 1px solid ${(p) => p.theme.color.good};
  border-radius: ${(p) => p.theme.radius.md};
  background: ${(p) => p.theme.color.surface};
  min-width: 0;
`;

const SummaryHead = styled.strong`
  font-size: ${(p) => p.theme.font.size.lg};
`;

const SummaryLine = styled.span`
  font-size: ${(p) => p.theme.font.size.md};
`;

const SummaryMuted = styled.span`
  color: ${(p) => p.theme.color.textMuted};
  font-size: ${(p) => p.theme.font.size.sm};
`;

const Controls = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${(p) => p.theme.space.sm};
  min-width: 0;
`;

const ExitButton = styled(Link)`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 52px;
  padding: 0 ${(p) => p.theme.space.lg};
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radius.md};
  background: ${(p) => p.theme.color.surfaceAlt};
  color: ${(p) => p.theme.color.text};
  font-size: ${(p) => p.theme.font.size.md};
  font-weight: 600;
  text-decoration: none;

  &:hover {
    border-color: ${(p) => p.theme.color.textFaint};
  }
`;
