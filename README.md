# Chess — Implementation Plan

A browser-only chess trainer: analyse positions with Stockfish, drill a saved opening
repertoire, and play blind chess by voice on a phone. No backend, no accounts, no network
calls at runtime.

This document is the implementation spec. It is written to be executed top-to-bottom by an
AI agent: every phase has explicit deliverables, file paths, and a **Done when** gate.
Do not start a phase before the previous phase's gate passes.

---

## 1. Locked decisions

These were decided up front. Do not re-litigate them mid-implementation; if one turns out to
be unworkable, stop and report rather than silently substituting an alternative.

| Area | Decision | Consequence |
|---|---|---|
| Deployment | **Plain static host** (GitHub Pages class — no control over HTTP headers) | No `COOP`/`COEP` ⇒ no `SharedArrayBuffer` ⇒ **single-threaded Stockfish only** |
| Engine | Single-threaded `stockfish.wasm` build, `Threads=1` | Weaker/slower than the multi-threaded build. Acceptable; do not attempt a threaded build. |
| Routing | `HashRouter` | Static hosts 404 on deep paths; hash routing avoids server rewrites |
| Pieces | Bundled **cburnett SVG** set (GPLv2+, as used by Lichess), vendored into `public/pieces/` | No CDN dependency, works offline, sharp at any size. **Do not hotlink chess.com assets.** |
| Line model | **Linear only** — start position + one ordered move list | Exactly one correct move per ply in drill. No variation tree. |
| Analyze mode | **Free exploration only** — user moves both colours, engine evaluates continuously | No "play versus engine" opponent |
| Storage | `localStorage`, export/import as a single versioned `.json` file | ~5 MB cap is fine for hundreds of linear lines |
| Voice input | **English, algebraic** ("e4", "knight f3", "bishop takes c6", "castles short") | Single grammar module |
| Blind chess backgrounding | **PWA + best effort**: installable, Screen Wake Lock, graceful foreground resume | See §2 — true background operation is impossible and is *not* a requirement |
| Testing | **Unit tests only** (Vitest) on pure logic | UI is verified manually per phase; keep logic out of components so it stays testable |

### Non-goals

Explicitly out of scope. Do not build these, even partially.

- Any server, API, database, or account system.
- Multiplayer over a network.
- Variation trees / branching repertoire lines.
- Playing against the engine as an opponent.
- Spaced repetition scheduling for drill (uniform random selection only).
- Languages other than English for voice input.
- Opening books, tablebases, cloud eval, PGN import/export.
- E2E/browser-automation test suite.

---

## 2. Hard constraint: blind chess in the background

The original plan required blind chess to "work even if app is on background". **This is not
achievable in a browser** and no amount of engineering inside these constraints will change it:

- Backgrounded tabs have timers throttled and are freezable by the browser.
- `SpeechRecognition` terminates when the page loses visibility or the mic is released.
- iOS Safari revokes mic access for non-foreground pages outright.

Removing the server does not help — this is a page-lifecycle restriction, not a networking one.
True background voice capture would require a native shell (Capacitor/React Native), which is
out of scope.

**What is built instead**, addressing the real underlying problem (the screen sleeping or the
app being dismissed mid-game):

1. **Screen Wake Lock API** (`navigator.wakeLock.request('screen')`) held for the duration of a
   blind game, re-acquired on `visibilitychange` — the screen does not sleep between moves.
2. **Installable PWA** — full-screen, app-like, launches from the home screen.
3. **Durable game state** — every move is persisted to `localStorage` immediately, so
   backgrounding and returning (or an outright reload) resumes the exact position.
4. **Explicit resume UX** — on returning to the foreground, recognition is stopped and the UI
   shows "Tap to continue" rather than pretending it was still listening.

State this limitation in the blind-chess UI itself (one short line of helper text). Do not
imply capability that does not exist.

---

## 3. Stack

