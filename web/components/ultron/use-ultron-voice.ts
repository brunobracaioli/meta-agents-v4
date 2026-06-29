"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AGENT_TRIGGER_CHANNEL,
  AGENT_TRIGGER_EVENT,
  LANDING_EDIT_CHANNEL,
  LANDING_EDIT_EVENT,
  LIVE_REVIEW_CHANNEL,
  LIVE_REVIEW_EVENT,
  ARC_RENDER_CHANNEL,
  ARC_RENDER_EVENT,
  isAgentTrigger,
  isLandingEditSignal,
  isLiveReviewSignal,
  landingEditKey,
  liveReviewKey,
  type AgentTrigger,
  type LandingEditSignal,
  type LiveReviewSignal,
} from "@/lib/ultron/agent-trigger";
import { parseUIIntents, type UIIntent } from "@/lib/ultron/render-intents";
import { SentenceAccumulator } from "@/lib/ultron/sentence-stream";
import { createChatEventParser, type ChatStreamSignals } from "@/lib/ultron/chat-stream";
import {
  createRealtimeTranscriber,
  sttStreamingEnabled,
  type RealtimeTranscriber,
} from "@/lib/ultron/realtime-stt-client";
import { getSessionId } from "@/lib/ultron/session";
import { createWakeWord, isWakeWordSupported, type WakeController } from "@/lib/ultron/wake-word";
import { createVadMic, isVadWorkletSupported, type VadEvent, type VadMicHandle } from "./vad-mic";
import { useScreenShare } from "./use-screen-share";

export type UltronStatus =
  | "idle"
  | "armed" // wake-word mode: listening for "Ultron"
  | "listening" // hands-free: waiting for speech onset
  | "recording"
  | "transcribing"
  | "thinking"
  | "capturing" // grabbing a screen frame for Ultron to look at
  | "speaking"
  | "error";

export type UltronState = {
  status: UltronStatus;
  handsFree: boolean;
  wakeActive: boolean;
  wakeSupported: boolean;
  outputLevel: number;
  outputBands: number[];
  transcript: string | null;
  reply: string | null;
  error: string | null;
};

const WAKE_WORD = "ultron";

// Energy-based VAD tuning. The detection runs in an AudioWorklet (vad-mic.ts +
// public/ultron/vad-processor.js) so it survives tab backgrounding; these are the
// authoritative thresholds passed to the worklet. The rAF path below reuses them
// as a fallback for browsers without AudioWorklet.
// Stop after this much trailing silence. History: 900ms cut natural mid-sentence
// pauses; 1800ms was safe but added ~0.9s of dead air per turn; 1200ms was the middle
// ground. Now 1000ms: once STT moved to gpt-4o-mini-transcribe (~0.8s in prod), this
// trailing-silence floor became the single largest FIXED chunk of perceived latency,
// so we trim another 200ms (validate live — going below risks the mid-sentence cutoff
// regression). The worklet reads this via VAD_CONFIG.silenceMs, so this is the single
// source of truth for both the worklet and the rAF fallback below.
const SILENCE_MS = 1000;
const SPEECH_RMS = 0.025; // onset threshold
const SILENCE_RMS = 0.015; // below this counts as silence
const MAX_CLIP_MS = 45_000; // hard cap per utterance; spoken campaign instructions easily exceed 12s
// Opus bitrate for the recorded clip. Default MediaRecorder opus runs ~117kbps (a ~7s
// command → ~103KB), and uploading that whole blob AFTER speech-end was ~1s+ of the STT
// round-trip (the server's stt_timing never sees it). 32kbps opus is transparent for
// speech (WhatsApp voice notes sit ~24kbps; gpt-4o-mini-transcribe handles it cleanly),
// shrinking the blob ~3.5x → far less upload latency before transcription can start.
const AUDIO_BITS_PER_SECOND = 32_000;
const OUTPUT_BAND_COUNT = 18;
const OUTPUT_FRAME_MS = 48;
const MAX_CAPTURE_HOPS = 4; // bound client-side capture round-trips per turn

const VAD_CONFIG = {
  speechRms: SPEECH_RMS,
  silenceRms: SILENCE_RMS,
  silenceMs: SILENCE_MS,
  maxClipMs: MAX_CLIP_MS,
};

const CLIENT_FALLBACK = "Desculpa, tive um problema agora. Tenta de novo.";
const NO_SCREEN_MSG =
  "Não consigo ver sua tela. Ativa o compartilhamento ali no painel do Ultron e me pede de novo.";

type UltronApiResponse = {
  reply?: string;
  status?: string;
  pendingId?: string;
  agentTriggers?: unknown[];
  landingEdits?: unknown[];
  liveReviews?: unknown[];
  uiIntents?: unknown[];
};

function silentOutputBands(): number[] {
  return Array.from({ length: OUTPUT_BAND_COUNT }, () => 0);
}

// Single-producer/single-consumer async queue of sentences awaiting TTS. The SSE
// reader pushes complete sentences; the playback worker pulls and speaks them in
// order, awaiting an empty queue without busy-looping.
class AudioQueue {
  private items: string[] = [];
  private wake: (() => void) | null = null;
  private closed = false;

  push(item: string): void {
    this.items.push(item);
    this.wake?.();
    this.wake = null;
  }

