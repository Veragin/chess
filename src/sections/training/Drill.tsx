/**
 * `#/training/drill` — Phase 7. Owns the *cycle*: which branch of which line to serve next.
 *
 * One drill is one pass over every **branch** of every line in its pool: a line is picked at
 * random, then its unserved branches are served one after another (in random order), and only
 * then does the drill move on to another random line. No branch comes up twice in the same
 * drill. When the pool runs out the drill is over — the screen says so and offers to start
 * again, rather than silently reshuffling into another lap. The algorithm itself is
 * `chess/drill.ts`'s `pickNextBranch`; this component just holds the cycle and the currently
 * served branch. Deliberately **not** spaced repetition (README §1 non-goals) and nothing about
 * a run is persisted.
 *
 * Two pools, one screen:
 *
 *  - `?folder=` scopes it to a folder and its subfolders (the whole repertoire when absent);
 *  - `?line=` drills exactly that one line — the list's per-row Drill button. A pool of one, so
 *    it is over once every branch of that line has come up, which is what the button promises.
 *
 * `?set=` names the section the drill was opened from (`lines/folderNav.ts`). A folder drill
 * draws from that section's lines — Personal is only the picked lines, Database every saved
 * line — and the set is part of the scope, so switching section re-seeds the cycle. A `?line=`
 * drill ignores it (a single line is a single line); there `set` only sends "Exit drill" back to
 * the right section. `?side=w|b` (the list's "White only" / "Black only") narrows a folder drill
 * to the lines trained as that colour, and is part of the scope the same way.
 *
 * The pool is ids only (see `drill/pool.ts`) so no line name or move ever reaches this
 * component's state, and the run itself lives outside React (see `drill/useDrillRun.ts`).
 */

import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import styled from 'styled-components';
import {
  emptyCycle,
  markServed,
  parseDrillItemKey,
  pickNextBranch,
  remainingBranches,
  servedBranchesOf,
  type DrillCycle,
  type DrillItem,
  type DrillPoolEntry,
} from '../../chess/drill';
import { Button } from '../../components/ui';
import { folderLabel } from '../../storage/folders';
import { storageWarning } from '../../storage/lines';
import { normaliseFolderPath } from '../../storage/schema';
import { DrillRun } from './drill/DrillRun';
import { drillableBranchPool, drillPoolEntry } from './drill/pool';
import type { TrainedFor } from '../explore/coverage';
import {
  drillPath,
  linesPath,
  parseLineSet,
  parseTrainedFor,
  type LineSet,
} from './lines/folderNav';
import { colorLabel, lineCountLabel } from './lines/lineFormat';

interface Served {
  /** The pool this cycle was drawn from; a change of scope starts the cycle over. */
  scope: string;
  /**
   * Branch being drilled, or `null` once the pool has run out. `branch` follows a mid-run switch
   * onto another repertoire move (D6), so a restart replays what was actually played.
   */
  item: DrillItem | null;
  cycle: DrillCycle;
  /**
   * Increments on every draw. Part of the child's `key`, so drilling the same line again after
   * a restart still starts a genuinely fresh run.
   */
  run: number;
}

/** Identifies the pool, so navigating from one drill to another re-seeds the cycle. */
function scopeKey(folder: string, lineId: string, set: LineSet, side: TrainedFor): string {
  return `${set}/${side}:${lineId}@${folder}`;
}

function firstServe(pool: DrillPoolEntry[], scope: string, run = 0): Served {
  const pick = pickNextBranch(pool, emptyCycle());
  return { scope, item: pick.item, cycle: pick.cycle, run };
}

function branchCountLabel(count: number): string {
  return count === 1 ? '1 branch' : `${count} branches`;
}

