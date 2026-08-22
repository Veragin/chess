/**
 * `SpeechSynthesis` wrapper used to echo the understood move before it is applied
 * ("knight f3"), and to announce failures ("didn't catch that") — README §7 Phase 8.
 *
 * Any in-flight utterance is cancelled before a new one starts, so echoes can never pile up
 * when someone speaks several moves in quick succession. Everything no-ops safely when the API
 * is missing (or when this module is loaded in a non-browser environment).
 */

interface SpeechSynthesisGlobals {
  speechSynthesis?: {
    speak(utterance: object): void;
    cancel(): void;
  };
  SpeechSynthesisUtterance?: new (text: string) => {
    lang: string;
    rate: number;
    pitch: number;
    volume: number;
  };
}

function globals(): SpeechSynthesisGlobals {
  return globalThis as unknown as SpeechSynthesisGlobals;
}

export function isSpeechSynthesisSupported(): boolean {
  const scope = globals();
  return scope.speechSynthesis !== undefined && scope.SpeechSynthesisUtterance !== undefined;
}

export function cancelSpeech(): void {
  const synth = globals().speechSynthesis;
  if (synth === undefined) return;
  try {
    synth.cancel();
  } catch {
    // Some engines throw when nothing is queued; nothing to do either way.
  }
}

export function speak(text: string): void {
  const scope = globals();
  const synth = scope.speechSynthesis;
  const Utterance = scope.SpeechSynthesisUtterance;
  if (synth === undefined || Utterance === undefined) return;

  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (trimmed.length === 0) return;

  try {
    // Drop whatever is still being said so the newest echo is the one that is heard.
    synth.cancel();
    const utterance = new Utterance(trimmed);
    utterance.lang = 'en-US';
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    synth.speak(utterance);
  } catch {
    // Speech is a convenience; never let it break a move.
  }
}
