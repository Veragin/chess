/**
 * `#/training/drill` — Phase 7. Owns the *cycle*: which line to serve next.
 *
 * One drill is one pass over its pool: a line is picked uniformly at random from those not yet
 * served and **never comes up twice in the same drill**. When the pool runs out the drill is
 * over — the screen says so and offers to start again, rather than silently reshuffling into
 * another lap. The algorithm itself is `chess/drill.ts`'s `pickNextLineId`; this component just
 * holds the cycle and the currently served id. Deliberately **not** spaced repetition (README §1
 * non-goals) and nothing about a run is persisted.
 *
 * Two pools, one screen:
 *
 *  - `?folder=` scopes it to a folder and its subfolders (the whole repertoire when absent);
 *  - `?line=` drills exactly that one line — the list's per-row Drill button. A pool of one, so
 *    it is over after that line, which is precisely what the button promises.
 *
 * The pool is ids only (see `drill/pool.ts`) so no line name or move ever reaches this
 * component's state, and the run itself lives outside React (see `drill/useDrillRun.ts`).
 */

import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import styled from 'styled-components';
import { emptyCycle, pickNextLineId, remainingInCycle, type DrillCycle } from '../../chess/drill';
import { Button } from '../../components/ui';
import { folderLabel } from '../../storage/folders';
import { storageWarning } from '../../storage/lines';
import { normaliseFolderPath } from '../../storage/schema';
import { DrillRun } from './drill/DrillRun';
import { drillablePool } from './drill/pool';
import { linesPath } from './lines/folderNav';
import { lineCountLabel } from './lines/lineFormat';

interface Served {
  /** The pool this cycle was drawn from; a change of scope starts the cycle over. */
  scope: string;
  /** Id of the line being drilled, or `null` once the pool has run out. */
  id: string | null;
  cycle: DrillCycle;
  /**
   * Increments on every draw. Part of the child's `key`, so drilling the same line again after
   * a restart still starts a genuinely fresh run.
   */
  run: number;
}

/** Identifies the pool, so navigating from one drill to another re-seeds the cycle. */
function scopeKey(folder: string, lineId: string): string {
  return `${lineId}@${folder}`;
}

function firstServe(pool: string[], scope: string, run = 0): Served {
  const pick = pickNextLineId(pool, emptyCycle());
  return { scope, id: pick.id, cycle: pick.cycle, run };
}

export function Drill() {
  // The scope lives in the URL rather than in state so a scoped drill is a real, shareable,
  // back-button-able location — and so "Exit drill" can return where the user started from.
  const [params] = useSearchParams();
  const folder = normaliseFolderPath(params.get('folder'));
  const lineId = params.get('line') ?? '';
  const single = lineId.length > 0;
  const exitTo = linesPath(folder);
  const scope = scopeKey(folder, lineId);

  // Read once per mount: drill never writes, so there is nothing to invalidate, and re-reading
  // storage mid-cycle would let a rename or edit change the pool under the current cycle.
  // A `?line=` pool is not filtered here — if that one line is gone or broken, the runner says
  // so, which is more use than an empty-pool screen that cannot explain itself.
  const pool = useMemo(() => (single ? [lineId] : drillablePool(folder)), [folder, lineId, single]);

  const [served, setServed] = useState<Served>(() => firstServe(pool, scope));

  // Switching scope navigates in place, so the component instance survives it. Re-seed during
  // render rather than in an effect, or the first frame would serve a line from the old scope.
  if (served.scope !== scope) {
    setServed(firstServe(pool, scope));
  }

  const next = useCallback(() => {
    setServed((previous) => {
      const pick = pickNextLineId(pool, previous.cycle);
      return { scope, id: pick.id, cycle: pick.cycle, run: previous.run + 1 };
    });
  }, [pool, scope]);

  // A restart is a brand-new cycle, not a reshuffle of the old one: every line is in play again.
  const restart = useCallback(() => {
    setServed((previous) => firstServe(pool, scope, previous.run + 1));
  }, [pool, scope]);

  /**
   * Play the served line again from the start ("Restart line" in the summary). Only `run` moves:
   * the cycle is untouched, so the line stays spent and the drill still advances to a *new* line
   * when the user presses Next — a replay is practice, not another draw.
   */
  const replay = useCallback(() => {
    setServed((previous) => ({ ...previous, run: previous.run + 1 }));
  }, []);

  if (served.id === null) {
    // Nothing was ever served: the pool itself is empty.
    if (served.cycle.served.length === 0) {
      const warning = storageWarning();
      const scoped = folder.length > 0;
      return (
        <Empty data-testid="drill-empty">
          <Title>Drill</Title>
          {scoped ? (
            <p>
              There is nothing to drill in <strong>{folderLabel(folder)}</strong> — this folder and
              its subfolders hold no saved lines. Drill serves the lines of one folder in random
              order, each line once.
            </p>
          ) : (
            <p>
              There are no lines to drill yet. Save a repertoire line in line management, then come
              back — drill serves your saved lines in random order, each line once.
            </p>
          )}
          {warning !== null && <Muted data-testid="drill-storage-warning">{warning}</Muted>}
          <Link to={exitTo} data-testid="drill-empty-link">
            Go to line management ›
          </Link>
          {scoped && (
            <Link to="/training/drill" data-testid="drill-all-link">
              Drill every folder instead ›
            </Link>
          )}
        </Empty>
      );
    }

    // The pool ran out: every line in scope has been drilled once.
    const done = served.cycle.served.length;
    return (
      <Empty data-testid="drill-done">
        <Title>Drill complete</Title>
        {single ? (
          <p>That line is done. Every line comes up once per drill, so this one is over.</p>
        ) : (
          <p>
            {lineCountLabel(done)} drilled
            {folder.length > 0 ? (
              <>
                {' '}
                in <strong>{folderLabel(folder)}</strong>
              </>
            ) : (
              ''
            )}{' '}
            — every line in scope came up once. Start again for a new random order.
          </p>
        )}
        <Controls>
          <Button variant="primary" size="lg" data-testid="drill-restart" onClick={restart}>
            {single ? 'Drill it again' : 'Drill again'}
          </Button>
        </Controls>
        <Link to={exitTo} data-testid="drill-done-link">
          Back to line management ›
        </Link>
      </Empty>
    );
  }

  // Whether `next` has anything left to serve, so the runner can label its button honestly.
  const last = remainingInCycle(pool, served.cycle).length === 0;

  // Keyed so each served line mounts a fresh run rather than mutating the previous one.
  return (
    <DrillRun
      key={`${scope}:${served.id}:${served.run}`}
      lineId={served.id}
      folder={folder}
      exitTo={exitTo}
      last={last}
      onNext={next}
      onReplay={replay}
    />
  );
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

const Controls = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${(p) => p.theme.space.sm};
  min-width: 0;
`;

const Muted = styled.p`
  font-size: ${(p) => p.theme.font.size.sm};
`;