  close(): void {
    this.closed = true;
    this.wake?.();
    this.wake = null;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<string> {
    for (;;) {
      if (this.items.length > 0) {
        yield this.items.shift()!;
        continue;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }
}

// Client-side latency telemetry marks (performance.now() timestamps).
type TurnMarks = {
  speechEnd: number;
  sttDone: number;
  firstToken: number;
  firstSentence: number;
  firstAudio: number;
};

// Logs the per-stage breakdown for one turn (end of speech → first audio). No PII —
// only durations. Visible in the browser console to measure the real pipeline.
function logTurnTimings(m: TurnMarks): void {
  const round = (a: number, b: number) => (a > 0 && b > 0 ? Math.round(a - b) : null);
  console.info(
    JSON.stringify({
      event: "ultron_client_timing",
      stt_ms: round(m.sttDone, m.speechEnd),
      to_first_token_ms: round(m.firstToken, m.sttDone),
      to_first_sentence_ms: round(m.firstSentence, m.firstToken),
      to_first_audio_ms: round(m.firstAudio, m.firstSentence),
      end_to_first_audio_ms: round(m.firstAudio, m.speechEnd),
    }),
  );
}

export function useUltronVoice() {
  const [state, setState] = useState<UltronState>({
    status: "idle",
    handsFree: false,
    wakeActive: false,
    wakeSupported: false,
    outputLevel: 0,
    outputBands: silentOutputBands(),
    transcript: null,
    reply: null,
    error: null,
  });

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const clipStartRef = useRef<number>(0);
  const pendingStopRef = useRef<boolean>(false); // speech-end arrived before the recorder existed
  const speechSeenRef = useRef<boolean>(false);
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const speechDoneRef = useRef<(() => void) | null>(null);
  // Flips true to tear down an in-flight streaming reply (barge-in / cleanup): the
  // SSE reader, the sentence queue worker, and the per-clip MSE pump all check it.
  const streamCancelledRef = useRef<boolean>(false);
  const chatAbortRef = useRef<AbortController | null>(null);
  // Realtime STT (ADR 0032): when enabled, captures mic PCM in parallel with the recorder
  // so the transcript is ~ready at speech-end. Null = use the one-shot path (always the fallback).
  const transcriberRef = useRef<RealtimeTranscriber | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const outputSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputRafRef = useRef<number | null>(null);
  const outputLastFrameRef = useRef<number>(0);

  // High-frequency mirror of the speaking audio level/bands + status, mutated in place
  // (never via setState) so imperative consumers — e.g. the 3D avatar's rAF lip-sync —
  // can read the live signal every frame without re-rendering React at ~20 Hz.
  const liveSignalRef = useRef<{ level: number; bands: number[]; status: UltronStatus }>({
    level: 0,
    bands: silentOutputBands(),
    status: "idle",
  });
  const handsFreeRef = useRef<boolean>(false);
  const wakeRef = useRef<WakeController | null>(null);
  const wakeModeRef = useRef<boolean>(false);
  const armedRef = useRef<boolean>(false);
  const publishedTriggerIdsRef = useRef<Set<string>>(new Set());
  const publishedLandingEditKeysRef = useRef<Set<string>>(new Set());
  const publishedLiveReviewKeysRef = useRef<Set<string>>(new Set());

  // Autonomous-mode narrations (ADR 0019): the headless watch inserts spoken updates; we poll
  // and speak them via the same TTS when the assistant is otherwise idle. statusRef mirrors the
  // current status so the poller can gate without re-subscribing; the Set dedupes across polls.
  const statusRef = useRef<UltronStatus>("idle");
  const narrationSpokenIdsRef = useRef<Set<string>>(new Set());
  const narrationBusyRef = useRef<boolean>(false);

  // Auto-review on completion (SPEC-014 v1): when enabled, poll for a freshly-created landing page
  // and open the Live Review overlay automatically. Deduped by id (persisted in localStorage) so a
  // page fires at most once; the first poll after enabling only baselines (an already-ready page is
  // never reviewed retroactively). autoReviewRef mirrors the toggle for the interval's closure.
  const [autoReview, setAutoReview] = useState(false);
  const autoReviewRef = useRef(false);
  const autoReviewSeedRef = useRef(true);
  const autoReviewedIdsRef = useRef<Set<string>>(new Set());

  // VAD-via-worklet state. `vadMode` is decided once on first mic setup.
  const vadMicRef = useRef<VadMicHandle | null>(null);
  const vadModeRef = useRef<"worklet" | "raf">("raf");
  const vadReadyRef = useRef<Promise<void> | null>(null);
  const listeningRef = useRef<boolean>(false); // hands-free: armed for onset, not yet recording
  const onVadEventRef = useRef<(event: VadEvent) => void>(() => {});

  const patch = useCallback((p: Partial<UltronState>) => setState((s) => ({ ...s, ...p })), []);

  const { sharing, start: startShare, stop: stopShare, captureFrame } = useScreenShare();

  const publishAgentTriggers = useCallback((values: unknown[] | undefined) => {
    if (!values || values.length === 0) return;
    const fresh = values.filter(isAgentTrigger).filter((trigger) => {
      if (publishedTriggerIdsRef.current.has(trigger.jobId)) return false;
      publishedTriggerIdsRef.current.add(trigger.jobId);
      return true;
    });
    if (fresh.length === 0) return;

    fresh.forEach((trigger) => {
      window.dispatchEvent(new CustomEvent<AgentTrigger>(AGENT_TRIGGER_EVENT, { detail: trigger }));
    });

    if (!("BroadcastChannel" in window)) return;
    try {
      const channel = new BroadcastChannel(AGENT_TRIGGER_CHANNEL);
      fresh.forEach((trigger) => channel.postMessage(trigger));
      window.setTimeout(() => channel.close(), 0);
    } catch {
      // Same-window CustomEvent already delivered the trigger; cross-tab delivery is best-effort.
    }
  }, []);

  // Ultron edits landing-page drafts straight in Supabase, so the open editor would
  // otherwise show stale content until a manual reload. We fan the applied edits back
  // out the same way as agent triggers: a same-window CustomEvent (widget floating over
  // the editor) plus a cross-tab BroadcastChannel (editor in another tab). The editor
  // listens, refetches, and reconciles by version.
  const publishLandingEdits = useCallback((values: unknown[] | undefined) => {
    if (!values || values.length === 0) return;
    const fresh = values.filter(isLandingEditSignal).filter((signal) => {
      const key = landingEditKey(signal);
      if (publishedLandingEditKeysRef.current.has(key)) return false;
      publishedLandingEditKeysRef.current.add(key);
      return true;
    });
    if (fresh.length === 0) return;

    fresh.forEach((signal) => {
      window.dispatchEvent(new CustomEvent<LandingEditSignal>(LANDING_EDIT_EVENT, { detail: signal }));
    });

    if (!("BroadcastChannel" in window)) return;
    try {
      const channel = new BroadcastChannel(LANDING_EDIT_CHANNEL);
      fresh.forEach((signal) => channel.postMessage(signal));
      window.setTimeout(() => channel.close(), 0);
    } catch {
      // Same-window CustomEvent already delivered the signal; cross-tab delivery is best-effort.
    }
  }, []);

  // Live Review (SPEC-014): when request_live_review fires, fan the signal out the same way so
  // the LiveReviewStage overlay (this tab, or a dashboard in another tab) starts the fullscreen
  // section-by-section review. Deduped by key so retries/polls don't restart an in-flight review.
  const publishLiveReviews = useCallback((values: unknown[] | undefined) => {
    if (!values || values.length === 0) return;
    const fresh = values.filter(isLiveReviewSignal).filter((signal) => {
      const key = liveReviewKey(signal);
      if (publishedLiveReviewKeysRef.current.has(key)) return false;
      publishedLiveReviewKeysRef.current.add(key);
      return true;
    });
    if (fresh.length === 0) return;

    fresh.forEach((signal) => {
      window.dispatchEvent(new CustomEvent<LiveReviewSignal>(LIVE_REVIEW_EVENT, { detail: signal }));
    });

    if (!("BroadcastChannel" in window)) return;
    try {
      const channel = new BroadcastChannel(LIVE_REVIEW_CHANNEL);
      fresh.forEach((signal) => channel.postMessage(signal));
      window.setTimeout(() => channel.close(), 0);
    } catch {
      // Same-window CustomEvent already delivered the signal; cross-tab delivery is best-effort.
    }
  }, []);

  // ARC (SPEC-019): when a render-tool fires, the chat reply carries UIIntents back. We
  // revalidate them at the client boundary (parseUIIntents drops malformed) and fan them out
  // the same way — a same-window CustomEvent the ARC tab's <ArcBridge> listens for, plus a
  // cross-tab BroadcastChannel for the optional popout window. No dedup needed: the Render Bus
  // reducer is idempotent for show/dismiss, and chat replies are one-shot (not polled).
  const publishUiIntents = useCallback((values: unknown[] | undefined) => {
    const intents = parseUIIntents(values);
    if (intents.length === 0) return;

    window.dispatchEvent(new CustomEvent<UIIntent[]>(ARC_RENDER_EVENT, { detail: intents }));

    if (!("BroadcastChannel" in window)) return;
    try {
      const channel = new BroadcastChannel(ARC_RENDER_CHANNEL);
      channel.postMessage(intents);
      window.setTimeout(() => channel.close(), 0);
    } catch {
      // Same-window CustomEvent already delivered the intents; cross-tab delivery is best-effort.
    }
  }, []);

  // Sets up the mic stream and, once, the VAD path (worklet preferred; rAF
  // fallback). Idempotent: safe to call from every entry point.
  const ensureMic = useCallback(async (): Promise<MediaStream> => {
    if (!streamRef.current) {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    if (!vadReadyRef.current) {
      vadReadyRef.current = (async () => {
        const stream = streamRef.current!;
        if (isVadWorkletSupported()) {
          try {
            vadMicRef.current = await createVadMic({
              stream,
              config: VAD_CONFIG,
              onEvent: (event) => onVadEventRef.current(event),
            });
            vadModeRef.current = "worklet";
            return;
          } catch {
            vadModeRef.current = "raf";
          }
        }
        // rAF fallback: an input analyser polled by requestAnimationFrame.
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
      })();
    }
    await vadReadyRef.current;
    return streamRef.current!;
  }, []);

  const rms = useCallback((): number => {
    const analyser = analyserRef.current;
    if (!analyser) return 0;
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
    return Math.sqrt(sum / buf.length);
  }, []);

  const stopVadLoop = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    silenceStartRef.current = null;
  }, []);

  const stopOutputAnalysis = useCallback((resetState = true) => {
    if (outputRafRef.current != null) cancelAnimationFrame(outputRafRef.current);
    outputRafRef.current = null;
    outputLastFrameRef.current = 0;

    try {
      outputSourceRef.current?.disconnect();
    } catch {
      // The node may already be detached when playback is interrupted.
    }
    try {
      outputAnalyserRef.current?.disconnect();
    } catch {
      // The node may already be detached when playback is interrupted.
    }
    void outputCtxRef.current?.close().catch(() => {});

    outputSourceRef.current = null;
    outputAnalyserRef.current = null;
    outputCtxRef.current = null;
    if (resetState) {
      liveSignalRef.current.level = 0;
      liveSignalRef.current.bands = silentOutputBands();
      patch({ outputLevel: 0, outputBands: silentOutputBands() });
    }
  }, [patch]);

  const startOutputAnalysis = useCallback(
    (audio: HTMLAudioElement) => {
      stopOutputAnalysis(false);

      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.76;

      source.connect(analyser);
      analyser.connect(ctx.destination);

      outputCtxRef.current = ctx;
      outputSourceRef.current = source;
      outputAnalyserRef.current = analyser;

      const freq = new Uint8Array(analyser.frequencyBinCount);
      const time = new Float32Array(analyser.fftSize);

      const tick = () => {
        if (outputAnalyserRef.current !== analyser) return;

        const now = performance.now();
        if (now - outputLastFrameRef.current >= OUTPUT_FRAME_MS) {
          analyser.getByteFrequencyData(freq);
          analyser.getFloatTimeDomainData(time);

          let sum = 0;
          for (let i = 0; i < time.length; i++) {
            const sample = time[i] ?? 0;
            sum += sample * sample;
          }

          const level = Math.min(1, Math.sqrt(sum / time.length) * 3.8);
          const bucketSize = Math.max(1, Math.floor(freq.length / OUTPUT_BAND_COUNT));
          const bands: number[] = [];

          for (let band = 0; band < OUTPUT_BAND_COUNT; band++) {
            const start = band * bucketSize;
            const end =
              band === OUTPUT_BAND_COUNT - 1 ? freq.length : Math.min(freq.length, start + bucketSize);
            let bucket = 0;
            for (let i = start; i < end; i++) bucket += freq[i] ?? 0;
            const width = Math.max(1, end - start);
            bands.push(Math.min(1, (bucket / (width * 255)) * 1.65));
          }

          outputLastFrameRef.current = now;
          liveSignalRef.current.level = level;
          liveSignalRef.current.bands = bands;
          patch({ outputLevel: level, outputBands: bands });
        }

        if (!audio.ended) outputRafRef.current = requestAnimationFrame(tick);
      };

      outputRafRef.current = requestAnimationFrame(tick);
      return ctx;
    },
    [patch, stopOutputAnalysis],
  );

  const finalizeRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }
    // speech-end can land while beginRecording is still setting up the MediaRecorder
    // (very short utterances). Remember it so the recorder stops as soon as it starts —
    // the worklet self-disarmed on speech-end, so otherwise nothing would ever stop it.
    pendingStopRef.current = true;
  }, []);

  // rAF fallback only: stop on trailing silence or max-clip timeout. In worklet
  // mode the AudioWorklet emits speech-end instead and this is never started.
  const monitorWhileRecording = useCallback(() => {
    const tick = () => {
      const level = rms();
      const now = performance.now();
      if (level > SPEECH_RMS) speechSeenRef.current = true;
      if (level < SILENCE_RMS) {
        if (silenceStartRef.current == null) silenceStartRef.current = now;
        else if (speechSeenRef.current && now - silenceStartRef.current > SILENCE_MS) {
          stopVadLoop();
          finalizeRecording();
          return;
        }
      } else {
        silenceStartRef.current = null;
      }
      if (now - clipStartRef.current > MAX_CLIP_MS) {
        stopVadLoop();
        finalizeRecording();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [rms, stopVadLoop, finalizeRecording]);

  // Plays ONE clip of speech (one sentence, or a full narration). Streams the MP3
  // into the player via MSE so playback starts on the first chunk (the server pipes
  // ElevenLabs first-byte-fast); falls back to a single blob where MSE can't decode
  // audio/mpeg (e.g. Safari). Resolves when the clip ends/errors or `isCancelled()`
  // flips. Does NOT touch status or restore the mode — the caller owns that, so the
  // same primitive serves both single narrations and the streamed sentence queue.
  const playClip = useCallback(
    async (text: string, isCancelled: () => boolean): Promise<void> => {
      if (isCancelled() || !text) return;
      let url: string | null = null;
      try {
        const res = await fetch("/api/ultron/tts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok || !res.body) throw new Error("tts");

        const audio = new Audio();
        audio.preload = "auto";
        playerRef.current = audio;

        await new Promise<void>((resolve) => {
          let done = false;
          const settle = () => {
            if (done) return;
            done = true;
            resolve();
          };
          speechDoneRef.current = settle;
          audio.addEventListener("ended", settle, { once: true });
          audio.addEventListener("error", settle, { once: true });

          // Frequency analysis + actual playback. createMediaElementSource may be
          // called only once per element, so this fires exactly once (first chunk).
          const startPlayback = () => {
            const ctx = startOutputAnalysis(audio);
            void ctx
              .resume()
              .then(() => audio.play())
              .catch(() => settle());
          };

          const canStream =
            typeof MediaSource !== "undefined" && MediaSource.isTypeSupported("audio/mpeg");

          if (!canStream) {
            void res
              .blob()
              .then((blob) => {
                url = URL.createObjectURL(blob);
                audio.src = url;
                startPlayback();
              })
              .catch(() => settle());
            return;
          }

          const mediaSource = new MediaSource();
          url = URL.createObjectURL(mediaSource);
          audio.src = url;
          mediaSource.addEventListener(
            "sourceopen",
            () => {
              let sb: SourceBuffer;
              try {
                sb = mediaSource.addSourceBuffer("audio/mpeg");
              } catch {
                settle();
                return;
              }
              const reader = res.body!.getReader();
              const chunks: Uint8Array[] = [];
              let reading = true;
              let started = false;

              const endStream = () => {
                if (mediaSource.readyState !== "open") return;
                try {
                  mediaSource.endOfStream();
                } catch {
                  // Already closed/ended — playback will settle on its own.
                }
              };
              const pump = () => {
                if (isCancelled() || sb.updating || chunks.length === 0) return;
                try {
                  // A fetch reader yields Uint8Array<ArrayBufferLike>; it is a valid
                  // BufferSource at runtime, but TS's lib types narrow appendBuffer to
                  // ArrayBuffer-backed views, hence the cast.
                  sb.appendBuffer(chunks.shift()! as BufferSource);
                } catch {
                  settle();
                }
              };
              sb.addEventListener("updateend", () => {
                pump();
                if (!reading && !sb.updating && chunks.length === 0) endStream();
              });

              void (async () => {
                try {
                  for (;;) {
                    const { done: rdone, value } = await reader.read();
                    if (isCancelled()) {
                      await reader.cancel().catch(() => {});
                      settle();
                      return;
                    }
                    if (rdone) break;
                    if (value && value.length > 0) {
                      chunks.push(value);
                      pump();
                      if (!started) {
                        started = true;
                        startPlayback();
                      }
                    }
                  }
                } catch {
                  settle();
                  return;
                } finally {
                  reading = false;
                }
                if (!sb.updating && chunks.length === 0) endStream();
              })();
            },
            { once: true },
          );
        });
      } catch {
        // Non-fatal: the reply is still shown as text.
      } finally {
        speechDoneRef.current = null;
        // Keep the last bands lit between sentences (no reset) to avoid a visualizer
        // blink; restoreAfterSpeech() does the final zeroing.
        stopOutputAnalysis(false);
        if (url) URL.revokeObjectURL(url);
        playerRef.current = null;
      }
    },
    [startOutputAnalysis, stopOutputAnalysis],
  );

  // Final teardown after a turn finishes speaking: zero the visualizer and restore
  // the prior listening mode (re-arm wake word, resume hands-free, or go idle).
  const restoreAfterSpeech = useCallback(() => {
    speechDoneRef.current = null;
    stopOutputAnalysis();
    playerRef.current = null;
    if (wakeModeRef.current) reArm();
    else if (handsFreeRef.current) startListening();
    else patch({ status: "idle" });
    // reArm/startListening defined below; ref-based recursion is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patch, stopOutputAnalysis]);

  // Speaks one full text as a single clip (autonomous narrations, Live Review).
  const speak = useCallback(
    async (text: string) => {
      streamCancelledRef.current = false;
      patch({ status: "speaking", outputLevel: 0, outputBands: silentOutputBands() });
      try {
        await playClip(text, () => streamCancelledRef.current);
      } finally {
        restoreAfterSpeech();
      }
    },
    [patch, playClip, restoreAfterSpeech],
  );

  // Autonomous-mode narration drain. Runs on a slow interval; speaks at most one pending
  // narration per pass, and ONLY when no user turn is in progress (idle or wake-armed) so it
  // never cuts off the operator. Reuses speak(), which restores the prior mode afterwards.
  const pollNarrations = useCallback(async () => {
    if (narrationBusyRef.current) return;
    const status = statusRef.current;
    if (status !== "idle" && status !== "armed") return;

    let narrations: Array<{ id?: unknown; text?: unknown; render?: unknown }> = [];
    try {
      const res = await fetch(`/api/ultron/narrations?session=${encodeURIComponent(getSessionId())}`);
      if (!res.ok) return;
      const data = (await res.json()) as { narrations?: unknown };
      if (Array.isArray(data.narrations)) narrations = data.narrations as typeof narrations;
    } catch {
      return; // transient; try again next tick
    }

    const next = narrations.find(
      (n) => n && typeof n.id === "string" && typeof n.text === "string" && !narrationSpokenIdsRef.current.has(n.id),
    );
    if (!next || typeof next.id !== "string" || typeof next.text !== "string") return;

    // Re-check after the await above: the operator may have started a turn (wake hit or
    // onset) while the fetch was in flight — speaking now would play TTS over their
    // recording and, via speak()'s finally, re-arm the VAD mid-utterance.
    const statusNow = statusRef.current;
    if (statusNow !== "idle" && statusNow !== "armed") return;

    // Mark spoken locally + server-side BEFORE speaking so a concurrent poll can't replay it.
    narrationSpokenIdsRef.current.add(next.id);
    void fetch(`/api/ultron/narrations/${next.id}`, { method: "PATCH" }).catch(() => {});

    narrationBusyRef.current = true;
    patch({ reply: next.text });
    // ARC (SPEC-019 Wave C.2): an autonomous narration may carry a render directive — materialize
    // the panel as the Ultron starts speaking. Invalid/absent render is dropped silently by
    // parseUIIntents and never breaks the narration.
    if (Array.isArray(next.render)) publishUiIntents(next.render);
    try {
      await speak(next.text);
    } finally {
      narrationBusyRef.current = false;
    }
  }, [patch, speak, publishUiIntents]);

  const publishAll = useCallback(
    (s: ChatStreamSignals | UltronApiResponse) => {
      publishAgentTriggers(s.agentTriggers);
      publishLandingEdits(s.landingEdits);
      publishLiveReviews(s.liveReviews);
      publishUiIntents(s.uiIntents);
    },
    [publishAgentTriggers, publishLandingEdits, publishLiveReviews, publishUiIntents],
  );

  // capture_screen pause handler (one-shot, unchanged semantics): grab a frame from
  // the shared screen and resume until the server returns a final reply. Used as a
  // fallback when the streaming turn yields need_capture (vision turns are rarer and
  // inherently slower, so they keep the simple request/response path).
  const runCaptureHops = useCallback(
    async (firstPendingId: string): Promise<string> => {
      let pendingId: string | undefined = firstPendingId;
      let hops = 0;
      while (pendingId && hops++ < MAX_CAPTURE_HOPS) {
        patch({ status: "capturing" });
        const frame = await captureFrame();
        if (!frame) return NO_SCREEN_MSG;
        patch({ status: "thinking" });
        const capRes = await fetch("/api/ultron/capture", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: getSessionId(), pendingId, image: frame }),
        });
        if (!capRes.ok) throw new Error("capture");
        const data = (await capRes.json()) as UltronApiResponse;
        publishAll(data);
        if (data.status === "need_capture" && data.pendingId) {
          pendingId = data.pendingId;
          continue;
        }
        return data.reply ?? CLIENT_FALLBACK;
      }
      return CLIENT_FALLBACK;
    },
    [captureFrame, patch, publishAll],
  );

  // Streams the turn: POST the transcript, read SSE text deltas, segment them into
  // sentences and speak each one the moment it completes (first audio starts on the
  // first sentence, not after the whole reply). The terminal frame carries the
  // structured signals; a need_capture frame falls back to runCaptureHops.
  const streamReply = useCallback(
    async (text: string, marks: TurnMarks): Promise<string> => {
      streamCancelledRef.current = false;
      const isCancelled = () => streamCancelledRef.current;
      const acc = new SentenceAccumulator();
      const parse = createChatEventParser();
      const queue = new AudioQueue();
      let replyText = "";
      let firstAudioLogged = false;

      // Playback worker: speak queued sentences in order.
      const consumer = (async () => {
        for await (const sentence of queue) {
          if (isCancelled()) break;
          if (!firstAudioLogged) {
            firstAudioLogged = true;
            marks.firstAudio = performance.now();
            patch({ status: "speaking", outputLevel: 0, outputBands: silentOutputBands() });
            logTurnTimings(marks);
          }
          await playClip(sentence, isCancelled);
        }
      })();

      const abort = new AbortController();
      chatAbortRef.current = abort;
      let pendingCapture: ChatStreamSignals | null = null;
      try {
        const chatRes = await fetch("/api/ultron/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: getSessionId(), text }),
          signal: abort.signal,
        });
        if (!chatRes.ok || !chatRes.body) throw new Error("chat");

        const reader = chatRes.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (isCancelled()) {
            await reader.cancel().catch(() => {});
            break;
          }
          for (const ev of parse(decoder.decode(value, { stream: true }))) {
            if (ev.type === "text") {
              if (!marks.firstToken) marks.firstToken = performance.now();
              replyText += ev.delta;
              for (const sentence of acc.push(ev.delta)) {
                if (!marks.firstSentence) marks.firstSentence = performance.now();
                queue.push(sentence);
              }
            } else if (ev.type === "need_capture") {
              pendingCapture = ev;
              publishAll(ev);
            } else if (ev.type === "done") {
              publishAll(ev);
              if (typeof ev.reply === "string" && ev.reply) replyText = ev.reply;
            } else if (ev.type === "error") {
              throw new Error("chat");
            }
          }
        }

        // Flush the trailing (unterminated) sentence from the streamed deltas.
        const tail = acc.flush();
        if (tail) {
          if (!marks.firstSentence) marks.firstSentence = performance.now();
          queue.push(tail);
        }

        // Vision turn: resume via the one-shot capture path, then speak its reply
        // through the same queue so playback stays gapless.
        if (pendingCapture?.pendingId) {
          const captureReply = await runCaptureHops(pendingCapture.pendingId);
          replyText = captureReply;
          const capAcc = new SentenceAccumulator();
          for (const sentence of capAcc.push(captureReply)) queue.push(sentence);
          const capTail = capAcc.flush();
          if (capTail) queue.push(capTail);
        }

        return replyText || CLIENT_FALLBACK;
      } finally {
        chatAbortRef.current = null;
        queue.close();
        await consumer.catch(() => {});
      }
    },
    [patch, playClip, publishAll, runCaptureHops],
  );

  const sendPipeline = useCallback(
    async (blob: Blob, speechEndAt: number) => {
      if (blob.size < 1200) {
        // Too short to be speech — go back to idle/listening.
        transcriberRef.current?.abort();
        transcriberRef.current = null;
        if (handsFreeRef.current) startListening();
        else patch({ status: "idle" });
        return;
      }
      const marks: TurnMarks = {
        speechEnd: speechEndAt,
        sttDone: 0,
        firstToken: 0,
        firstSentence: 0,
        firstAudio: 0,
      };
      let spoke = false;
      try {
        patch({ status: "transcribing" });
        // Prefer the realtime transcript (already streaming during speech); fall back to the
        // one-shot upload if streaming was off, failed, or returned nothing.
        let text = "";
        const rt = transcriberRef.current;
        transcriberRef.current = null;
        if (rt) {
          try {
            text = await rt.finish(1500);
          } catch {
            text = "";
          }
        }
        if (!text) {
          const fd = new FormData();
          fd.append("audio", blob, "audio.webm");
          const sttRes = await fetch("/api/ultron/stt", { method: "POST", body: fd });
          if (!sttRes.ok) throw new Error("stt");
          text = ((await sttRes.json()) as { text: string }).text;
        }
        if (!text) {
          if (handsFreeRef.current) startListening();
          else patch({ status: "idle" });
          return;
        }
        marks.sttDone = performance.now();
        patch({ status: "thinking", transcript: text });
        spoke = true;
        const reply = await streamReply(text, marks);
        patch({ reply });
      } catch {
        // A barge-in (stopSpeaking) aborts the fetch on purpose — that's not an error.
        if (!streamCancelledRef.current) patch({ status: "error", error: "Tive um problema. Tenta de novo." });
      } finally {
        // streamReply set status=speaking and played the clips; restore the mode once
        // the whole turn finished (including after a mid-speech error). The early
        // non-speaking exits above set listening/idle before `spoke` was flipped, so
        // they correctly skip this.
        if (spoke) restoreAfterSpeech();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [patch, streamReply, restoreAfterSpeech],
  );

  // Starts the MediaRecorder. `withVad` enables auto-stop (worklet event in
  // worklet mode, rAF loop in fallback). `armWorklet` arms the worklet here —
  // used by the wake-word path; the hands-free path arms in startListening and
  // begins recording only after the worklet's onset event.
  const beginRecording = useCallback(
    async (withVad: boolean, armWorklet = false) => {
      pendingStopRef.current = false; // a stale flag must not kill this fresh recording
      const stream = await ensureMic();
      chunksRef.current = [];
      speechSeenRef.current = false;
      silenceStartRef.current = null;
      clipStartRef.current = performance.now();
      const recorder = new MediaRecorder(stream, {
        mimeType: "audio/webm",
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      });
      recorderRef.current = recorder;
      // Realtime STT (flag-gated). If startListening prewarmed a transcriber (WS + audio graph
      // already live), just OPEN the PCM gate — no head-clip while the handshake runs. Otherwise
      // (wake/PTT paths) connect+capture now. Fire-and-forget; any failure nulls the ref so
      // sendPipeline falls back to the one-shot upload of the recorded blob.
      if (sttStreamingEnabled()) {
        const prewarmed = transcriberRef.current;
        if (prewarmed) {
          prewarmed.beginCapture();
        } else {
          const t = createRealtimeTranscriber();
          transcriberRef.current = t;
          t.start(stream).catch(() => {
            if (transcriberRef.current === t) transcriberRef.current = null;
            t.abort();
          });
        }
      } else {
        transcriberRef.current = null;
      }
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stopVadLoop();
        // Mark end-of-speech here (recorder stopped) for latency telemetry.
        const speechEndAt = performance.now();
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        void sendPipeline(blob, speechEndAt);
      };
      recorder.start();
      patch({ status: "recording", error: null });

      if (pendingStopRef.current) {
        // The endpoint fired during setup — close out now; sendPipeline drops tiny blobs
        // and restores the listening/idle state.
        pendingStopRef.current = false;
        recorder.stop();
        return;
      }

      if (vadModeRef.current === "worklet") {
        if (!withVad) vadMicRef.current?.disarm();
        else if (armWorklet) vadMicRef.current?.arm();
        // hands-free with !armWorklet: worklet already armed + in SPEAKING; it
        // will emit speech-end on its own.
      } else if (withVad) {
        monitorWhileRecording();
      }
    },
    [ensureMic, monitorWhileRecording, patch, sendPipeline, stopVadLoop],
  );

  // Hands-free: arm onset detection, then record once speech starts.
  const startListening = useCallback(() => {
    handsFreeRef.current = true;
    patch({ status: "listening", handsFree: true });
    void ensureMic().then((stream) => {
      if (!handsFreeRef.current) return;
      // Prewarm realtime STT during the listening window so the WS + audio graph are live
      // BEFORE speech — beginRecording then opens the PCM gate instantly (no head-clip). Gated:
      // nothing is sent to OpenAI until beginCapture(), so idle listening stays silent/clean.
      if (sttStreamingEnabled() && !transcriberRef.current) {
        const t = createRealtimeTranscriber();
        transcriberRef.current = t;
        t.connect(stream).catch(() => {
          if (transcriberRef.current === t) transcriberRef.current = null;
          t.abort();
        });
      }
      if (vadModeRef.current === "worklet") {
        listeningRef.current = true;
        vadMicRef.current?.arm();
        return;
      }
      // rAF fallback: poll for speech onset.
      const waitForSpeech = () => {
        if (!handsFreeRef.current) return;
        if (rms() > SPEECH_RMS) {
          void beginRecording(true);
          return;
        }
        rafRef.current = requestAnimationFrame(waitForSpeech);
      };
      rafRef.current = requestAnimationFrame(waitForSpeech);
    });
  }, [beginRecording, ensureMic, patch, rms]);

  // Reacts to worklet VAD events (worklet mode only).
  const handleVadEvent = useCallback(
    (event: VadEvent) => {
      if (event.type === "speech-start") {
        // Only the hands-free onset starts a recording; in wake/PTT modes the
        // recorder is already running, so we ignore (and let speech-end stop it).
        if (handsFreeRef.current && listeningRef.current) {
          listeningRef.current = false;
          void beginRecording(true);
        }
      } else {
        finalizeRecording();
      }
    },
    [beginRecording, finalizeRecording],
  );

  useEffect(() => {
    onVadEventRef.current = handleVadEvent;
  }, [handleVadEvent]);

  // Wake-word mode: re-arm the listener after each reply.
  const reArm = useCallback(() => {
    armedRef.current = true;
    patch({ status: "armed" });
    wakeRef.current?.start();
  }, [patch]);

  const handleWake = useCallback(() => {
    if (!armedRef.current) return; // ignore repeat hits within one detection burst
    armedRef.current = false;
    wakeRef.current?.stop(); // pause recognition while we handle the command + reply
    void beginRecording(true, true); // arm the worklet here for endpoint detection
  }, [beginRecording]);

  // --- public controls ---

  const startPushToTalk = useCallback(() => {
    handsFreeRef.current = false;
    listeningRef.current = false;
    void beginRecording(false);
  }, [beginRecording]);

  const stopPushToTalk = useCallback(() => {
    finalizeRecording();
  }, [finalizeRecording]);

  const toggleHandsFree = useCallback(() => {
    if (handsFreeRef.current) {
      handsFreeRef.current = false;
      listeningRef.current = false;
      stopVadLoop();
      vadMicRef.current?.disarm();
      // Drop any prewarmed (idle) realtime STT connection so the WS doesn't leak.
      transcriberRef.current?.abort();
      transcriberRef.current = null;
      finalizeRecording();
      patch({ status: "idle", handsFree: false });
    } else {
      // mutually exclusive with wake-word mode
      if (wakeModeRef.current) {
        wakeModeRef.current = false;
        armedRef.current = false;
        wakeRef.current?.stop();
        patch({ wakeActive: false });
      }
      startListening();
    }
  }, [finalizeRecording, patch, startListening, stopVadLoop]);

  const toggleWakeWord = useCallback(() => {
    if (wakeModeRef.current) {
      wakeModeRef.current = false;
      armedRef.current = false;
      wakeRef.current?.stop();
      patch({ status: "idle", wakeActive: false });
      return;
    }
    if (!wakeRef.current) {
      wakeRef.current = createWakeWord({
        word: WAKE_WORD,
        lang: "pt-BR",
        onWake: handleWake,
        onError: () => {},
      });
    }
    if (!wakeRef.current.isSupported) {
      patch({ status: "error", error: "Seu navegador não suporta wake word (use Chrome ou Edge)." });
      return;
    }
    // mutually exclusive with hands-free
    handsFreeRef.current = false;
    listeningRef.current = false;
    stopVadLoop();
    vadMicRef.current?.disarm();
    // Leaving hands-free: drop any prewarmed realtime STT connection (wake mode doesn't prewarm).
    transcriberRef.current?.abort();
    transcriberRef.current = null;
    wakeModeRef.current = true;
    patch({ wakeActive: true, handsFree: false, error: null });
    reArm();
  }, [handleWake, patch, reArm, stopVadLoop]);

  const stopSpeaking = useCallback(() => {
    // Tear down the whole streaming turn (queue worker + SSE reader + per-clip pump),
    // not just the current clip — otherwise the next queued sentence would play on.
    streamCancelledRef.current = true;
    chatAbortRef.current?.abort();
    transcriberRef.current?.abort();
    transcriberRef.current = null;
    if (playerRef.current) {
      playerRef.current.pause();
      playerRef.current.currentTime = 0;
      playerRef.current = null;
    }
    speechDoneRef.current?.();
  }, []);

  const toggleShare = useCallback(() => {
    if (sharing) stopShare();
    else void startShare();
  }, [sharing, startShare, stopShare]);

  const persistAutoReviewed = useCallback(() => {
    try {
      localStorage.setItem("ultron_autoreviewed_ids", JSON.stringify([...autoReviewedIdsRef.current]));
    } catch {
      // best-effort; dedup degrades to in-memory only
    }
  }, []);

  // Polls the auto-review candidate endpoint; on a fresh, never-seen ready page, opens the Live
  // Review. Gated by the toggle; the first poll after enabling only baselines (marks the current
  // page seen) so we never review a page that was already done before the operator opted in.
  const pollLiveReviewCandidate = useCallback(async () => {
    if (!autoReviewRef.current) return;
    let candidate: { landingPageId: string; previewUrl: string } | null = null;
    try {
      const res = await fetch("/api/ultron/live-review/candidate");
      if (!res.ok) return;
      const data = (await res.json()) as { candidate?: { landingPageId?: unknown; previewUrl?: unknown } | null };
      const c = data.candidate;
      if (c && typeof c.landingPageId === "string" && typeof c.previewUrl === "string") {
        candidate = { landingPageId: c.landingPageId, previewUrl: c.previewUrl };
      }
    } catch {
      return; // transient; try again next tick
    }

    const seeding = autoReviewSeedRef.current;
    if (seeding) autoReviewSeedRef.current = false;

    if (!candidate) return;
    const id = candidate.landingPageId;
    if (autoReviewedIdsRef.current.has(id)) return;
    autoReviewedIdsRef.current.add(id);
    persistAutoReviewed();
    if (seeding) return; // baseline only — don't review a page that was already ready

    publishLiveReviews([{ landingPageId: id, previewUrl: candidate.previewUrl, at: new Date().toISOString() }]);
  }, [persistAutoReviewed, publishLiveReviews]);

  const toggleAutoReview = useCallback(() => {
    setAutoReview((v) => {
      const next = !v;
      autoReviewRef.current = next;
      if (next) autoReviewSeedRef.current = true; // baseline on the next poll
      return next;
    });
  }, []);

  useEffect(() => {
    patch({ wakeSupported: isWakeWordSupported() });
  }, [patch]);

  // Keep statusRef in sync for the narration poller's gate (avoids re-creating the interval).
  // liveSignalRef.status mirrors it too so the 3D avatar can read status frame-by-frame.
  useEffect(() => {
    statusRef.current = state.status;
    liveSignalRef.current.status = state.status;
  }, [state.status]);

  // Poll for autonomous-mode narrations and speak them when idle. Low frequency: these are
  // status updates every couple of minutes, not a chat stream.
  useEffect(() => {
    const iv = window.setInterval(() => void pollNarrations(), 5000);
    return () => window.clearInterval(iv);
  }, [pollNarrations]);

  // Load the persisted set of already-auto-reviewed landing pages (dedup across reloads).
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ultron_autoreviewed_ids");
      if (raw) {
        const arr = JSON.parse(raw) as unknown;
        if (Array.isArray(arr)) autoReviewedIdsRef.current = new Set(arr.filter((x): x is string => typeof x === "string"));
      }
    } catch {
      // no persisted state; start empty
    }
  }, []);

  // Poll for an auto-review candidate (a freshly-created ready landing page) when the toggle is on.
  useEffect(() => {
    const iv = window.setInterval(() => void pollLiveReviewCandidate(), 6000);
    return () => window.clearInterval(iv);
  }, [pollLiveReviewCandidate]);

  // Resume the VAD audio context when the tab becomes visible again — contexts
  // can get suspended after a long time backgrounded on some platforms.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void vadMicRef.current?.resume();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    return () => {
      stopVadLoop();
      wakeRef.current?.stop();
      transcriberRef.current?.abort();
      transcriberRef.current = null;
      recorderRef.current?.state !== "inactive" && recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      void vadMicRef.current?.close();
      if (playerRef.current) {
        playerRef.current.pause();
        playerRef.current = null;
      }
      speechDoneRef.current?.();
      stopOutputAnalysis(false);
      void audioCtxRef.current?.close();
    };
  }, [stopOutputAnalysis, stopVadLoop]);

  return {
    state,
    // Imperative, per-frame signal for the 3D avatar lip-sync (no React re-render).
    liveSignalRef,
    startPushToTalk,
    stopPushToTalk,
    toggleHandsFree,
    toggleWakeWord,
    stopSpeaking,
    sharing,
    toggleShare,
    // Primitives the Live Review overlay (SPEC-014) reuses to drive its own loop without
    // a second screen-share prompt or a duplicate TTS path.
    startShare,
    captureFrame,
    speak,
    // Auto-review on completion (SPEC-014 v1).
    autoReview,
    toggleAutoReview,
  };
}