- TypeScript (strict), React 19, Vite, `styled-components` v6
- `chess.js` — all rules, legality, SAN/FEN, check/mate/draw detection. **Never hand-roll chess rules.**
- Stockfish WASM, single-threaded build, driven over UCI in a `Worker`
- `react-router` (`HashRouter`)
- `vite-plugin-pwa` (Phase 9 only)
- Vitest for unit tests

If `styled-components` v6 has a peer-dependency conflict with React 19, pin React to 18.3.x
and note it — do not switch styling libraries.

### Environment

The repo already provides a dev container (`docker-compose.yml`, `docker/Dockerfile.dev`,
`Makefile`). Node 22, yarn via corepack. Ports **5174** (dev) and **3002** (preview) are mapped.

- Vite dev server must bind `--host 0.0.0.0 --port 5174` or it is unreachable from the host.
- Vite preview must use port `3002`.
- The app lives at the repo root (`/app`) — there is no `server/` directory. The `Makefile`
  `bash` target currently does `-w /app/server`; change it to `-w /app`.

---

## 4. Repo layout

Create exactly this structure. Domain logic lives outside `components/` so it is unit-testable
without a DOM.

```
/app
├── index.html
├── vite.config.ts
├── tsconfig.json
├── public/
│   ├── engine/                 # stockfish single-thread .js + .wasm (vendored, Phase 3)
│   └── pieces/                 # wK.svg wQ.svg … bP.svg (vendored, Phase 1)
└── src/
    ├── main.tsx
    ├── App.tsx                 # layout shell + HashRouter routes
    ├── theme.ts                # colours, breakpoints, board palette
    ├── chess/
    │   ├── game.ts             # chess.js wrapper: position, legal moves, apply move
    │   ├── position.ts         # FEN build/validate/normalise, square⇄coords helpers
    │   └── *.test.ts
    ├── engine/
    │   ├── uci.ts              # pure parser: UCI info line → EngineInfo
    │   ├── engine.ts           # Worker lifecycle, command queue, subscriptions
    │   ├── useEngine.ts        # React hook over engine.ts
    │   └── uci.test.ts
    ├── speech/
    │   ├── grammar.ts          # pure: transcript + legal moves → resolved move
    │   ├── recognizer.ts       # SpeechRecognition wrapper (push-to-talk)
    │   ├── speak.ts            # SpeechSynthesis wrapper
    │   └── grammar.test.ts
    ├── storage/
    │   ├── schema.ts           # types + version + migrate()
    │   ├── lines.ts            # CRUD, export/import
    │   └── lines.test.ts
    ├── components/
    │   ├── Board/              # Board, Square, Piece, PromotionDialog
    │   ├── EvalBar/
    │   ├── MoveList/
    │   ├── EngineLines/
    │   └── ui/                 # Button, Panel, Toggle, primitives
    └── sections/
        ├── analyze/
        ├── training/           # LinesList, LineEditor, LinePlay, Drill
        └── blind/
```

---

## 5. Core data model

Define these verbatim in the files noted. They are the contract between phases.

```ts
// src/storage/schema.ts
export const LINES_SCHEMA_VERSION = 1;

/** A linear repertoire line: one starting position, one ordered move sequence. */
export interface Line {
  id: string;               // crypto.randomUUID()
  name: string;
  startFen: string;         // valid FEN; standard start position by default
  /** SAN moves in order, alternating sides, starting from the side to move in startFen. */
  moves: string[];
  /** Side the user trains as. Determines who moves in drill vs who is auto-played. */
  userColor: 'w' | 'b';
  /**
   * `/`-separated folder path (`'Black/Sicilian'`), absent/empty for the root. Folders are
   * *implicit* — there is no folder record, a folder exists while some line names it. Added
   * after schemaVersion 1: an additive optional field needs no version bump.
   */
  folder?: string;
  notes?: string;
  createdAt: number;        // epoch ms
  updatedAt: number;
}

export interface LinesFile {
  schemaVersion: number;    // must equal LINES_SCHEMA_VERSION after migrate()
  exportedAt: number;
  lines: Line[];
}
```

