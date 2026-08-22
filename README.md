# Chess

A browser-only chess trainer: analyse positions with Stockfish, drill a saved opening
repertoire, and play blind chess by voice on a phone. No backend, no accounts, no network calls
at runtime.

## Features

- **Analyze** — free exploration from the start position or a custom FEN, with a live eval bar
  and the engine's top three lines. The user moves both colours; there is no engine opponent.
- **Training** — a repertoire of linear lines (one start position, one ordered move list),
  organised in nested folders, stored in `localStorage` and exportable as a single `.json` file.
  Play a line move by move, or drill the whole repertoire (or one folder) from a board that
  shows nothing else.
- **Blind chess** — two players sharing one phone, board rendered empty, moves spoken in English
  algebraic ("e4", "knight f3", "bishop takes c6", "castles short"). Installable as a PWA and
  works offline after the first load.

## Stack

TypeScript (strict), React, Vite, `styled-components`, `react-router` (`HashRouter`),
`chess.js` for all rules, single-threaded Stockfish WASM over UCI in a Worker,
`vite-plugin-pwa`, Vitest for unit tests.

## Development

The repo provides a dev container (`docker-compose.yml`, `docker/Dockerfile.dev`, `Makefile`).
Node 22, yarn via corepack. Ports **5174** (dev) and **3002** (preview) are mapped.

```bash
make start          # build + start the dev container
make bash           # shell into it (working dir /app)
make ai             # launch the agent in the container

yarn dev            # vite dev server → host :5174
yarn build          # production build
yarn preview        # serve the build → host :3002
yarn test           # vitest
yarn typecheck      # tsc --noEmit
```

---

## Build

```bash
yarn build                       # → dist/, served from the site root ("/")
VITE_BASE=/chess/ yarn build     # → dist/, served from https://host/chess/
yarn preview                     # serve dist/ on :3002 (respects VITE_BASE)
VITE_BASE=/chess/ yarn preview   # → http://localhost:3002/chess/
```

`VITE_BASE` is read by `vite.config.ts` and flows into three places at once: Vite's asset URLs,
the PWA manifest (`start_url`, `scope`, `id`, icon paths) and the service-worker scope. The
engine worker URL is derived from `import.meta.env.BASE_URL` at runtime (`src/engine/engine.ts`),
so nothing is hard-coded to `/`. Always build with the *final* base — the value is baked in.

`VITE_BASE` must begin and end with `/` (`/chess/`, not `chess` or `/chess`).

## Deploy to a GitHub-Pages-class static host

Upload **the entire contents of `dist/`** (not the `dist` folder itself) to the directory the
site is served from. Nothing else is needed: no server, no rewrite rules, no HTTP headers.

```
dist/
├── index.html                  # the only HTML document; HashRouter does the rest
├── manifest.webmanifest        # PWA manifest (base-aware)
├── sw.js, workbox-*.js         # service worker + its runtime
├── favicon.ico, favicon.svg
├── assets/                     # content-hashed JS
├── icons/                      # PWA icons + favicon PNGs
├── pieces/                     # 12 cburnett SVGs (+ LICENSE)
└── engine/                     # stockfish-18-lite-single.js + .wasm (+ LICENSE)
```

- **A project site lives on a subpath.** `https://<user>.github.io/<repo>/` needs
  `VITE_BASE=/<repo>/ yarn build`. A user/organisation site (`<user>.github.io`) uses the
  default `/`.
- **`HashRouter` means no 404 rewrites.** Every route is `index.html#/…`, so the host only ever
  serves one HTML file. Deep links work without any server configuration.
- Add an empty **`.nojekyll`** file next to `index.html`. The current output has no
  underscore-prefixed paths, so it is not strictly required, but it stops GitHub Pages running
  Jekyll over the build.
- **HTTPS is required** for the service worker, the microphone and Wake Lock. GitHub Pages
  serves HTTPS; `localhost` is also treated as secure, which is why `yarn preview` works.
- **The host must serve `.wasm` as `application/wasm`.** GitHub Pages does; a hand-rolled host
  may not, and Stockfish will fail to instantiate if it does not.
- **First visit downloads ~7.5 MB**, almost all of it `stockfish-18-lite-single.wasm` (7.0 MB).
  After that the service worker serves it from Cache Storage.
- Do not rename or split the two files in `engine/`: the loader fetches its `.wasm` as a sibling
  of its own script URL.

