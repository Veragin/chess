/**
 * The one and only Stockfish worker for the whole app (README §6).
 *
 * Design notes, all of them load-bearing:
 *
 * - **Assets are not bundled.** The worker URL is built from `import.meta.env.BASE_URL` and
 *   points at `public/engine/`, so a non-root deploy base works and Vite never hashes or
 *   inlines the `.js` / `.wasm` pair (README §8.2). The loader derives the `.wasm` URL from
 *   its own script URL, which is why the two files must stay siblings.
 *
 * - **No `SharedArrayBuffer`.** The vendored build is the single-threaded one and contains no
 *   reference to it. `assertNoSharedArrayBuffer()` re-checks that at load in dev builds so a
 *   future asset swap cannot smuggle a threaded build in (README §8.3).
 *
 * - **Stale results (README §8.4).** Two independent barriers:
 *   1. *Handover on `bestmove`.* A new position sends `stop` and then waits for the running
 *      search's `bestmove` before sending `position` / `go`. `isready` is deliberately NOT
 *      used as the barrier: UCI requires `readyok` to be answered *during* a search, so it
 *      proves nothing — and this build traps ("RuntimeError: unreachable") if `position`
 *      arrives while a search is still live. Verified in Chrome.
 *   2. *FEN tagging.* Accepted `info` lines are tagged with the FEN `go` was issued for and
 *      are published only while that is still the FEN the app asked for. Everything received
 *      between `stop` and the next `go` is dropped outright.
 *
 * - **Command queue.** Anything requested before the handshake finishes is queued, not lost.
 *
 * - Failures surface as `status: 'error'` with a message. Nothing here throws at the caller.
 */

import type { Color } from '../chess/game';
import { parseUciLine } from './uci';
import type { EngineLine, EngineState } from './uci';

export interface EngineHandle {
  subscribe(fn: (s: EngineState) => void): () => void;
  getState(): EngineState;
  analyze(fen: string): void; // debounced ~150ms, stops previous search
  stop(): void;
  terminate(): void;
}

/** Must match the vendored filenames in `public/engine/` exactly — see that dir's README. */
const ENGINE_SCRIPT = 'engine/stockfish-18-lite-single.js';

const SEARCH_DEPTH = 22;
const DEBOUNCE_MS = 150;
const HASH_MB = 16;
const MULTI_PV = 3;
/** Generous: the first load pulls a ~7 MB wasm over whatever connection the phone has. */
const LOAD_TIMEOUT_MS = 120_000;
/** How long to wait for the `bestmove` that acknowledges a `stop` before nudging again. */
const STOP_TIMEOUT_MS = 1_000;
const STOP_RETRIES = 3;

const IDLE_STATE: EngineState = { status: 'idle', fen: null, lines: [] };

/** `BASE_URL` is '/' by default and e.g. '/chess/' under a static-host subpath. */
export function engineScriptUrl(): string {
  const raw = import.meta.env.BASE_URL || '/';
  const base = raw.endsWith('/') ? raw : `${raw}/`;
  return `${base}${ENGINE_SCRIPT}`;
}

/**
 * README §8.3: a build that silently needs `SharedArrayBuffer` only fails once deployed to a
 * host without COOP/COEP. Fetching the 21 KB loader and grepping it is cheap, happens once,
 * and is served from cache alongside the worker's own request for it.
 */
async function assertNoSharedArrayBuffer(url: string): Promise<void> {
  try {
    const source = await (await fetch(url)).text();
    if (source.includes('SharedArrayBuffer')) {
      console.error(
        `[engine] ${url} references SharedArrayBuffer. This app deploys without COOP/COEP ` +
          `(README §1), so only the single-threaded build may be vendored in public/engine/.`,
      );
    }
  } catch {
    // The worker's own load will report a real failure; never let the probe be the error.
  }
}

function turnOf(fen: string): Color {
  const field = fen.trim().split(/\s+/)[1];
  return field === 'b' ? 'b' : 'w';
}

class StockfishEngine implements EngineHandle {
  private worker: Worker | null = null;
  private state: EngineState = IDLE_STATE;
  private readonly subscribers = new Set<(s: EngineState) => void>();

  /** Handshake complete — commands may go straight out instead of into the queue. */
  private ready = false;
  private awaitingHandshake = false;
  private readonly queue: string[] = [];

  /** The FEN the app wants analysed (may still be inside the debounce window). */
  private requestedFen: string | null = null;
  /** The FEN `go` was actually issued for. `info` is only accepted while this matches. */
  private searchFen: string | null = null;
  private searchTurn: Color = 'w';
  /** A `go` is outstanding: no `bestmove` for it has come back yet. */
  private searching = false;
  /** False from `stop` until the next `go` — everything arriving in between is stale. */
  private acceptInfo = false;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private loadTimer: ReturnType<typeof setTimeout> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private stopAttempts = 0;
  private readonly lines = new Map<number, EngineLine>();