export function Drill() {
  // The scope lives in the URL rather than in state so a scoped drill is a real, shareable,
  // back-button-able location — and so "Exit drill" can return where the user started from.
  const [params] = useSearchParams();
  const folder = normaliseFolderPath(params.get('folder'));
  const lineId = params.get('line') ?? '';
  const single = lineId.length > 0;
  const set = parseLineSet(params);
  const side = parseTrainedFor(params);
  const exitTo = linesPath(folder, set);
  const scope = scopeKey(folder, lineId, set, side);

  // Read once per mount: drill never writes, so there is nothing to invalidate, and re-reading
  // storage mid-cycle would let a rename or edit change the pool under the current cycle.
  // A `?line=` pool is not filtered here — if that one line is gone or broken, the runner says
  // so, which is more use than an empty-pool screen that cannot explain itself.
  const pool = useMemo(
    () => (single ? [drillPoolEntry(lineId)] : drillableBranchPool(folder, set, side)),
    [folder, lineId, single, set, side],
  );

  const [served, setServed] = useState<Served>(() => firstServe(pool, scope));

  // Switching scope navigates in place, so the component instance survives it. Re-seed during
  // render rather than in an effect, or the first frame would serve a line from the old scope.
  if (served.scope !== scope) {
    setServed(firstServe(pool, scope));
  }

  const next = useCallback(() => {
    setServed((previous) => {
      const pick = pickNextBranch(pool, previous.cycle, previous.item?.lineId);
      return { scope, item: pick.item, cycle: pick.cycle, run: previous.run + 1 };
    });
  }, [pool, scope]);

  /**
   * The run switched onto another branch (the user played another repertoire move). That branch
   * is spent too; the one originally served stays spent, so a user who always prefers the same
   * move cannot keep the drill open forever.
   */
  const branched = useCallback((branch: number) => {
    setServed((previous) => {
      if (previous.item === null || previous.item.branch === branch) return previous;
      const item = { lineId: previous.item.lineId, branch };
      return { ...previous, item, cycle: markServed(previous.cycle, item) };
    });
  }, []);

  // A restart is a brand-new cycle, not a reshuffle of the old one: every line is in play again.
  const restart = useCallback(() => {
    setServed((previous) => firstServe(pool, scope, previous.run + 1));
  }, [pool, scope]);

  /**
   * Play the served branch again from the start ("Restart" in the summary). Only `run` moves:
   * the cycle is untouched, so the branch stays spent and the drill still advances to a *new*
   * branch when the user presses Next — a replay is practice, not another draw.
   */
  const replay = useCallback(() => {
    setServed((previous) => ({ ...previous, run: previous.run + 1 }));
  }, []);

  if (served.item === null) {
    // Nothing was ever served: the pool itself is empty.
    if (served.cycle.served.length === 0) {
      const warning = storageWarning();
      const scoped = folder.length > 0;
      const personal = set === 'personal';
      return (
        <Empty data-testid="drill-empty">
          <Title>Drill</Title>
          {side !== 'both' ? (
            <p>
              There are no lines trained as {colorLabel(side)} to drill
              {scoped ? (
                <>
                  {' '}
                  in <strong>{folderLabel(folder)}</strong> or its subfolders
                </>
              ) : (
                ''
              )}
              {personal ? ' among your personal lines' : ''}.
            </p>
          ) : personal ? (
            <p>
              {scoped ? (
                <>
                  None of your personal lines are in <strong>{folderLabel(folder)}</strong> or its
                  subfolders.
                </>
              ) : (
                <>You haven&rsquo;t picked any lines to learn yet.</>
              )}{' '}
              Open the Database and add the lines you want to drill with ☆ — the Personal drill
              serves only those.
            </p>
          ) : scoped ? (
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
          {personal && (
            <Link to={linesPath('', 'database')} data-testid="drill-database-link">
              Pick lines in the Database ›
            </Link>
          )}
          {side !== 'both' && (
            <Link to={drillPath(folder, set)} data-testid="drill-both-sides-link">
              Drill both colours instead ›
            </Link>
          )}
          <Link to={exitTo} data-testid="drill-empty-link">
            Go to line management ›
          </Link>
          {scoped && (
            <Link to={drillPath('', set, side)} data-testid="drill-all-link">
              Drill every folder instead ›
            </Link>
          )}
        </Empty>
      );
    }

    // The pool ran out: every branch in scope has been drilled once.
    const doneBranches = served.cycle.served.length;
    const doneLines = new Set(
      served.cycle.served.map((key) => parseDrillItemKey(key)?.lineId ?? key),
    ).size;
    return (
      <Empty data-testid="drill-done">
        <Title>Drill complete</Title>
        {single ? (
          <p>
            That line is done{doneBranches > 1 ? ` — all ${branchCountLabel(doneBranches)}` : ''}.
            Every branch comes up once per drill, so this one is over.
          </p>
        ) : (
          <p>
            {lineCountLabel(doneLines)}
            {doneBranches > doneLines ? ` (${branchCountLabel(doneBranches)})` : ''} drilled
            {folder.length > 0 ? (
              <>
                {' '}
                in <strong>{folderLabel(folder)}</strong>
              </>
            ) : (
              ''
            )}{' '}
            — every branch of every line in scope came up once. Start again for a new random order.
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

  // What `next` will serve, so the runner can label its button honestly: nothing (last), another
  // branch of this line, or a new line.
  const remaining = remainingBranches(pool, served.cycle);
  const last = remaining.length === 0;
  const { lineId: servedLine, branch } = served.item;
  const moreInLine = remaining.some((item) => item.lineId === servedLine);

  // Keyed so each draw mounts a fresh run rather than mutating the previous one. The branch is
  // deliberately not in the key: a mid-run switch (`branched`) must not remount the run.
  return (
    <DrillRun
      key={`${scope}:${servedLine}:${served.run}`}
      lineId={servedLine}
      branch={branch}
      servedBranches={servedBranchesOf(served.cycle, servedLine)}
      onBranch={branched}
      moreInLine={moreInLine}
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
