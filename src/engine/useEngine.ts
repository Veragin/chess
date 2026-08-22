/**
 * React binding for the singleton engine. Analysis is debounced inside `engine.ts`; this hook
 * only owns *when* the engine is allowed to run: it subscribes while `enabled` and stops the
 * search on unmount or when disabled, so a backgrounded section does not keep a phone's CPU
 * pinned (README Phase 3, battery).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getEngine } from './engine';
import type { EngineHandle } from './engine';
import type { EngineState } from './uci';

const IDLE_STATE: EngineState = { status: 'idle', fen: null, lines: [] };

/**
 * The engine is a singleton, so "unmount ⇒ stop" must not cut analysis short for another
 * mounted consumer. Only the last one out turns the lights off.
 */
let activeConsumers = 0;

export function useEngine(opts?: { enabled?: boolean }): {
  state: EngineState;
  analyze: (fen: string) => void;
  stop: () => void;
} {
  const enabled = opts?.enabled ?? true;
  const [subscribed, setSubscribed] = useState<EngineState>(IDLE_STATE);
  const handleRef = useRef<EngineHandle | null>(null);
  // Derived rather than stored: while disabled the hook reports 'idle' without a render pass.
  const state = enabled ? subscribed : IDLE_STATE;

  useEffect(() => {
    if (!enabled) return;
    const engine = getEngine();
    handleRef.current = engine;
    activeConsumers += 1;
    // `subscribe` boots the worker (and pushes the current state synchronously).
    const unsubscribe = engine.subscribe(setSubscribed);
    return () => {
      unsubscribe();
      handleRef.current = null;
      activeConsumers -= 1;
      if (activeConsumers <= 0) {
        activeConsumers = 0;
        engine.stop();
      }
    };
  }, [enabled]);

  const analyze = useCallback(
    (fen: string) => {
      if (!enabled) return;
      (handleRef.current ?? getEngine()).analyze(fen);
    },
    [enabled],
  );

  const stop = useCallback(() => {
    handleRef.current?.stop();
  }, []);

  return { state, analyze, stop };
}
