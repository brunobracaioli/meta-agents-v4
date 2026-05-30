"use client";

/**
 * Wake-word listener using the browser's native SpeechRecognition (Web Speech API).
 * No account/key needed — works in Chrome/Edge. It listens continuously while armed
 * and fires `onWake` when the keyword (e.g. "ultron") appears in a transcript. The
 * caller is expected to stop it while handling the command (so it doesn't capture the
 * TTS reply) and re-arm afterwards.
 *
 * Privacy note: in Chrome this streams audio to Google's recognition service while
 * armed — acceptable for an internal, password-gated operator dashboard. For on-device
 * detection, swap in Picovoice Porcupine later (ADR/spec note).
 */

// Minimal typings for the non-standard Web Speech API (absent from lib.dom).
type RecognitionAlternative = { transcript: string };
type RecognitionResult = { readonly length: number; readonly [index: number]: RecognitionAlternative };
type RecognitionResultList = { readonly length: number; readonly [index: number]: RecognitionResult };
type RecognitionEvent = { resultIndex: number; results: RecognitionResultList };
type RecognitionErrorEvent = { error: string };
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export type WakeController = {
  isSupported: boolean;
  start: () => void;
  stop: () => void;
};

function getCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function isWakeWordSupported(): boolean {
  return getCtor() !== undefined;
}

export function createWakeWord(opts: {
  word: string;
  lang?: string;
  onWake: () => void;
  onError?: (message: string) => void;
}): WakeController {
  const Ctor = getCtor();
  if (!Ctor) return { isSupported: false, start: () => {}, stop: () => {} };

  const word = opts.word.toLowerCase();
  let rec: SpeechRecognitionLike | null = null;
  let active = false;

  const build = (): SpeechRecognitionLike => {
    const r = new Ctor();
    r.lang = opts.lang ?? "pt-BR";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const transcript = result?.[0]?.transcript?.toLowerCase() ?? "";
        if (transcript.includes(word)) {
          opts.onWake();
          return;
        }
      }
    };
    r.onerror = (e) => {
      // 'no-speech' / 'aborted' are routine; surface the rest.
      if (e.error === "no-speech" || e.error === "aborted") return;
      opts.onError?.(e.error);
    };
    r.onend = () => {
      // continuous recognition can still stop on its own — restart while armed.
      if (active && rec) {
        try {
          rec.start();
        } catch {
          /* already started */
        }
      }
    };
    return r;
  };

  return {
    isSupported: true,
    start: () => {
      active = true;
      if (!rec) rec = build();
      try {
        rec.start();
      } catch {
        /* already started */
      }
    },
    stop: () => {
      active = false;
      if (rec) {
        rec.onend = null;
        try {
          rec.abort();
        } catch {
          /* noop */
        }
        rec = null;
      }
    },
  };
}
