/**
 * `#/training/:id/play` — loads one saved line and hands it to the player (README §7 Phase 6).
 *
 * This file is only the lookup and the two failure states; the screen itself is
 * `play/LineRunner.tsx` and all the logic is in `chess/line.ts`.
 *
 * A missing id, a deleted line and a line whose moves do not replay all land in a readable
 * state with a way back to the list — never a crash. Storage validates moves on import, but a
 * hand-edited `localStorage` payload must not take the app down.
 */

import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import styled from 'styled-components';
import { resolveLine } from '../../chess/line';
import { Panel } from '../../components/ui';
import { getLine, storageWarning } from '../../storage/lines';
import { LineRunner } from './play/LineRunner';

export function LinePlay() {
  const { id } = useParams<{ id: string }>();

  // `getLine` reads (and migrates) storage, so it is memoised on the id rather than run per
  // render. Nothing on this screen ever writes, so there is nothing to invalidate.
  const line = useMemo(() => (typeof id === 'string' && id.length > 0 ? getLine(id) : null), [id]);
  const model = useMemo(() => (line === null ? null : resolveLine(line)), [line]);

  if (line === null || model === null) {
    const warning = storageWarning();
    return (
      <Panel title="Line play">
        <Body data-testid="line-not-found">
          <p>That line no longer exists. It may have been deleted, or the link may be stale.</p>
          {warning !== null && <Muted>{warning}</Muted>}
          <Link to="/training">‹ Back to lines</Link>
        </Body>
      </Panel>
    );
  }

  if (!model.ok) {
    return (
      <Panel title={line.name.trim().length > 0 ? line.name : 'Line play'}>
        <Body data-testid="line-broken">
          <p>This line cannot be played: {model.reason}</p>
          <Muted>Edit the line to fix its moves, then try again.</Muted>
          <Link to="/training">‹ Back to lines</Link>
        </Body>
      </Panel>
    );
  }

  // Keyed by id so navigating between lines starts a genuinely fresh run.
  return <LineRunner key={line.id} line={line} resolved={model} />;
}

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.sm};
  min-width: 0;

  p {
    margin: 0;
    max-width: 60ch;
  }

  a {
    color: ${(p) => p.theme.color.accent};
    font-size: ${(p) => p.theme.font.size.sm};
    text-decoration: none;
  }
`;

const Muted = styled.p`
  color: ${(p) => p.theme.color.textMuted};
  font-size: ${(p) => p.theme.font.size.sm};
`;
