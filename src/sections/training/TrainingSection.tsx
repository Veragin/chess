import { Navigate, Route, Routes } from 'react-router';
import { LinesList } from './LinesList';
import { LineEditor } from './LineEditor';
import { Drill } from './Drill';

/**
 * Nested router for the training section. Route shape is fixed:
 *   #/training            → LinesList   (Phase 5)
 *   #/training/new        → LineEditor  (Phase 5)
 *   #/training/:id/edit   → LineEditor  (Phase 5)
 *   #/training/drill      → Drill       (Phase 7; `?folder=` or `?line=` scopes the pool)
 *
 * Practising a single line is that same drill screen with a one-line pool (`?line=`), so there
 * is no separate line-play route: any stale `#/training/:id/play` link falls through the splat
 * back to the list.
 */
export function TrainingSection() {
  return (
    <Routes>
      <Route index element={<LinesList />} />
      <Route path="new" element={<LineEditor />} />
      <Route path="drill" element={<Drill />} />
      <Route path=":id/edit" element={<LineEditor />} />
      <Route path="*" element={<Navigate to="/training" replace />} />
    </Routes>
  );
}
