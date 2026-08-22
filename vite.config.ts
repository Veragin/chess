import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// `base` is configurable so the app can be deployed under a static-host subpath
// (e.g. GitHub Pages project sites). Default is the site root.
const base = process.env.VITE_BASE ?? '/';

/**
 * The vendored Stockfish pair. Named, never hashed (README §8.2), and — unusually for a
 * precache entry — deliberately *not* cache-busted: see `dontCacheBustURLsMatching` below.
 */
const ENGINE_ASSETS = /^engine\/stockfish-18-lite-single\.(js|wasm)$/;

/** 7.0 MiB wasm; Workbox's default cap is 2 MiB and silently drops anything above it. */
const MAX_PRECACHE_BYTES = 8 * 1024 * 1024;

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      // The app shell must never be a mix of an old index.html and new hashed assets, so the
      // new worker takes over as soon as it has finished precaching and the page reloads
      // itself once (see src/pwa/registerPwa.ts).
      registerType: 'autoUpdate',
      // Registration is wired by hand from src/pwa/registerPwa.ts (deferred to `window.load`)
      // rather than injected into index.html, so precaching can never delay first paint.
      injectRegister: null,
      // `globPatterns` below already sweeps every png/svg in `dist`, icons included, so the
      // plugin does not need to add manifest icons a second time.
      includeManifestIcons: false,
      manifest: {
        id: base,
        name: 'Chess Trainer',
        short_name: 'Chess',
        description:
          'Analyse positions with Stockfish, drill an opening repertoire, and play blind chess by voice. Works offline.',
        // Absolute and base-aware: under `VITE_BASE=/chess/` these become `/chess/`, which is
        // what makes the installed app open the right page and keeps navigation in scope.
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#14181d', // theme.color.bg
        background_color: '#14181d',
        lang: 'en',
        dir: 'ltr',
        categories: ['games', 'education'],
        icons: [
          { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: `${base}icons/icon-maskable-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          { src: `${base}icons/icon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // wasm is NOT in Workbox's default extension list, and svg/png are needed for the
        // pieces and the icons. `md` and the extensionless LICENSE files stay out.
        globPatterns: ['**/*.{html,css,js,wasm,svg,png,ico}'],
        maximumFileSizeToCacheInBytes: MAX_PRECACHE_BYTES,
        // Content-immutable, name-versioned files: precache them under their plain URL rather
        // than a `?__WB_REVISION__=` cache key, so the precache fetch and the engine worker's
        // own fetch of the same wasm are the *same* URL and can share the HTTP cache. Measured
        // caveat: on a **cold first visit** the two requests race (the engine worker is created
        // before the service worker activates, so it is not yet controlled) and the 7 MB wasm
        // really is fetched twice, 14.6 MB total. That is the price of "offline after one load"
        // — a runtime CacheFirst route would download it once but only populate the cache on
        // the *second* visit, which fails the Phase 9 gate. Measured: 2 GETs on visit 1, 0 on
        // every visit after that.
        dontCacheBustURLsMatching: ENGINE_ASSETS,
        // HashRouter: every route is `index.html#/...`, so one navigation fallback covers all.
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
      devOptions: {
        // Keep `yarn dev` a plain, service-worker-free page — a stale SW during development is
        // pure confusion, and the production build is what Phase 9 verifies.
        enabled: false,
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5174,
  },
  preview: {
    host: '0.0.0.0',
    port: 3002,
  },
  test: {
    // All tests are pure logic (no DOM) — see README §1 "Testing".
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