```ts
// src/engine/uci.ts
export interface EngineLine {
  multipv: number;          // 1-based
  depth: number;
  /** Centipawns, ALWAYS normalised to White's perspective. */
  cp: number | null;
  /** Mate distance in moves, White's perspective (+ = White mates). */
  mate: number | null;
  /** Principal variation as UCI moves, e.g. ['e2e4','e7e5']. */
  pv: string[];
}

export interface EngineState {
  status: 'idle' | 'loading' | 'ready' | 'analyzing' | 'error';
  fen: string | null;
  lines: EngineLine[];      // sorted by multipv
  nps?: number;
  error?: string;
}
```

Blind-chess and drill session state are local to their sections; only `Line` and `LinesFile`
are persisted long-term (plus one blind-game resume record, see Phase 8).

---

## 6. Architecture rules

**Chess rules.** `chess.js` is the single source of truth. `src/chess/game.ts` is the only
module that imports it. Components receive plain data (FEN, legal-move lists, SAN strings) —
they never hold a `Chess` instance.

**Engine.** One singleton `Worker` for the whole app.

- Assets live in `public/engine/` and are loaded by URL at runtime, **not** bundled by Vite —
  the Stockfish loader fetches its `.wasm` sibling by relative path, which breaks if hashed.
  Build the worker URL from `import.meta.env.BASE_URL` so it survives a non-root base path.
- Handshake: `uci` → wait `uciok` → `setoption name Threads value 1`,
  `setoption name Hash value 16` (keep low; mobile memory), `setoption name MultiPV value 3`
  → `isready` → wait `readyok`.
- Per position: `stop`, then `position fen <fen>`, then `go depth 22`. Debounce position
  changes by ~150 ms. Ignore `info` lines whose position is stale.
- **Score sign:** UCI scores are from the side-to-move's perspective. Negate when it is Black
  to move so `EngineLine.cp`/`mate` are always White-positive. This is the single most
  commonly-botched detail in the whole project — cover it with a unit test both ways.
- Eval bar: map cp to a White win probability with a sigmoid
  (`1 / (1 + 10 ** (-cp / 400))` is fine); clamp to ~[0.02, 0.98] so the bar never fully
  empties. Mate scores pin the bar to its end and display `#N`.
- On the single-threaded build the first load pulls a multi-MB `.wasm`. Show a loading state,
  and let the Phase 9 service worker cache it.

**Board interaction.** Support both, on every device:
- tap-to-select then tap-to-destination, and
- pointer-drag (Pointer Events only — no separate mouse/touch paths; set `touch-action: none`).

The board is a CSS grid with `aspect-ratio: 1`, sized by its container. Highlight the selected
square, legal destinations, last move, and check. Promotion opens a four-choice dialog. Board
orientation is a prop; a rotate button flips it and must not alter game state.

**Layout.** Mobile-first, single breakpoint at 900px.
- Narrow: board full width; eval bar as a thin horizontal strip above it; history and engine
  lines collapse into a panel below.
- Wide: eval bar as a vertical strip left of the board; engine lines above the move list in a
  right-hand column.

**Storage.** Every read goes through `migrate()`. A malformed or unknown-version payload must
never throw into the UI — surface an error and leave existing data untouched. Imports are
validated (shape, FEN legality, and every SAN move replayable from `startFen`) before anything
is written; report which lines were rejected and why.

---

## 7. Phases

### Phase 0 — Project setup

- Scaffold Vite + React + TypeScript (strict) at the repo root; add `styled-components`,
  `chess.js`, `react-router`, `vitest`.
- `vite.config.ts`: dev server `host: '0.0.0.0'`, `port: 5174`; preview `port: 3002`;
  `base` configurable via env (default `'/'`) for the static-host subpath.
- Scripts: `dev`, `build`, `preview`, `test`, `typecheck`, `lint`.
- `theme.ts` + global styles; `App.tsx` shell with `HashRouter` and nav to three routes
  (`#/analyze`, `#/training`, `#/blind`) rendering placeholders.
