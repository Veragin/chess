import { Navigate, Route, Routes } from 'react-router';
import { LinesList } from './LinesList';
import { LineEditor } from './LineEditor';
import { LinePlay } from './LinePlay';
import { Drill } from './Drill';

/**
 * Nested router for the training section. Route shape is fixed:
 *   #/training            → LinesList   (Phase 5)
 *   #/training/new        → LineEditor  (Phase 5)
 *   #/training/:id/edit   → LineEditor  (Phase 5)
 *   #/training/:id/play   → LinePlay    (Phase 6)
 *   #/training/drill      → Drill       (Phase 7)
 */
export function TrainingSection() {
  return (
    <Routes>
      <Route index element={<LinesList />} />
      <Route path="new" element={<LineEditor />} />
      <Route path="drill" element={<Drill />} />
      <Route path=":id/edit" element={<LineEditor />} />
      <Route path=":id/play" element={<LinePlay />} />
      <Route path="*" element={<Navigate to="/training" replace />} />
    </Routes>
  );
}
