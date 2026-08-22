/**
 * Push-to-talk `SpeechRecognition` wrapper (README §7 Phase 8, §8.7, §8.8).
 *
 *  - `start()` runs on pointer-down, `stop()` on pointer-up. `start()` MUST be invoked
 *    synchronously from the user-gesture handler: iOS only grants the mic to a gesture, and a
 *    programmatic restart is silently refused. This module therefore never restarts itself.
 *  - The API is prefixed on WebKit and entirely absent in Firefox, so both globals are
 *    feature-detected and `createRecognizer` returns `null` when neither exists — the UI falls
 *    back to typed move entry.
 *
 * Browser typings are declared locally: no `@types` package is added, and no `any` leaks into
 * an exported signature. The names are suffixed `Like` so they never collide with (or silently
 * depend on) whatever `lib.dom.d.ts` happens to ship.
 */

interface SpeechRecognitionAlternativeLike {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResultLike {
  readonly length: number;
  readonly isFinal: boolean;
  item(index: number): SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  item(index: number): SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike {
  readonly error: string;
  readonly message?: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onnomatch: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructorLike = new () => SpeechRecognitionLike;

interface SpeechRecognitionGlobals {
  SpeechRecognition?: SpeechRecognitionConstructorLike;
  webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
}

function getConstructor(): SpeechRecognitionConstructorLike | null {
  if (typeof globalThis === 'undefined') return null;
  const scope = globalThis as unknown as SpeechRecognitionGlobals;
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getConstructor() !== null;
}

export interface Recognizer {
  /** Must be called from a user-gesture handler (pointer-down). Idempotent. */
  start(): void;
  /** Idempotent; safe to call when not listening. */
  stop(): void;
  /** Detaches every handler and aborts any in-flight recognition. */
  dispose(): void;
}

export interface RecognizerCallbacks {
  onResult(alternatives: string[]): void;
  onError(message: string): void;
  onStateChange(listening: boolean): void;
}

/** Maps a `SpeechRecognitionErrorEvent.error` code onto something a user can act on. */
function errorMessage(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access is blocked. Allow the mic permission to use voice input.';
    case 'no-speech':
      return "Didn't catch that — nothing was heard.";
    case 'audio-capture':
      return 'No microphone was found.';
    case 'network':
      return 'Speech recognition needs a network connection right now.';
    case 'aborted':
      return 'Listening was interrupted.';
    case 'language-not-supported':
      return 'English speech recognition is not available in this browser.';
    case 'bad-grammar':
      return 'Speech recognition rejected the grammar.';
    default:
      return `Speech recognition failed (${code}).`;
  }
}

/** Highest confidence first; blanks dropped and duplicates collapsed. */
function readAlternatives(event: SpeechRecognitionEventLike): string[] {
  const out: { transcript: string; confidence: number }[] = [];
  const results = event.results;
  for (let r = event.resultIndex; r < results.length; r++) {
    const result = results.item(r);
    for (let a = 0; a < result.length; a++) {
      const alternative = result.item(a);
      const transcript = alternative.transcript.trim();
      if (transcript.length === 0) continue;
      const confidence = Number.isFinite(alternative.confidence) ? alternative.confidence : 0;
      out.push({ transcript, confidence });
    }
  }
  // Array.prototype.sort is stable, so equal confidences keep the browser's own ordering.
  out.sort((x, y) => y.confidence - x.confidence);

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const item of out) {
    const key = item.transcript.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item.transcript);
  }
  return unique;
}

export function createRecognizer(cb: RecognizerCallbacks): Recognizer | null {
  const Ctor = getConstructor();
  if (Ctor === null) return null;

  let recognition: SpeechRecognitionLike;
  try {
    recognition = new Ctor();
  } catch {
    return null;
  }

  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';
  recognition.maxAlternatives = 5;

  let listening = false;
  let starting = false;
  let disposed = false;

  const setListening = (value: boolean): void => {
    if (listening === value) return;
    listening = value;
    if (!disposed) cb.onStateChange(value);
  };

  recognition.onstart = () => {
    starting = false;
    setListening(true);
  };

  recognition.onend = () => {
    starting = false;
    setListening(false);
  };

  recognition.onresult = (event) => {
    if (disposed) return;
    const alternatives = readAlternatives(event);
    if (alternatives.length === 0) {
      cb.onError("Didn't catch that.");
      return;
    }
    cb.onResult(alternatives);
  };

  recognition.onerror = (event) => {
    starting = false;
    if (!disposed) cb.onError(errorMessage(event.error));
    setListening(false);
  };

  recognition.onnomatch = () => {
    if (!disposed) cb.onError("Didn't catch that.");
  };

  const detach = (): void => {
    recognition.onstart = null;
    recognition.onend = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onnomatch = null;
  };

  return {
    start(): void {
      if (disposed || listening || starting) return;
      starting = true;
      try {
        // Called straight from the pointer-down handler — this is the user gesture.
        recognition.start();
      } catch {
        // Chrome throws InvalidStateError if a previous session has not finished yet.
        starting = false;
      }
    },
    stop(): void {
      if (disposed || (!listening && !starting)) return;
      starting = false;
      try {
        recognition.stop();
      } catch {
        setListening(false);
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      detach();
      try {
        recognition.abort();
      } catch {
        // Nothing to abort.
      }
      listening = false;
      starting = false;
    },
  };
}