  subscribe(fn: (s: EngineState) => void): () => void {
    this.subscribers.add(fn);
    this.start();
    fn(this.state);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  getState(): EngineState {
    return this.state;
  }

  analyze(fen: string): void {
    if (typeof fen !== 'string' || fen.trim() === '') return;
    this.start();
    if (this.state.status === 'error') return;
    if (this.requestedFen === fen) return;

    this.requestedFen = fen;
    // Drop the previous position's lines immediately: a rapid switch must never leave a stale
    // eval on screen, not even for the length of the debounce.
    this.acceptInfo = false;
    this.searchFen = null;
    this.lines.clear();
    this.patch({
      status: this.ready ? 'analyzing' : 'loading',
      fen,
      lines: [],
      nps: undefined,
    });

    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.beginSearch();
    }, DEBOUNCE_MS);
  }

  stop(): void {
    this.clearDebounce();
    this.acceptInfo = false;
    this.searchFen = null;
    this.requestedFen = null;
    if (!this.worker || this.state.status === 'error') return;
    if (this.searching) this.requestStop();
    if (this.state.status === 'analyzing') this.patch({ status: 'ready' });
  }

  terminate(): void {
    this.clearDebounce();
    this.clearStopTimer();
    if (this.loadTimer !== null) clearTimeout(this.loadTimer);
    this.loadTimer = null;
    if (this.worker) {
      try {
        this.worker.postMessage('quit');
      } catch {
        /* the worker may already be gone */
      }
      this.worker.terminate();
      this.worker = null;
    }
    this.ready = false;
    this.awaitingHandshake = false;
    this.searching = false;
    this.acceptInfo = false;
    this.queue.length = 0;
    this.lines.clear();
    this.requestedFen = null;
    this.searchFen = null;
    // A later analyze()/subscribe() boots a fresh worker.
    this.setState(IDLE_STATE);
  }

  // --- worker lifecycle -------------------------------------------------------------------

  private start(): void {
    if (this.worker) return;
    if (typeof Worker === 'undefined') {
      this.fail('Web Workers are not available in this environment.');
      return;
    }

    const url = engineScriptUrl();
    if (import.meta.env.DEV) void assertNoSharedArrayBuffer(url);

    let worker: Worker;
    try {
      worker = new Worker(url);
    } catch (err) {
      this.fail(`Could not start the engine worker (${url}): ${describe(err)}`);
      return;
    }

    this.worker = worker;
    this.ready = false;
    this.patch({ status: 'loading', error: undefined });

    worker.onmessage = (e: MessageEvent) => {
      const data: unknown = e.data;
      if (typeof data !== 'string') return;
      for (const line of data.split('\n')) this.handleLine(line);
    };
    worker.onerror = (e: ErrorEvent) => {
      const hint =
        typeof SharedArrayBuffer === 'undefined'
          ? ' (if this build needs SharedArrayBuffer it is the wrong one — see public/engine/README.md)'
          : '';
      this.fail(`Engine worker error: ${e.message || 'unknown'}${hint}`);
    };
    worker.onmessageerror = () => this.fail('Engine worker sent an unreadable message.');

    this.loadTimer = setTimeout(() => {
      this.loadTimer = null;
      if (!this.ready) this.fail('The engine did not finish loading in time.');
    }, LOAD_TIMEOUT_MS);

    // Handshake, exactly as specified in README §6.
    this.awaitingHandshake = true;
    this.raw('uci');
  }

  private handleLine(raw: string): void {
    if (raw.trim() === '') return;
    const event = parseUciLine(raw, this.searchTurn);

    switch (event.kind) {
      case 'uciok': {
        this.raw('setoption name Threads value 1');
        this.raw(`setoption name Hash value ${HASH_MB}`);
        this.raw(`setoption name MultiPV value ${MULTI_PV}`);
        this.raw('isready');
        break;
      }
      case 'readyok': {
        // The only `isready` this module ever sends is the handshake one.
        if (this.awaitingHandshake) this.onHandshakeComplete();
        break;
      }
      case 'info': {
        this.onInfo(event.line, event.nps);
        break;
      }
      case 'bestmove': {
        this.onBestmove();
        break;
      }
      default:
        break;
    }
  }

  private onHandshakeComplete(): void {
    this.awaitingHandshake = false;
    if (this.loadTimer !== null) {
      clearTimeout(this.loadTimer);
      this.loadTimer = null;
    }
    this.ready = true;
    this.patch({ status: this.requestedFen ? 'analyzing' : 'ready', error: undefined });
    // Flush anything the app asked for while the wasm was still downloading.
    const pending = this.queue.splice(0, this.queue.length);
    for (const cmd of pending) this.raw(cmd);
    if (this.requestedFen !== null) this.beginSearch();
  }

  /**
   * A search ended — either because it hit `go depth`, or because our `stop` was honoured.
   * This is the *only* safe moment to hand the engine a new position.
   */
  private onBestmove(): void {
    this.clearStopTimer();
    this.searching = false;
    const finished = this.searchFen;
    this.acceptInfo = false;

    if (this.requestedFen !== null && this.requestedFen !== finished) {
      this.startSearch(this.requestedFen);
      return;
    }
    // The search for the position on screen ran to completion; keep its lines, drop the
    // "working" status.
    this.searchFen = finished;
    if (this.state.status === 'analyzing') this.patch({ status: 'ready' });
  }

  private beginSearch(): void {
    const fen = this.requestedFen;
    if (fen === null || !this.worker || this.state.status === 'error') return;
    // Still downloading/handshaking: `onHandshakeComplete` picks the request back up.
    if (!this.ready) return;

    if (this.searching) {
      // Ask the running search to finish; `onBestmove` starts this one.
      this.acceptInfo = false;
      this.searchFen = null;
      this.requestStop();
      return;
    }
    this.startSearch(fen);
  }

  private startSearch(fen: string): void {
    this.searchFen = fen;
    this.searchTurn = turnOf(fen);
    this.lines.clear();
    this.acceptInfo = true;
    this.searching = true;
    this.patch({ status: 'analyzing', fen, lines: [], nps: undefined });
    this.send(`position fen ${fen}`);
    this.send(`go depth ${SEARCH_DEPTH}`);
  }

  /** `stop` is idempotent for the engine but must be re-nudged if `bestmove` goes missing. */
  private requestStop(): void {
    if (this.stopTimer !== null) return; // a stop is already outstanding
    this.stopAttempts = 0;
    this.send('stop');
    this.armStopTimer();
  }

  private armStopTimer(): void {
    this.stopTimer = setTimeout(() => {
      this.stopTimer = null;
      if (!this.searching) return;
      this.stopAttempts += 1;
      if (this.stopAttempts <= STOP_RETRIES) {
        this.send('stop');
        this.armStopTimer();
        return;
      }
      // Last resort: the engine never acknowledged. Treat the search as over rather than
      // leaving the UI permanently without an evaluation.
      console.warn('[engine] no bestmove after stop; forcing a new search');
      this.onBestmove();
    }, STOP_TIMEOUT_MS);
  }

  private clearStopTimer(): void {
    if (this.stopTimer !== null) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    this.stopAttempts = 0;
  }

  private clearDebounce(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  }

  private onInfo(line: EngineLine, nps: number | undefined): void {
    // Barrier 1: nothing is accepted between `stop` and the next `go`.
    // Barrier 2: the result is tagged with `searchFen`; it must still be what the app wants.
    if (!this.acceptInfo) return;
    if (this.searchFen === null || this.searchFen !== this.requestedFen) return;

    const previous = this.lines.get(line.multipv);
    // Keep the deepest report for each multipv slot.
    if (previous && previous.depth > line.depth) return;
    this.lines.set(line.multipv, line);

    const sorted = [...this.lines.values()]
      .sort((a, b) => a.multipv - b.multipv)
      .slice(0, MULTI_PV);
    this.patch({ status: 'analyzing', fen: this.searchFen, lines: sorted, nps });
  }

  // --- commands ---------------------------------------------------------------------------

  /** Queued until the handshake completes, so nothing sent early is lost. */
  private send(cmd: string): void {
    if (!this.worker) return;
    if (!this.ready) {
      this.queue.push(cmd);
      return;
    }
    this.raw(cmd);
  }

  private raw(cmd: string): void {
    if (!this.worker) return;
    try {
      this.worker.postMessage(cmd);
    } catch (err) {
      this.fail(`Could not send "${cmd}" to the engine: ${describe(err)}`);
    }
  }

  // --- state ------------------------------------------------------------------------------

  private fail(message: string): void {
    this.clearDebounce();
    this.clearStopTimer();
    if (this.loadTimer !== null) clearTimeout(this.loadTimer);
    this.loadTimer = null;
    this.ready = false;
    this.awaitingHandshake = false;
    this.searching = false;
    this.acceptInfo = false;
    this.queue.length = 0;
    this.setState({ status: 'error', fen: this.state.fen, lines: [], error: message });
  }

  private patch(part: Partial<EngineState>): void {
    this.setState({ ...this.state, ...part });
  }

  private setState(next: EngineState): void {
    this.state = next;
    for (const fn of [...this.subscribers]) {
      try {
        fn(next);
      } catch (err) {
        console.error('[engine] subscriber threw', err);
      }
    }
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

let singleton: StockfishEngine | null = null;

/** Process-wide singleton, lazily created. The worker itself boots on first use. */
export function getEngine(): EngineHandle {
  singleton ??= new StockfishEngine();
  return singleton;
}
