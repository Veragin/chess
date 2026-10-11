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

import { seedFromFiles, type SeedAliases, type SeedFile, type SeedReport } from './seed';

const modules = import.meta.glob('../../public/data/*.json', {
  eager: true,
  import: 'default',
});

/**
 * Which old seed keys each rewritten line replaces (written by `scripts/migrate-data.ts`). A glob
 * rather than an import so a checkout without the file still builds; it lives outside
 * `public/data/` because everything in there is read as a lines file.
 */
const aliasModules = import.meta.glob('../../public/seed-aliases.json', {
  eager: true,
  import: 'default',
});

function bundledSeedAliases(): SeedAliases {
  const [aliases] = Object.values(aliasModules);
  return typeof aliases === 'object' && aliases !== null && !Array.isArray(aliases)
    ? (aliases as SeedAliases)
    : {};
}

/** Every bundled file, in a stable (file-name) order so seeding is reproducible. */
export function bundledSeedFiles(): SeedFile[] {
  return Object.entries(modules)
    .map(([path, payload]) => ({ name: path.slice(path.lastIndexOf('/') + 1), payload }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Called once at startup, before the first render (`src/main.tsx`). */
export function seedBundledLines(): SeedReport {
  return seedFromFiles(bundledSeedFiles(), bundledSeedAliases());
}
