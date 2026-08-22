/**
 * The bundled files themselves — the one module that knows `public/data/` exists.
 *
 * `import.meta.glob(..., { eager: true })` resolves the glob **at build time**, so the JSON
 * travels inside the app bundle: no fetch, no manifest to keep in step with the directory, and
 * nothing that could fail on a first visit or offline (README: "no network calls at runtime").
 * Vite also copies `public/data/` into `dist/` as usual, which is harmless — those copies are
 * never read by the app, they are just the sources shipping alongside it.
 *
 * Adding a repertoire is therefore: drop `whatever.json` (a Training export) into
 * `public/data/`, rebuild. The glob is why there is no list of file names anywhere.
 *
 * Kept apart from `seed.ts` so the seeding logic can be unit-tested against fixtures rather
 * than against whatever happens to be in `public/data/` today.
 */

import { seedFromFiles, type SeedFile, type SeedReport } from './seed';

const modules = import.meta.glob('../../public/data/*.json', {
  eager: true,
  import: 'default',
});

/** Every bundled file, in a stable (file-name) order so seeding is reproducible. */
export function bundledSeedFiles(): SeedFile[] {
  return Object.entries(modules)
    .map(([path, payload]) => ({ name: path.slice(path.lastIndexOf('/') + 1), payload }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Called once at startup, before the first render (`src/main.tsx`). */
export function seedBundledLines(): SeedReport {
  return seedFromFiles(bundledSeedFiles());
}
