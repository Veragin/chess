import { Navigate, Route, Routes } from 'react-router';
import { ExploreSection } from '../explore/ExploreSection';
import { LinesList } from './LinesList';
import { LineEditor } from './LineEditor';
import { Drill } from './Drill';

/**
 * Nested router for the training section. Route shape is fixed:
 *   #/training            → LinesList      (Phase 5; Personal | Database switch)
 *   #/training/new        → LineEditor     (Phase 5)
 *   #/training/:id/edit   → LineEditor     (Phase 5)
 *   #/training/drill      → Drill          (Phase 7; `?folder=` or `?line=` scopes the pool)
 *   #/training/explore    → ExploreSection (`?folder=` scopes what counts as coverage)
 *
 * Every route also takes `?set=personal`: the **Personal** section (the lines the user picked to
 * learn, `storage/personal.ts`) instead of the default **Database** (every saved line). The list
 * switches between the two, and drill, explore and the editor carry `set` so their way back lands
 * in the section they came from (`lines/folderNav.ts`, `lines/lineSet.ts`). Without `?set=`, the
 * list reopens the section this tab was last in.
 *
 * Practising a single line is that same drill screen with a one-line pool (`?line=`), so there
 * is no separate line-play route: any stale `#/training/:id/play` link falls through the splat
 * back to the list.
 *
 * Explore lives here rather than in a tab of its own because it is a question *about the
 * repertoire* — "is this position covered?" — scoped by the same `?folder=` as drill and reached
 * from the Explore button beside Drill. Its code stays under `sections/explore/`: it is a screen
 * of its own size, only routed as part of training.
 */
export function TrainingSection() {
  return (
    <Routes>
      <Route index element={<LinesList />} />
      <Route path="new" element={<LineEditor />} />
      <Route path="drill" element={<Drill />} />
      <Route path="explore" element={<ExploreSection />} />
      <Route path=":id/edit" element={<LineEditor />} />
      <Route path="*" element={<Navigate to="/training" replace />} />
    </Routes>
  );
}
