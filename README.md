# Chess

A browser-only chess trainer: analyse positions with Stockfish, drill a saved opening
repertoire, and play blind chess by voice on a phone. No backend, no accounts, no network calls
at runtime.

## Features

- **Analyze** — free exploration from the start position or a custom FEN, with a live eval bar
  and the engine's top three lines. The user moves both colours; there is no engine opponent.
- **Training** — a repertoire of linear lines (one start position, one ordered move list),
  organised in nested folders, stored in `localStorage` and exportable as a single `.json` file.
  Drill one line, one folder or the whole repertoire from a board that shows nothing else —
  random order, and every line comes up exactly once per drill; when a line is done you can take
  the next one, replay that same line, or open it in Analyze. Files in `public/data/` ship as
  a starter repertoire — see
  [Bundled lines](#bundled-lines-publicdata).
- **Explore** (inside Training) — the same board and engine as Analyze, next to what the
  *repertoire* says about the position on it: every saved line that reaches it (by transposition,
  not just by move order), the move each of them plays next, and which lines end there. Playing a
  continuation is one click, so checking a repertoire for holes is a walk down the tree; when the
  engine suggests something no line covers, the move history saves straight into a new line.
  Scoped by folder, reached from the Explore button beside Drill and from each line's row — see
  [Explore](#explore).
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

## Bundled lines (`public/data`)

Every `public/data/*.json` file is a Training export (`schemaVersion`, `exportedAt`, `lines`),
and its lines are added to the user's repertoire automatically. To ship a repertoire with the
app: export it from Training, drop the file in `public/data/`, rebuild. There is no list of file
names to maintain — `src/storage/seedData.ts` globs the directory at **build time** and the JSON
travels inside the bundle, so seeding needs no fetch, no manifest and no network (it works on the
very first visit and offline). Each line's own `folder` field decides where it is filed;
`stafford.json` puts its lines in `Stafford`.

Rules the seeder (`src/storage/seed.ts`) keeps:

- **Once, then hands off.** A line is seeded on the first load that sees it and is an ordinary
  line from then on — editable, deletable, exported with the rest. Delete it and it stays
  deleted; edit it and the edit survives the next load.
- **A record of its own.** Delivered lines are remembered as `file::id` keys under
  `chess-trainer.seededLines.v1`, separate from the repertoire. Adding a file, or a line to an
  existing file, seeds exactly the new material next time. Same `id` in two files = two lines.
- **Bundled files are validated like any import.** Same shape, FEN-legality and SAN-replay checks
  as `Import…`, per line: one unplayable line is refused with a reason while its healthy siblings
  are seeded, and an unreadable file changes nothing at all. Refusals are *not* recorded as
  delivered, so fixing the file seeds the line on the next load, and the lines screen shows what
  it could not read (silence there would look like a missing line).
- **One write, and never a false record.** All files are validated first, added in a single
  write, and the record is only persisted if that write reached `localStorage` — a memory-only
  session must not tell the next one that these lines were already delivered.

Fresh ids are assigned on the way in (as for any import), so a seed can never overwrite an
existing line; an identical-content guard keeps duplicates away even if the record is lost.

---

## Explore

`#/training/explore` answers one question about the position on the board: **is it covered?** The
left half is the analyse screen (eval bar, engine's top lines, both colours movable); the right
half is the repertoire's own answer.

It is a screen of the **Training** tab, not a tab of its own: what it reads and what it writes are
both the repertoire, so it sits next to the lines it compares against. The way in is the
**Explore** button beside Drill / Drill folder on the lines screen (and per folder and per line
row); the way out is the `‹ Lines` link, which returns to the folder that scoped the exploration.
A bookmarked `#/explore?folder=…` still works — it redirects, folder and all.

- **Lines are matched by transposition.** Two lines reaching the same position by different move
  orders are both listed. The key is the first four FEN fields — placement, side to move,
  castling rights, en-passant square — so the move counters, which are exactly what differs
  between two routes, are ignored. Every scoped line is replayed once into an index
  (`src/sections/explore/coverage.ts`), not re-replayed on every move.
- **Every continuation is a button.** The panel groups the lines that reach the position by the
  move each plays next, most-played first, and clicking one plays it — so walking the tree is how
  you find the gap. Lines that *end* in the position are listed separately: a line that has said
  all it wants to say is not a hole.
- **The move history saves into a new line.** "Save as new line" hands the moves up to the cursor
  to the ordinary line editor (`#/training/new?from=explore`), which is where the name, folder,
  trained-as colour and notes are filled in. The moves travel in memory, not in the URL
  (`src/state/newLine.ts`) — a truncated query string would silently save a shorter line.
- **`?folder=` scopes what counts as coverage**, exactly as it does for drill, so "Explore" inside
  a folder checks that repertoire and nothing else. The scope is also a dropdown on the screen.
  From a line's row it opens on that line, scoped to the line's own folder — the lines it could
  transpose with are its siblings.
- **A damaged line is reported, not hidden.** A stored line whose moves no longer replay (a
  hand-edited `localStorage`, an edited start position) is indexed as far as it goes and named
  under "cannot continue", with the rest of the panel unaffected.

The exploration itself lives outside the React tree (`src/state/explore.ts`), separately from
Analyze's, so going to Training to fix a line and coming back does not lose the position.

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
├── data/                       # the bundled line files, copied verbatim; the app never
│                               #   fetches them (they are already inside assets/)
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
  live Stockfish evaluation), explore, line management, line play, drill and blind chess all
  work, and a hard reload still boots the app. There is no network feature to lose — the app makes no runtime
  network calls of its own.
- **Not offline-capable:** the very first visit. The wasm has to be downloaded once.

## Browser support

| Capability | Chrome / Edge | Safari | Firefox |
|---|---|---|---|
| Board, analyse, explore, lines, drill, blind board | Yes | Yes | Yes |
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
