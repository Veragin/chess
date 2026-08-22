# Vendored Stockfish (WASM, single-threaded)

These files are served as-is from `public/` and are **loaded by URL at runtime, never bundled**
(README §6, §8.2): the loader derives the `.wasm` path from its own script URL by swapping the
extension, so the two files must stay side by side and must not be renamed or content-hashed.

## Provenance

| | |
|---|---|
| npm package | `stockfish@18.0.8` (<https://www.npmjs.com/package/stockfish>) |
| Upstream project | Stockfish.js by Nathan Rugg — <https://github.com/nmrugg/stockfish.js> |
| Build name | `stockfish-18-lite-single` (single-threaded, "lite" NNUE) |
| Engine version | Stockfish 18 (`buildVersion: "18"`) |
| NNUE net | `nn-9067e33176e8.nnue` (embedded in the `.wasm`; net by Linmiao Xu / linrock) |
| Licence | GPL-3.0 — full text in `LICENSE` (upstream `Copying.txt`) |
| Copyright | Stockfish.js (c) 2026 Chess.com, LLC; Stockfish (c) T. Romstad, M. Costalba, J. Kiiski, G. Linscott and contributors |

## Files

| File | Bytes | Notes |
|---|---|---|
| `stockfish-18-lite-single.js` | 21 429 | Loader; runs as a **classic Web Worker** (`new Worker(url)`, UCI over `postMessage`) |
| `stockfish-18-lite-single.wasm` | 7 295 411 | ~7.0 MiB; fetched by the loader as a sibling of the `.js` |
| `LICENSE` | 35 821 | GPL-3.0, copied verbatim from `stockfish@18.0.8/Copying.txt` |

Copied verbatim from the package tarball; no patching of any kind.

## Why this build

* **Single-threaded on purpose.** The app deploys to a plain static host with no control over
  HTTP headers, so there is no `COOP`/`COEP`, hence no `SharedArrayBuffer` and no threads
  (README §1). `grep -c SharedArrayBuffer stockfish-18-lite-single.js` → **0**. The
  *multi-threaded* `stockfish-18-lite.js` from the same package *does* reference it — do not
  swap it in.
* **"Lite" net on purpose.** The full-net `stockfish-18-single.wasm` in the same package is
  **113 MB**, which is not shippable to a browser over a static host. Lite is ~7 MB.
* `engine.ts` additionally asserts at load (dev builds) that the fetched loader source contains
  no `SharedArrayBuffer` reference, and reports a failure through `EngineState.status = 'error'`
  rather than throwing.
