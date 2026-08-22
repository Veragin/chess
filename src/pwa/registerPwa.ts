/**
 * Service-worker registration (Phase 9).
 *
 * Why it looks like this:
 *
 * - **`autoUpdate`, not prompt-on-update.** The shell is `index.html` plus content-hashed JS/CSS.
 *   A service worker that keeps serving the old `index.html` while the new hashed chunks are the
 *   only ones on the host produces a blank screen, and a user who dismisses an update prompt
 *   would be stuck in exactly that state. So the new worker skips waiting, claims the clients and
 *   the page reloads itself once — the app is fully state-persistent (`localStorage`), so a reload
 *   is cheap and never loses a line, a drill or a blind game.
 *
 * - **Registered on `window.load`, not at module evaluation.** Precaching pulls ~7 MB of Stockfish
 *   wasm. Starting that during boot would fight the app's own first paint for bandwidth, so
 *   `immediate: false` hands registration to `workbox-window`, which waits for the `load` event.
 *   Precaching then happens entirely inside the service worker: the page stays interactive, and the
 *   engine's own loading state (see `src/engine/engine.ts`) covers the wait for the wasm.
 *
 * - **No UI.** The offline-ready and update transitions are silent by design; the only visible
 *   effect is one reload after a deploy. Status is reported on `window` as
 *   `chess-trainer:pwa` events for anything that later wants to surface it.
 */

import { registerSW } from 'virtual:pwa-register';

export type PwaEvent = 'offline-ready' | 'updated' | 'error';

const EVENT_NAME = 'chess-trainer:pwa';

function emit(detail: PwaEvent): void {
  window.dispatchEvent(new CustomEvent<PwaEvent>(EVENT_NAME, { detail }));
}

/** Guards against a reload loop if activation were ever to fire more than once. */
let reloading = false;

export function registerPwa(): void {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  registerSW({
    // Defer to the `load` event so precaching cannot compete with first paint.
    immediate: false,
    onOfflineReady() {
      // First install finished: shell, pieces and engine are in the precache.
      emit('offline-ready');
    },
    onNeedReload() {
      // `autoUpdate` + `skipWaiting`: the new worker is already active, so the page must be
      // reloaded to stop mixing the old document with the new assets.
      emit('updated');
      if (reloading) return;
      reloading = true;
      window.location.reload();
    },
    onRegisterError(error: unknown) {
      console.warn('[pwa] service worker registration failed', error);
      emit('error');
    },
  });
}
