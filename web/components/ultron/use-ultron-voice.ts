"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
const SILENCE_MS = 900; // stop after this much trailing silence
const SPEECH_RMS = 0.025; // onset threshold
const SILENCE_RMS = 0.015; // below this counts as silence
const MAX_CLIP_MS = 12_000; // hard cap per utterance
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

function silentOutputBands(): number[] {
  return Array.from({ length: OUTPUT_BAND_COUNT }, () => 0);
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
  const speechSeenRef = useRef<boolean>(false);
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const speechDoneRef = useRef<(() => void) | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const outputSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputRafRef = useRef<number | null>(null);
  const outputLastFrameRef = useRef<number>(0);
  const handsFreeRef = useRef<boolean>(false);
  const wakeRef = useRef<WakeController | null>(null);
  const wakeModeRef = useRef<boolean>(false);
  const armedRef = useRef<boolean>(false);

  // VAD-via-worklet state. `vadMode` is decided once on first mic setup.
  const vadMicRef = useRef<VadMicHandle | null>(null);
  const vadModeRef = useRef<"worklet" | "raf">("raf");
  const vadReadyRef = useRef<Promise<void> | null>(null);
  const listeningRef = useRef<boolean>(false); // hands-free: armed for onset, not yet recording
  const onVadEventRef = useRef<(event: VadEvent) => void>(() => {});

  const patch = useCallback((p: Partial<UltronState>) => setState((s) => ({ ...s, ...p })), []);

  const { sharing, start: startShare, stop: stopShare, captureFrame } = useScreenShare();

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
    if (resetState) patch({ outputLevel: 0, outputBands: silentOutputBands() });
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
    if (recorder && recorder.state !== "inactive") recorder.stop();
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

  const speak = useCallback(
    async (text: string) => {
      patch({ status: "speaking", outputLevel: 0, outputBands: silentOutputBands() });
      let url: string | null = null;
      try {
        const res = await fetch("/api/ultron/tts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error("tts");
        const blob = await res.blob();
        url = URL.createObjectURL(blob);
        const audio = new Audio(url);
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
          const ctx = startOutputAnalysis(audio);
          void ctx
            .resume()
            .then(() => audio.play())
            .catch(() => settle());
        });
      } catch {
        // Non-fatal: the reply is still shown as text.
      } finally {
        speechDoneRef.current = null;
        stopOutputAnalysis();
        if (url) URL.revokeObjectURL(url);
        playerRef.current = null;
        if (wakeModeRef.current) reArm();
        else if (handsFreeRef.current) startListening();
        else patch({ status: "idle" });
      }
    },
    // reArm/startListening defined below; ref-based recursion is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [patch],
  );

  // Sends the transcript to Ultron and resolves any capture_screen pauses: when the
  // server replies need_capture, grab a frame from the shared screen and resume.
  const resolveReply = useCallback(
    async (text: string): Promise<string> => {
      const chatRes = await fetch("/api/ultron/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: getSessionId(), text }),
      });
      if (!chatRes.ok) throw new Error("chat");
      let data = (await chatRes.json()) as { reply?: string; status?: string; pendingId?: string };

      let hops = 0;
      while (data.status === "need_capture" && data.pendingId && hops++ < MAX_CAPTURE_HOPS) {
        patch({ status: "capturing" });
        const frame = await captureFrame();
        if (!frame) return NO_SCREEN_MSG;
        patch({ status: "thinking" });
        const capRes = await fetch("/api/ultron/capture", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: getSessionId(), pendingId: data.pendingId, image: frame }),
        });
        if (!capRes.ok) throw new Error("capture");
        data = (await capRes.json()) as { reply?: string; status?: string; pendingId?: string };
      }
      return data.reply ?? CLIENT_FALLBACK;
    },
    [captureFrame, patch],
  );

  const sendPipeline = useCallback(
    async (blob: Blob) => {
      if (blob.size < 1200) {
        // Too short to be speech — go back to idle/listening.
        if (handsFreeRef.current) startListening();
        else patch({ status: "idle" });
        return;
      }
      try {
        patch({ status: "transcribing" });
        const fd = new FormData();
        fd.append("audio", blob, "audio.webm");
        const sttRes = await fetch("/api/ultron/stt", { method: "POST", body: fd });
        if (!sttRes.ok) throw new Error("stt");
        const { text } = (await sttRes.json()) as { text: string };
        if (!text) {
          if (handsFreeRef.current) startListening();
          else patch({ status: "idle" });
          return;
        }
        patch({ status: "thinking", transcript: text });
        const reply = await resolveReply(text);
        patch({ reply });
        await speak(reply);
      } catch {
        patch({ status: "error", error: "Tive um problema. Tenta de novo." });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [patch, speak, resolveReply],
  );

  // Starts the MediaRecorder. `withVad` enables auto-stop (worklet event in
  // worklet mode, rAF loop in fallback). `armWorklet` arms the worklet here —
  // used by the wake-word path; the hands-free path arms in startListening and
  // begins recording only after the worklet's onset event.
  const beginRecording = useCallback(
    async (withVad: boolean, armWorklet = false) => {
      const stream = await ensureMic();
      chunksRef.current = [];
      speechSeenRef.current = false;
      silenceStartRef.current = null;
      clipStartRef.current = performance.now();
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stopVadLoop();
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        void sendPipeline(blob);
      };
      recorder.start();
      patch({ status: "recording", error: null });

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
    void ensureMic().then(() => {
      if (!handsFreeRef.current) return;
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
    wakeModeRef.current = true;
    patch({ wakeActive: true, handsFree: false, error: null });
    reArm();
  }, [handleWake, patch, reArm, stopVadLoop]);

  const stopSpeaking = useCallback(() => {
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

  useEffect(() => {
    patch({ wakeSupported: isWakeWordSupported() });
  }, [patch]);

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
    startPushToTalk,
    stopPushToTalk,
    toggleHandsFree,
    toggleWakeWord,
    stopSpeaking,
    sharing,
    toggleShare,
  };
}