- Fix `Makefile` `bash` target working dir to `/app`.

**Done when:** `yarn dev` serves on host port 5174, all three routes render, `yarn typecheck`
and `yarn test` pass (zero tests is acceptable here), `yarn build` succeeds.

### Phase 1 — Board

- Vendor the cburnett SVG set into `public/pieces/` as `w{K,Q,R,B,N,P}.svg` / `b{…}.svg`.
  Record the source and licence in `public/pieces/LICENSE`.
- `src/chess/game.ts`: create from FEN, list legal moves for a square, apply a move (SAN or
  from/to/promotion), expose turn, check/checkmate/stalemate/draw, current FEN.
- `src/chess/position.ts`: FEN validation, square↔index helpers, orientation-aware square
  ordering.
- `components/Board`: renders a position, both interaction modes, highlights, promotion dialog,
  rotate button.

**Unit tests:** legal-move generation for a pinned piece; illegal move rejected; promotion
produces the right piece; en-passant and both castlings apply correctly; checkmate and
stalemate detected; orientation mapping is its own inverse.

**Done when:** a full legal game can be played by hand on the board, illegal moves are refused,
rotation works, and the tests above pass.

### Phase 2 — Move history and navigation

- History state: list of `{ san, fenAfter }`, plus a cursor. Navigating the cursor **must not**
  mutate the move list.
- `components/MoveList`: numbered move pairs, current move highlighted, click a move to jump.
- Back / forward / start / end controls, plus ArrowLeft/ArrowRight keyboard bindings.
- Making a move while the cursor is not at the end **truncates** the future moves from that
  point (no variation tree — see non-goals).

**Unit tests:** navigation leaves the move list unchanged; jump-to-index yields the right FEN;
mid-history move truncates correctly.

**Done when:** moves accumulate, navigation is correct in both directions, and playing from a
mid-history position truncates as specified.

### Phase 3 — Stockfish

- Vendor a **single-threaded** Stockfish WASM build into `public/engine/`. Verify the actual
  filenames in the installed package rather than assuming — build names vary by release — and
  confirm at runtime that it does not require `SharedArrayBuffer`.
- `engine/uci.ts`: pure line parser (`info`, `bestmove`, `uciok`, `readyok`), including the
  White-perspective sign normalisation.
- `engine/engine.ts`: worker lifecycle, handshake, command queue, position/stop handling,
  stale-result filtering, subscription API, `terminate()`.
- `engine/useEngine.ts`: hook exposing `EngineState` + `analyze(fen)`; debounced; stops
  analysing when unmounted or when the section is not visible (battery).
- `components/EvalBar` and `components/EngineLines` (top 3 PVs, each with score, depth, and the
  PV rendered as SAN — convert UCI→SAN through `chess/game.ts`).

**Unit tests:** parse a representative `info` line into `EngineLine`; sign normalisation for
both sides to move; `mate` parsing including negative mate; cp→win-probability mapping is
monotonic and clamped; malformed lines are ignored rather than throwing.

**Done when:** loading the board shows a live eval and three best lines that update within a
second of each move, PVs display as SAN, and switching positions rapidly never leaves a stale
eval on screen.

### Phase 4 — Analyze section

- `#/analyze` — board + eval bar + engine lines + move history, wired to Phase 1–3 pieces.
- **Start**: analyse from the standard starting position.
- **Custom**: position editor — paste/edit FEN, drag pieces from a palette onto an empty board,
  clear board, set side to move, castling rights, en-passant target. Validate live and disable
  "Start" while the position is illegal, with the reason shown.
- Analysis state (position + history) survives navigating to another section and back.

**Unit tests:** FEN round-trips through the editor model; rejects positions with no king, two
white kings, a pawn on the first/eighth rank, and a side-to-move already giving check
impossibly.

**Done when:** both entry paths work, invalid custom positions cannot be started, and section
switching preserves the analysis.

### Phase 5 — Lines management

- `storage/schema.ts` + `storage/lines.ts`: CRUD over `localStorage`, `migrate()`,
  `exportAll(): LinesFile`, `importFile(json)` with per-line validation.
