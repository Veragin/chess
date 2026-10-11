# Chess

A browser-only chess trainer: analyse positions with Stockfish, drill a saved opening
repertoire, and play blind chess by voice on a phone. No backend, no accounts, no network calls
at runtime.

## Features

- **Analyze** — free exploration from the start position or a custom FEN, with a live eval bar
  and the engine's top three lines. The user moves both colours; there is no engine opponent.
- **Training** — a repertoire of lines (one start position, a _tree_ of moves from it: a main
  line plus any number of branches, with an optional comment on every move), organised in nested
  folders, stored in `localStorage` and exportable as a single `.json` file — the whole
  repertoire from the top, or just the open folder and its subfolders from inside one. Lines are
  built in an editor by playing moves on the board; a different move anywhere adds a branch.
  Drill one line, one folder or the whole repertoire from a board that shows nothing else —
  random order, every branch of a line before the next line, and every branch comes up exactly
  once per drill; a hint shows the move and its comment; when a branch is done you can take the
  next branch or line, replay that same branch, or open it in Analyze. See
  [Lines, branches and comments](#lines-branches-and-comments). Files in `public/data/` ship as
  a starter repertoire — see
  [Bundled lines](#bundled-lines-publicdata).
- **Explore** (inside Training) — the same board and engine as Analyze, next to what the
  _repertoire_ says about the position on it: every saved line that reaches it (by transposition,
  not just by move order, and along every branch), the move each of them plays next with what the
  lines' comments say about it, and which lines end there. Playing a
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

## Lines, branches and comments

A line is one start position and a **move tree** (`src/chess/tree.ts`): every move node carries
its SAN, an optional `comment` and its continuations, and the **first continuation is the main
line**. A _branch_ is one path from the start to the end of the tree; branches are numbered at
runtime in tree order (branch 1 is the main line) and never stored, so an edit may renumber
them. The lines screen shows a line's size as "12 moves · 3 branches". A comment belongs to the
move it describes (the comment on `Nf3` is about playing `Nf3`); the line-level notes stay as
they were.

- **Stored as schema v2, PGN-like.** `src/storage/schema.ts` writes `schemaVersion: 2`; each
  line's `tree` is its main line as a flat array of moves, and an array right after a move is an
  alternative to that move (PGN's `( … )`). A move is a SAN string, or `{ "san", "comment" }` when
  it has a comment (`src/storage/treeFormat.ts`):

    ```json
    "tree": ["e4", "e5", "Nf3", "Nc6", ["Nf6", "Nxe5"], { "san": "Bc4", "comment": "Italian" }]
    ```

    Only the stored form is arrays: in memory a line still holds the node tree above. Exports and
    `public/data` are laid out by a compact printer (`src/storage/formatJson.ts`) that packs moves
    into rows. v1 data — an old store, an old export, a bundled file — is still read: each v1
    linear `moves` line becomes a single-branch tree (nothing is joined), and a v1 store is written
    back as v2 on the next save. A file from a newer version is refused.
    Trees are checked iteratively and capped at 1000 plies deep and 20 000 moves per line, so an
    absurd payload is refused rather than overflowing the stack. Import replays every branch and
    names the first broken move ("move 7 in branch 3"); spellings of the same move are normalised
    and duplicate siblings merged.

- **The editor edits the tree.** Playing a move at the cursor follows an existing continuation
  or adds a new branch from there; nothing is ever truncated, and the saved line is the whole
  tree wherever the cursor is (`src/chess/treeHistory.ts`, `src/sections/training/lines/draft.ts`).
  The move view (`src/components/MoveTree`) shows the main line inline and each variation as an
  indented `( … )` block; click a move to go there, or use the arrow keys — ←/→ for the previous
  / next move along the main continuation, ↑/↓ to switch between alternatives. **New branch** moves
  the cursor back to the selected move's parent so the next move played becomes an alternative
  to it (it deletes nothing), **Make main line** promotes the selected move's branch, **Delete
  from here** removes the selected move and everything after it (confirmed when that is more
  than one move). The **comment** field
  under the tree edits the comment on the selected move ("Comment on 12…Nf3"); moves with a
  comment get a marker in the tree. Changing the start position keeps every move, branch and
  comment still legal and reports how many were dropped.
- **Drill serves branches.** The cycle (`src/chess/drill.ts`, `pickNextBranch`) picks a random
  line, then serves its unserved branches one after another in random order, and only then moves
  to another random line; every branch comes up once per drill, and `?line=` drills every branch
  of that one line. The summary says "Branch 2 of 5" for a line with several branches, and the
  button reads **Next branch** while the line has branches left, **Next line** otherwise (and
  **Finish drill** at the end); "Restart branch" replays the branch just played.
- **Any repertoire move is accepted.** Where the line allows several moves for the trained side,
  playing any of them is correct: the run switches to a branch through that move (preferring one
  not yet served this drill) and that branch counts as served. Opponent replies always follow the
  branch being played. Positions in the bundled data where this applies are listed in
  `duplicities.md`.
- **A hint shows the comment.** The comment describes the answer, so it stays hidden until a
  hint reveals the move, and then appears under it. Still no line name and no move list.
- **Hand-offs are linear.** "Open in Analyze" after a drill loads the branch that was drilled;
  the lines screen's Analyze and Explore buttons load the main line. Explore's "Save as new line"
  creates a single-branch line.

---

## Bundled lines (`public/data`)

Every `public/data/*.json` file is a Training export (`schemaVersion`, `exportedAt`, `lines`)
— schema v2 today, though a v1 file is still accepted and seeded as single-branch lines — and its
lines are added to the user's repertoire automatically. To ship a repertoire with the
app: export it from Training, drop the file in `public/data/`, rebuild. There is no list of file
names to maintain — `src/storage/seedData.ts` globs the directory at **build time** and the JSON
travels inside the bundle, so seeding needs no fetch, no manifest and no network (it works on the
very first visit and offline). Each line's own `folder` field decides where it is filed;
`Stafford.json` puts its lines in `Stafford`.

Rules the seeder (`src/storage/seed.ts`) keeps:

- **Once, then hands off.** A line is seeded on the first load that sees it and is an ordinary
  line from then on — editable, deletable, exported with the rest. Delete it and it stays
  deleted; edit it and the edit survives the next load.
- **A record of its own.** Delivered lines are remembered as `file::id` keys under
  `chess-trainer.seededLines.v1`, separate from the repertoire. Adding a file, or a line to an
  existing file, seeds exactly the new material next time. Same `id` in two files = two lines.
- **Bundled files are validated like any import.** Same shape, FEN-legality and SAN-replay checks
  as `Import…`, per line: one unplayable line is refused with a reason while its healthy siblings
  are seeded, and an unreadable file changes nothing at all. Refusals are _not_ recorded as
  delivered, so fixing the file seeds the line on the next load, and the lines screen shows what
  it could not read (silence there would look like a missing line).
- **One write, and never a false record.** All files are validated first, added in a single
  write, and the record is only persisted if that write reached `localStorage` — a memory-only
  session must not tell the next one that these lines were already delivered.

Fresh ids are assigned on the way in (as for any import), so a seed can never overwrite an
existing line; an identical-content guard keeps duplicates away even if the record is lost.

**Clear data…** (Training, beside Export / Import) empties every key the app owns: the
repertoire, the seed record and the blind-game resume record. Clearing the seed record along with
the lines is what makes it a reset rather than a deletion — the next load seeds every bundled
line again — so the only permanent loss is the lines no bundled file can produce: the ones
written, imported or edited by hand. The confirmation counts exactly those (`storage/reset.ts`
compares stored lines against the bundled files by content, because stored lines carry fresh ids
that the seed record cannot match), and the notice afterwards repeats the count.

**Browsers that seeded the old v1 files keep their old lines.** The bundled files were rewritten
as joined v2 lines with new ids, so their `file::id` keys are new to the seed record and the
merged trees match no old line by content: a browser that had already seeded the v1 lines gets
the merged lines _on top of_ the old single-move-list ones. There is deliberately no dedupe for
this; **Clear data…** removes the old copies (and re-seeds only the current bundled lines), at
the cost of any hand-made lines, which it counts first.

### Regenerating the bundled data (`scripts/migrate-data.ts`)

The files were produced by a re-runnable script, which goes through `migrate()` and
`src/chess/tree.ts` so its output is guaranteed loadable:

```bash
npx tsx scripts/migrate-data.ts                 # rewrite public/data (+ duplicities.md)
npx tsx scripts/migrate-data.ts --dry-run       # report only, write nothing
npx tsx scripts/migrate-data.ts --duplicities   # rewrite duplicities.md even if no data changed
npx tsx scripts/migrate-data.ts --source <dir>  # read the input from <dir>; output still goes to public/data
npx tsx scripts/migrate-data.ts --graft         # also graft lines starting mid-game into others
```

The committed files were generated from the original v1 files (`git show <rev>:public/data/<file>`
extracted into a scratch directory, passed as `--source`), so the original line names, notes and
timestamps are what got joined. Re-running with the default source on its own output changes
nothing.

- **Re-filing.** Lines of the mixed `Petroff-defense.json` are moved to the file and folder of
  their opening (Stafford, Traxler, Petroff, Anti-london, Center Game, From gambit, Budapest);
  a line no rule matches aborts the run. Other files keep their lines.
- **Joining.** Lines with the same target file and folder, start position (first four FEN
  fields), trained side and the same first 3 moves (`SHARED_PLIES`) are merged into one tree
  (`joinKey`); the file's own lines come first, so they stay the main line. A source line's
  notes become the comment on its last move. Other lines stay separate (the report lists them
  with the reason); files are never joined with each other. With `--graft`, a joined line whose
  start position is reached inside another line of the same file and trained side is also
  **grafted** there (merged into the children of the first node reaching that position).
- **Naming.** `<Opening> - <first 5 moves>`, e.g. `Stafford - Bc5 Be2 h5 c3 Ng4`, where the
  opening is the folder path with `/` → space; a clash gets ` (2)`, ` (3)`… Ids are derived from
  the join key, so re-running on its own output changes nothing.
- **Checked before it finishes.** Any refused line or unplayable move aborts before writing; the
  written files are read back through `migrate()`, every tree must replay, and every source
  line must still be a path in some output line — from its root, or from a node reaching the
  source's start position (a grafted line). The report prints lines in → lines out per file,
  the branches of every output line, the grafts and what stayed separate. `duplicities.md`
  (positions, matched across all files, where the trained side has more than one repertoire
  move) is regenerated whenever the data changes.

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

- **Lines are matched by transposition, along every branch.** Two lines reaching the same
  position by different move orders are both listed, and so is a line whose _variation_ gets
  there; each continuation a line's tree has from the position counts, and a line reaching it by
  two of its own branches with the same next move is counted once. The key is the first four FEN fields — placement, side to move,
  castling rights, en-passant square — so the move counters, which are exactly what differs
  between two routes, are ignored. Every scoped line's whole tree is replayed once into an index
  (`src/sections/explore/coverage.ts`), not re-replayed on every move.
- **Every continuation is a button.** The panel groups the lines that reach the position by the
  move each plays next, most-played first, and clicking one plays it — so walking the tree is how
  you find the gap. Lines that _end_ in the position (a branch with no further moves) are listed
  separately: a line that has said all it wants to say is not a hole.
- **Comments come with the moves.** Under each continuation the panel lists what each line says
  about it — on each branch, the first comment from that move on (up to 8 plies ahead), headed
  by the line's name and the moves up to the commented one. Above the continuations it shows the comment
  on the move that led to the board's position, when a reaching line played that same move from
  the same position.
- **The move history saves into a new line.** "Save as new line" hands the moves up to the cursor
  to the ordinary line editor (`#/training/new?from=explore`) as a single-branch line, which is where the name, folder,
  trained-as colour and notes are filled in. The moves travel in memory, not in the URL
  (`src/state/newLine.ts`) — a truncated query string would silently save a shorter line.
- **`?folder=` scopes what counts as coverage**, exactly as it does for drill, so "Explore" inside
  a folder checks that repertoire and nothing else. The scope is also a dropdown on the screen.
  From a line's row it opens on that line, scoped to the line's own folder — the lines it could
  transpose with are its siblings.
- **A damaged line is reported, not hidden.** A stored line whose moves no longer replay (a
  hand-edited `localStorage`, an edited start position) is indexed as far as it goes — only the
  unplayable move's subtree is lost, its playable siblings still count — and named under "cannot
  continue", with the rest of the panel unaffected.

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
so nothing is hard-coded to `/`. Always build with the _final_ base — the value is baked in.

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
- **Cost of that, stated plainly:** on a _cold first visit_ the wasm is fetched twice — once by
  the engine worker (which is created before the service worker is controlling the page) and
  once by the precache — so the first visit costs ~14.6 MB rather than ~7.5 MB. Every later
  visit fetches it zero times. The alternative (runtime caching for that one file) downloads it
  once but only fills the cache on the _second_ visit, which would break offline-after-one-load;
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

| Capability                                         | Chrome / Edge           | Safari                                      | Firefox                                                       |
| -------------------------------------------------- | ----------------------- | ------------------------------------------- | ------------------------------------------------------------- |
| Board, analyse, explore, lines, drill, blind board | Yes                     | Yes                                         | Yes                                                           |
| Stockfish (single-threaded WASM)                   | Yes                     | Yes                                         | Yes                                                           |
| Install as an app (PWA)                            | Yes                     | iOS/iPadOS 16.4+, macOS 14+ ("Add to Dock") | Android yes; desktop no install UI                            |
| Offline via service worker                         | Yes                     | Yes                                         | Yes                                                           |
| **Voice move entry** (`SpeechRecognition`)         | Yes                     | Yes (`webkitSpeechRecognition`)             | **No — falls back to typed entry**                            |
| Spoken echo of the move (`SpeechSynthesis`)        | Yes                     | Yes                                         | Yes                                                           |
| Screen Wake Lock                                   | Yes (desktop + Android) | iOS/iPadOS 16.4+                            | Feature-detected; older versions have no `navigator.wakeLock` |

Notes:

- **Voice input requires Chrome or Safari.** Firefox implements no `SpeechRecognition` at all.
  The blind-chess screen feature-detects it (`src/speech/recognizer.ts`) and renders a typed
  move box instead, which goes through the _same_ grammar module — so `"knight f3"`,
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
