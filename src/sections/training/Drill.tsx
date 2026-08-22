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
import { Link, useSearchParams } from 'react-router';
import styled from 'styled-components';
import { emptyCycle, pickNextLineId, type DrillCycle } from '../../chess/drill';
import { folderLabel } from '../../storage/folders';
import { storageWarning } from '../../storage/lines';
import { normaliseFolderPath } from '../../storage/schema';
import { DrillRun } from './drill/DrillRun';
import { drillablePool } from './drill/pool';
import { linesPath } from './lines/folderNav';

interface Served {
  /** The folder this cycle was drawn for; a change of scope starts the cycle over. */
  folder: string;
  /** Id of the line being drilled, or `null` when there is nothing to serve. */
  id: string | null;
  cycle: DrillCycle;
  /**
   * Increments on every draw. Part of the child's `key`, so serving the same line twice in a
   * row (a one-line store, or a cycle boundary) still starts a genuinely fresh run.
   */
  run: number;
}

function firstServe(pool: string[], folder: string): Served {
  const pick = pickNextLineId(pool, emptyCycle());
  return { folder, id: pick.id, cycle: pick.cycle, run: 0 };
}

export function Drill() {
  // `?folder=` scopes the pool to one folder and its subfolders. It lives in the URL rather than
  // in state so the scoped drill is a real, shareable, back-button-able location — and so
  // "Exit drill" can return to the folder the user started from.
  const [params] = useSearchParams();
  const folder = normaliseFolderPath(params.get('folder'));
  const exitTo = linesPath(folder);

  // Read once per mount: drill never writes, so there is nothing to invalidate, and re-reading
  // storage mid-cycle would let a rename or edit change the pool under the current cycle.
  const pool = useMemo(() => drillablePool(folder), [folder]);

  const [served, setServed] = useState<Served>(() => firstServe(pool, folder));

  // Switching folders navigates in place, so the component instance survives it. Re-seed during
  // render rather than in an effect, or the first frame would serve a line from the old scope.
  if (served.folder !== folder) {
    setServed(firstServe(pool, folder));
  }

  const next = useCallback(() => {
    setServed((previous) => {
      const pick = pickNextLineId(pool, previous.cycle);
      return { folder, id: pick.id, cycle: pick.cycle, run: previous.run + 1 };
    });
  }, [folder, pool]);

  if (served.id === null) {
    const warning = storageWarning();
    const scoped = folder.length > 0;
    return (
      <Empty data-testid="drill-empty">
        <Title>Drill</Title>
        {scoped ? (
          <p>
            There is nothing to drill in <strong>{folderLabel(folder)}</strong> — this folder and
            its subfolders hold no saved lines. Drill serves the lines of one folder in random
            order.
          </p>
        ) : (
          <p>
            There are no lines to drill yet. Save a repertoire line in line management, then come
            back — drill serves your saved lines in random order.
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

  // Keyed so each served line mounts a fresh run rather than mutating the previous one.
  return (
    <DrillRun
      key={`${folder}:${served.id}:${served.run}`}
      lineId={served.id}
      folder={folder}
      exitTo={exitTo}
      onNext={next}
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

const Muted = styled.p`
  font-size: ${(p) => p.theme.font.size.sm};
`;