- `#/training` — list of saved lines (name, start position thumbnail or FEN, move count,
  trained-as colour, updated date), with search-by-name.
- Line editor: name, folder, trained-as colour, starting position (reuse the Phase 4 position
  editor), and move entry by playing moves on the board with undo/redo. Save validates that
  every move is legal from `startFen`.
- Delete with confirmation. Export downloads a `.json`; import accepts a file and reports
  added / skipped counts and rejection reasons.
- "Open in analyze" hands a line's start position and moves to the Analyze section.

**Folders** (`storage/folders.ts`): the list shows one folder at a time — breadcrumbs up,
subfolder rows down, the lines filed directly here in between. Nesting is `/`-separated, the
root is `''`, and the open folder lives in `?folder=` so a folder is a real, linkable location
(`lines/folderNav.ts`). A folder is created by typing a path into a line's Folder field and
disappears when its last line leaves; renaming one is a bulk edit of its lines' paths, subtree
included, and does not touch their `updatedAt`. Search is scoped to the open folder and
everything below it.

**Unit tests:** create/update/delete round-trip through storage; export→import is
lossless; import rejects a bad schema version, a malformed FEN, and a move sequence that is
illegal at ply 3, without corrupting existing data; `migrate()` handles an empty/absent store.
Folder path normalisation is idempotent and total; containment is segment-aware
(`Sicilian Defence` is not inside `Sicilian`); the implicit tree lists intermediate folders;
renaming carries the subtree, leaves siblings alone, and refuses to move a folder inside itself.

**Done when:** lines survive a reload, export/import round-trips across a cleared
`localStorage`, corrupt imports are rejected cleanly, "open in analyze" loads the line, and a
line can be filed in a nested folder, found by browsing to it, and moved out again.

### Phase 6 — Interactive line play

- From a saved line: play through it move by move. The user plays `userColor`; the app
  auto-plays the other side from the line after a short delay.
- A move matching the line advances; a non-matching legal move is rejected with feedback (this
  is guided practice, not free analysis).
- Controls: restart, step back one move, reveal next move, and **switch sides** — replay the
  same line from the other colour's point of view.
- Show progress (`move 4 of 11`) and an end-of-line state.

**Unit tests:** the line-matching predicate accepts the expected SAN and rejects a legal
alternative; auto-play picks the correct next move; switching `userColor` mid-line resets to
the start of the line rather than producing a half-played state.

**Done when:** a line can be played end-to-end from either side, wrong moves are refused, and
reveal/step-back/restart behave.

### Phase 7 — Drill

- Board only: no eval bar, no engine lines, no move list, no line name — nothing that leaks the
  answer.
- Pick a line uniformly at random from the saved set, excluding lines already served in the
  current cycle; when every line has been served, reshuffle. If no lines exist, show an empty
  state pointing at line management.
