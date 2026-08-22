/**
 * `#/training/drill` — Phase 7. Owns the *cycle*: which line to serve next.
 *
 * README §7 Phase 7: "Pick a line uniformly at random from the saved set, excluding lines
 * already served in the current cycle; when every line has been served, reshuffle." The
 * algorithm itself is `chess/drill.ts`'s `pickNextLineId`; this component just holds the cycle
 * and the currently served id. Deliberately **not** spaced repetition (README §1 non-goals) and
 * nothing about a run is persisted.
 *
 * The pool is ids only (see `drill/pool.ts`) so no line name or move ever reaches this
 * component's state, and the run itself lives outside React (see `drill/useDrillRun.ts`).
 */

import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router';
import styled from 'styled-components';
import { emptyCycle, pickNextLineId, type DrillCycle } from '../../chess/drill';
import { storageWarning } from '../../storage/lines';
import { DrillRun } from './drill/DrillRun';
import { drillablePool } from './drill/pool';

interface Served {
  /** Id of the line being drilled, or `null` when there is nothing to serve. */
  id: string | null;
  cycle: DrillCycle;
  /**
   * Increments on every draw. Part of the child's `key`, so serving the same line twice in a
   * row (a one-line store, or a cycle boundary) still starts a genuinely fresh run.
   */
  run: number;
}

export function Drill() {
  // Read once per mount: drill never writes, so there is nothing to invalidate, and re-reading
  // storage mid-cycle would let a rename or edit change the pool under the current cycle.
  const pool = useMemo(() => drillablePool(), []);

  const [served, setServed] = useState<Served>(() => {
    const pick = pickNextLineId(pool, emptyCycle());
    return { id: pick.id, cycle: pick.cycle, run: 0 };
  });

  const next = useCallback(() => {
    setServed((previous) => {
      const pick = pickNextLineId(pool, previous.cycle);
      return { id: pick.id, cycle: pick.cycle, run: previous.run + 1 };
    });
  }, [pool]);

  if (served.id === null) {
    const warning = storageWarning();
    return (
      <Empty data-testid="drill-empty">
        <Title>Drill</Title>
        <p>
          There are no lines to drill yet. Save a repertoire line in line management, then come
          back — drill serves your saved lines in random order.
        </p>
        {warning !== null && <Muted data-testid="drill-storage-warning">{warning}</Muted>}
        <Link to="/training" data-testid="drill-empty-link">
          Go to line management ›
        </Link>
      </Empty>
    );
  }

  // Keyed so each served line mounts a fresh run rather than mutating the previous one.
  return <DrillRun key={`${served.id}:${served.run}`} lineId={served.id} onNext={next} />;
}

const Empty = styled.section`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.md};
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
  padding: ${(p) => p.theme.space.lg};
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radius.lg};
  background: ${(p) => p.theme.color.surface};
  min-width: 0;

  p {
    margin: 0;
    color: ${(p) => p.theme.color.textMuted};
    max-width: 60ch;
  }

  a {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    min-height: 44px;
    color: ${(p) => p.theme.color.accent};
    text-decoration: none;
  }
`;

const Title = styled.h1`
  margin: 0;
  font-size: ${(p) => p.theme.font.size.xl};
`;

const Muted = styled.p`
  font-size: ${(p) => p.theme.font.size.sm};
`;