## What the PWA does

- **Installable.** `display: standalone`, portrait, theme and background `#14181d` (matching
  `src/theme.ts`), icons at 192×192 and 512×512 plus a maskable 512×512 and a 180×180
  apple-touch-icon. Sources are `public/icons/icon.svg` and `public/icons/icon-maskable.svg`;
  the PNGs are rasterised from them (see `public/icons/LICENSE`).
- **Precached for offline use** (`vite-plugin-pwa` in `generateSW` mode): the app shell, all 12
  piece SVGs, the icons, the manifest, and **both Stockfish files including the 7 MB `.wasm`**.
  Workbox's default `maximumFileSizeToCacheInBytes` is 2 MB and would drop the wasm silently, so
  it is raised to 8 MB in `vite.config.ts`.
- **Precaching never blocks first paint.** Registration is deferred to the `window.load` event
  (`src/pwa/registerPwa.ts`), and the download then happens inside the service worker. The
  analyse screen is interactive immediately and shows the engine's own loading state until the
  wasm is ready.
- **Cost of that, stated plainly:** on a *cold first visit* the wasm is fetched twice — once by
  the engine worker (which is created before the service worker is controlling the page) and
  once by the precache — so the first visit costs ~14.6 MB rather than ~7.5 MB. Every later
  visit fetches it zero times. The alternative (runtime caching for that one file) downloads it
  once but only fills the cache on the *second* visit, which would break offline-after-one-load;
  correctness was chosen over first-visit bandwidth.
- **Updates apply automatically.** A new deploy's worker skips waiting, claims the page and the
  page reloads itself exactly once. This is deliberate: the shell is `index.html` plus
  content-hashed chunks, so a worker that kept serving an old `index.html` would ask for chunks
  that no longer exist. All app state lives in `localStorage`, so a reload loses nothing.
- **Offline scope.** After one successful load, with the network disabled: analyse (including
  live Stockfish evaluation), line management, line play, drill and blind chess all work, and a
  hard reload still boots the app. There is no network feature to lose — the app makes no runtime
  network calls of its own.
- **Not offline-capable:** the very first visit. The wasm has to be downloaded once.

## Browser support

| Capability | Chrome / Edge | Safari | Firefox |
|---|---|---|---|
| Board, analyse, lines, drill, blind board | Yes | Yes | Yes |
| Stockfish (single-threaded WASM) | Yes | Yes | Yes |
| Install as an app (PWA) | Yes | iOS/iPadOS 16.4+, macOS 14+ ("Add to Dock") | Android yes; desktop no install UI |
| Offline via service worker | Yes | Yes | Yes |
| **Voice move entry** (`SpeechRecognition`) | Yes | Yes (`webkitSpeechRecognition`) | **No — falls back to typed entry** |
| Spoken echo of the move (`SpeechSynthesis`) | Yes | Yes | Yes |
| Screen Wake Lock | Yes (desktop + Android) | iOS/iPadOS 16.4+ | Feature-detected; older versions have no `navigator.wakeLock` |

Notes:

- **Voice input requires Chrome or Safari.** Firefox implements no `SpeechRecognition` at all.
  The blind-chess screen feature-detects it (`src/speech/recognizer.ts`) and renders a typed
  move box instead, which goes through the *same* grammar module — so `"knight f3"`,
  `"bishop takes c6"` and `"castles short"` are understood either way. Chrome's implementation
  also sends audio to a Google speech service, so voice input specifically needs a network
  connection even though the rest of the app does not.
- **Recognition needs a user gesture** and only works while the page is in the foreground. True
  background listening is impossible in a browser: backgrounded tabs are throttled and
  freezable, `SpeechRecognition` terminates when the page loses visibility, and iOS Safari
  revokes mic access for non-foreground pages. Instead, blind games hold a Screen Wake Lock,
  persist every move immediately, and show "Tap to continue" on returning to the foreground.
- **Screen Wake Lock is feature-detected.** Where it is missing the blind screen says so in its
  helper text and the screen may dim between moves; nothing else changes.
- **The engine is single-threaded**, permanently. A multi-threaded Stockfish needs
  `SharedArrayBuffer`, which needs `COOP`/`COEP` response headers, which a static host of this
  class cannot set. It is slower than a threaded build; that is the accepted trade-off.
- **`localStorage` is required for persistence.** In private-browsing modes that block it the
  app keeps working in memory and shows a warning instead of failing.