- **Scope**: `#/training/drill?folder=…` drills one folder *and its subfolders* — the pool is
  filtered before the cycle starts, so nothing else can ever be served. No parameter means the
  whole repertoire, exactly as before. Changing scope starts a fresh cycle; "Exit drill" returns
  to the folder it was started from. The folder name is the one label the drill screen may show
  (it is the user's own choice, so it leaks no answer).
- Show the line's starting position oriented for `userColor`. The user must play the correct
  move; the app then auto-plays the opponent's line move and continues to the end.
- Wrong move: reject, mark the attempt as failed, let them retry. **Hint** button reveals the
  correct move (also counts as failed).
- End of line: brief result (moves correct / hints used), then next line or exit.

**Unit tests:** the cycle never repeats a line before all have been served; the hint returns the
correct SAN at each ply; drill state machine transitions (awaiting-user → auto-reply →
complete) for a full line, including a line where the user moves second; a folder-scoped pool
contains that folder's subtree and nothing else.

**Done when:** drill runs several lines end-to-end, reveals nothing but the board, hints and
retries work, and drilling a folder never serves a line from outside it.

### Phase 8 — Blind chess

Two players sharing one phone.

- Board rendered **empty** (squares and coordinates only) by default; a toggle reveals/hides
  pieces. Reveal is momentary by design — hiding again must never alter game state.
- Turn indicator ("White to move"), move count, and game-end detection via `chess.js`.
- `speech/recognizer.ts`: push-to-talk — recognition starts on pointer-down, stops on
  pointer-up. Use `continuous: false`, `interimResults: false`, `lang: 'en-US'`,
  `maxAlternatives: 5`. Detect absent `SpeechRecognition`/`webkitSpeechRecognition` and fall
  back to typed move entry.
- `speech/grammar.ts` — **pure and the heart of this phase.** Do not parse the transcript into
  SAN and hope; resolve it against the legal move list:
  1. Lowercase, strip punctuation, tokenise.
  2. Normalise homophones: `night→knight`, `won/one→1`, `to/too/two→2`, `for/four→4`,
     `ate/eight→8`, `be/bee→b`, `see/sea/cee→c`, `dee→d`, `ef→f`, `gee/jee→g`,
     `aitch/each/h→h`, `queue→q`, `ex/axe→takes`.
  3. Extract intent: piece name, origin file/rank hints, destination square, capture flag,
     promotion piece, castling ("castles"/"castle" + "short|kingside|long|queenside").
  4. Filter `game.legalMoves()` by that intent. Exactly one survivor ⇒ resolved. Zero or
     several ⇒ try the next `SpeechRecognition` alternative; if all fail, report
     `unrecognised` or `ambiguous` and do not move.
  5. Pawn preference, applied only after every alternative has failed to resolve outright: when
     no piece was named and exactly one of the remaining candidates is a pawn move, take it —
     an unqualified `"d4"` means the pawn push, not `Nd4`. Several pawn candidates (two pawn
     captures onto one square, an unnamed promotion piece) stay `ambiguous`, and a later
     alternative that names a piece still wins over the preference.
- `speech/speak.ts`: `SpeechSynthesis` echo of what was understood before applying it —
  "knight f3" — then apply. On failure, speak the failure ("didn't catch that").
- Screen Wake Lock held for the game, re-acquired on `visibilitychange`.
- Persist the game (`startFen`, moves, reveal state) on every move; offer resume on load.
- On returning to the foreground, stop recognition and show "Tap to continue".
- One line of helper text stating that the phone must stay in the foreground while listening.

**Unit tests** (the largest test file in the project — cover it thoroughly):
`"e four"` → `e4`; `"knight f3"` → `Nf3`; `"bishop takes c6"` → `Bxc6`;
`"castles short"` → `O-O`, `"castles queenside"` → `O-O-O`; `"rook a1"` disambiguating two
rooks by file (`Rad1`-style cases resolve, genuinely ambiguous ones return `ambiguous`);
`"h3"` from the start position → `h3` (pawn preferred over `Nh3`);
`"e8 queen"` / `"e8 promotes to queen"` → `e8=Q`; a legal-sounding but illegal move returns
`unrecognised`; garbage input returns `unrecognised`; an alternative later in the list resolves
when the first is unusable.

**Done when:** two people can play a full game by voice on a phone with pieces hidden, spoken
moves are echoed then executed, illegal/misheard input never corrupts the position, reveal
toggling is side-effect free, the screen stays awake, and backgrounding then returning resumes
the exact position.

### Phase 9 — PWA and production build

- `vite-plugin-pwa`: manifest (name, icons, `display: standalone`, theme colour), and a service
  worker precaching the app shell, piece SVGs, and the Stockfish `.js`/`.wasm`.
- Verify the production build under the intended `base` subpath: hash routes resolve, pieces
  load, and the engine worker starts (this is where a hard-coded absolute asset path will bite).
- Confirm full offline operation after one load: analyse, drill, and blind chess all work with
  the network disabled.
- README section: build and deploy commands, and the browser-support matrix (voice input
  requires Chrome or Safari; Firefox has no `SpeechRecognition`).

**Done when:** `yarn build && yarn preview` serves a working installable PWA on port 3002, it
functions offline after first load, and it works under a non-root base path.

---

## 8. Known pitfalls

Read this list before Phase 3 and again before Phase 8.

1. **UCI score sign.** Relative to the side to move. Negate for Black. Test both.
2. **Stockfish assets must not be bundled.** The loader fetches its `.wasm` by relative path;
   Vite hashing or inlining breaks it. Keep them in `public/`, reference via `BASE_URL`.
3. **No `SharedArrayBuffer`.** If a chosen build silently requires it, it will fail only in the
   deployed static environment, not necessarily in dev. Assert its absence at load.
4. **Stale engine results.** Always `stop` before a new `position`, and tag results with the FEN
   they belong to; drop anything that does not match the current position.
5. **`chess.js` API surface differs across major versions.** Check the installed version's
   types before writing the wrapper; do not code from memory.
6. **Pointer Events only.** Mixing mouse and touch handlers causes double-fires and dropped
   drags on mobile. Set `touch-action: none` on the board.
7. **`SpeechRecognition` is prefixed** (`webkitSpeechRecognition`) and absent in Firefox. Feature
   detect and provide the typed-move fallback.
8. **iOS requires a user gesture** to start recognition — the push-to-talk pointer-down handler
   satisfies this; a programmatic restart does not.
9. **Wake Lock is released on visibility change** and must be explicitly re-requested.
10. **`localStorage` throws** in private mode and when full. Wrap every access; degrade to
    in-memory with a warning rather than crashing.
11. **Drill must not leak the answer** — no eval, no engine, no move list, no line name, and
    nothing in the DOM or React devtools tree that a curious user would read.
12. **Board orientation is presentation only.** It must never touch game state.

---

## 9. Working agreement

- Land one phase at a time. Run `yarn typecheck && yarn test` before declaring a phase done, and
  state the Done-when result explicitly.
- Keep chess/engine/speech/storage logic in their `src/` modules, not in components — that is
  what makes unit-tests-only viable.
- No new runtime dependencies beyond §3 without flagging it first.
- If a phase gate cannot be met, stop and report what blocks it. Do not proceed on top of a
  failing gate or quietly reduce scope.

## 10. Commands

```bash
make start          # build + start the dev container
make bash           # shell into it (working dir /app)
make ai             # launch the agent in the container

yarn dev            # vite dev server → host :5174
yarn build          # production build
VITE_BASE=/chess/ yarn build   # production build for a static-host subpath (see §12)
yarn preview        # serve the build → host :3002
yarn test           # vitest
yarn typecheck      # tsc --noEmit
```

## 11. Deferred

Deliberately postponed, recorded so they are not silently reintroduced: branching variation
trees, PGN import/export, play-versus-engine, spaced-repetition drill scheduling, non-English
voice input, multi-threaded engine (requires a host that can set `COOP`/`COEP`), and E2E tests.

---

## 12. Build, deploy and browser support

Everything below describes what the app actually does today (Phase 9). Where a capability is
missing it says so; nothing here promises behaviour the app does not have.

### 12.1 Build

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

### 12.2 Deploy to a GitHub-Pages-class static host

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
  of its own script URL (§8.2).

### 12.3 What the PWA does

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

### 12.4 Browser support

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
- **Recognition needs a user gesture** and only works while the page is in the foreground; see
  §2 — true background listening is impossible in a browser and is not implemented.
- **Screen Wake Lock is feature-detected.** Where it is missing the blind screen says so in its
  helper text and the screen may dim between moves; nothing else changes.
- **The engine is single-threaded**, permanently. A multi-threaded Stockfish needs
  `SharedArrayBuffer`, which needs `COOP`/`COEP` response headers, which a static host of this
  class cannot set (§1). It is slower than a threaded build; that is the accepted trade-off.
- **`localStorage` is required for persistence.** In private-browsing modes that block it the
  app keeps working in memory and shows a warning instead of failing.
