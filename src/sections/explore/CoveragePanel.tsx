/**
 * "What does my repertoire do here?" — the explore screen's reason to exist.
 *
 * Presentation only: it is handed a `Coverage` (see `./coverage.ts`) and reports the move the
 * user picked. Every continuation is a button, so checking coverage is a walk down the tree
 * rather than a hunt through the lines list; each line name links to its editor, because the
 * usual next step after finding a gap is to go and fix the line that has it.
 */

import styled from 'styled-components';
import { Link } from 'react-router';
import { Panel } from '../../components/ui';
import { editLinePath } from '../training/lines/folderNav';
import { lineCountLabel } from '../training/lines/lineFormat';
import type { Coverage, LineReach } from './coverage';
import type { Line } from '../../storage/schema';

export interface CoveragePanelProps {
  coverage: Coverage;
  /** Lines in scope, for the "3 of 12" summary. */
  scopeSize: number;
  /** Folder the scope came from; only used to bring the user back to it from the editor. */
  folder: string;
  /** Play a continuation on the board. */
  onPlay: (san: string) => void;
  /** Lines in scope that could not be replayed in full, so partial coverage is never silent. */
  brokenCount: number;
}

function lineTitle(line: Line): string {
  return line.name.trim().length === 0 ? 'Untitled line' : line.name;
}

/** "after 6 of 14 moves" — where in its own move list this line sits right now. */
function reachLabel(reach: LineReach): string {
  return `${lineTitle(reach.line)} — after ${reach.ply} of ${reach.total} moves`;
}

export function CoveragePanel({
  coverage,
  scopeSize,
  folder,
  onPlay,
  brokenCount,
}: CoveragePanelProps) {
  const reaching = coverage.lines.length;
  const summary =
    scopeSize === 0
      ? 'No saved lines to compare against.'
      : reaching === 0
        ? 'No saved line reaches this position.'
        : `${reaching} of ${lineCountLabel(scopeSize)} ` +
          `${reaching === 1 ? 'reaches' : 'reach'} this position.`;

  return (
    <Panel title="Repertoire from here" padded={false}>
      <Body>
        <Summary data-testid="coverage-summary">{summary}</Summary>

        {coverage.moves.length > 0 && (
          <Moves data-testid="coverage-moves">
            {coverage.moves.map((move) => (
              <MoveRow key={move.san} data-testid="coverage-move" data-san={move.san}>
                <PlayMove
                  type="button"
                  onClick={() => onPlay(move.san)}
                  data-testid="coverage-play"
                  aria-label={`Play ${move.san}`}
                >
                  {move.san}
                </PlayMove>
                <MoveBody>
                  <Count data-testid="coverage-count">{lineCountLabel(move.lines.length)}</Count>
                  <Names>
                    {move.lines.map((line) => (
                      <NameLink
                        key={line.id}
                        to={editLinePath(line.id, folder)}
                        title={`Edit ${lineTitle(line)}`}
                        data-testid="coverage-line"
                      >
                        {lineTitle(line)}
                      </NameLink>
                    ))}
                  </Names>
                </MoveBody>
              </MoveRow>
            ))}
          </Moves>
        )}

        {/* A line that stops here is not a gap — it is a line that has said all it wants to. */}
        {coverage.endsHere.length > 0 && (
          <Group data-testid="coverage-ends">
            <GroupTitle>Ends here</GroupTitle>
            <Names>
              {coverage.endsHere.map((reach) => (
                <NameLink
                  key={reach.line.id}
                  to={editLinePath(reach.line.id, folder)}
                  title={`Edit ${lineTitle(reach.line)}`}
                >
                  {lineTitle(reach.line)}
                </NameLink>
              ))}
            </Names>
          </Group>
        )}

        {coverage.breaksHere.length > 0 && (
          <Group data-testid="coverage-breaks">
            <GroupTitle $tone="warn">Cannot continue</GroupTitle>
            <Names>
              {coverage.breaksHere.map((reach) => (
                <NameLink
                  key={reach.line.id}
                  to={editLinePath(reach.line.id, folder)}
                  title={reachLabel(reach)}
                >
                  {lineTitle(reach.line)}
                </NameLink>
              ))}
            </Names>
            <Hint>
              The next stored move of {coverage.breaksHere.length === 1 ? 'this line' : 'these lines'}{' '}
              cannot be played from this position. Open {coverage.breaksHere.length === 1 ? 'it' : 'them'}{' '}
              in the editor to repair the move list.
            </Hint>
          </Group>
        )}

        {reaching === 0 && scopeSize > 0 && (
          <Hint data-testid="coverage-empty">
            Nothing in this scope transposes here. Play the moves you want covered and save them
            as a new line.
          </Hint>
        )}

        {brokenCount > 0 && (
          <Hint data-testid="coverage-broken">
            {lineCountLabel(brokenCount)} in this scope {brokenCount === 1 ? 'does' : 'do'} not
            replay in full and {brokenCount === 1 ? 'is' : 'are'} only counted up to the move that
            fails.
          </Hint>
        )}
      </Body>
    </Panel>
  );
}

/* ----------------------------------- styles ----------------------------------- */

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.sm};
  padding: ${(p) => p.theme.space.sm};
  min-width: 0;
`;

const Summary = styled.p`
  margin: 0;
  color: ${(p) => p.theme.color.textMuted};
  font-size: ${(p) => p.theme.font.size.sm};
`;

const Moves = styled.ul`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.xs};
  margin: 0;
  padding: 0;
  list-style: none;
  min-width: 0;
  /* A wide opening with a big repertoire behind it can name dozens of lines; scroll the list
     itself rather than pushing the engine and the move history off the screen. */
  max-height: 45vh;
  overflow-y: auto;
  overscroll-behavior: contain;
`;

const MoveRow = styled.li`
  display: flex;
  align-items: flex-start;
  gap: ${(p) => p.theme.space.sm};
  min-width: 0;
`;

const PlayMove = styled.button`
  flex: 0 0 auto;
  min-width: 4.5rem;
  min-height: 36px;
  padding: 0 ${(p) => p.theme.space.sm};
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radius.md};
  background: ${(p) => p.theme.color.surfaceAlt};
  color: ${(p) => p.theme.color.text};
  font-family: ${(p) => p.theme.font.mono};
  font-size: ${(p) => p.theme.font.size.md};
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;

  &:hover {
    border-color: ${(p) => p.theme.color.accent};
  }
  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.color.focus};
    outline-offset: 2px;
  }
`;

const MoveBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding-top: 2px;
`;

const Count = styled.span`
  color: ${(p) => p.theme.color.textFaint};
  font-size: ${(p) => p.theme.font.size.sm};
`;

const Names = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${(p) => p.theme.space.xs};
  min-width: 0;
`;

const NameLink = styled(Link)`
  max-width: 100%;
  color: ${(p) => p.theme.color.accent};
  font-size: ${(p) => p.theme.font.size.sm};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.color.focus};
    outline-offset: 2px;
  }
`;

const Group = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.xs};
  padding-top: ${(p) => p.theme.space.xs};
  border-top: 1px solid ${(p) => p.theme.color.border};
  min-width: 0;
`;

const GroupTitle = styled.h3<{ $tone?: 'warn' }>`
  margin: 0;
  font-size: ${(p) => p.theme.font.size.sm};
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: ${(p) => (p.$tone === 'warn' ? p.theme.color.warn : p.theme.color.textMuted)};
`;

const Hint = styled.p`
  margin: 0;
  color: ${(p) => p.theme.color.textFaint};
  font-size: ${(p) => p.theme.font.size.sm};
`;
