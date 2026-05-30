"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSessionId } from "@/lib/ultron/session";

export type UltronStatus =
  | "idle"
  | "listening" // hands-free: waiting for speech onset
  | "recording"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "error";

export type UltronState = {
  status: UltronStatus;
  handsFree: boolean;
  transcript: string | null;
  reply: string | null;
  error: string | null;
};

// Energy-based VAD tuning (no external deps). Works on the mic AnalyserNode RMS.
const SILENCE_MS = 900; // stop after this much trailing silence
const SPEECH_RMS = 0.025; // onset threshold
const SILENCE_RMS = 0.015; // below this counts as silence
const MAX_CLIP_MS = 12_000; // hard cap per utterance

export function useUltronVoice() {
  const [state, setState] = useState<UltronState>({
    status: "idle",
    handsFree: false,
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
  const handsFreeRef = useRef<boolean>(false);

  const patch = useCallback((p: Partial<UltronState>) => setState((s) => ({ ...s, ...p })), []);

  const ensureMic = useCallback(async (): Promise<MediaStream> => {
    if (streamRef.current) return streamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
    return stream;
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

  const finalizeRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  // VAD loop while recording: stop on trailing silence or max-clip timeout.
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
      patch({ status: "speaking" });
      try {
        const res = await fetch("/api/ultron/tts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error("tts");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        playerRef.current = audio;
        await new Promise<void>((resolve) => {
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          void audio.play().catch(() => resolve());
        });
        URL.revokeObjectURL(url);
      } catch {
        // Non-fatal: the reply is still shown as text.
      } finally {
        playerRef.current = null;
        if (handsFreeRef.current) startListening();
        else patch({ status: "idle" });
      }
    },
    // startListening defined below; ref-based recursion is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [patch],
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

        const chatRes = await fetch("/api/ultron/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: getSessionId(), text }),
        });
        if (!chatRes.ok) throw new Error("chat");
        const { reply } = (await chatRes.json()) as { reply: string };
        patch({ reply });
        await speak(reply);
      } catch {
        patch({ status: "error", error: "Tive um problema. Tenta de novo." });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [patch, speak],
  );

  const beginRecording = useCallback(
    async (withVad: boolean) => {
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
      if (withVad) monitorWhileRecording();
    },
    [ensureMic, monitorWhileRecording, patch, sendPipeline, stopVadLoop],
  );

  // Hands-free: listen for speech onset, then record with VAD auto-stop.
  const startListening = useCallback(() => {
    handsFreeRef.current = true;
    patch({ status: "listening", handsFree: true });
    void ensureMic().then(() => {
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

  // --- public controls ---

  const startPushToTalk = useCallback(() => {
    handsFreeRef.current = false;
    void beginRecording(false);
  }, [beginRecording]);

  const stopPushToTalk = useCallback(() => {
    finalizeRecording();
  }, [finalizeRecording]);

  const toggleHandsFree = useCallback(() => {
    if (handsFreeRef.current) {
      handsFreeRef.current = false;
      stopVadLoop();
      finalizeRecording();
      patch({ status: "idle", handsFree: false });
    } else {
      startListening();
    }
  }, [finalizeRecording, patch, startListening, stopVadLoop]);

  const stopSpeaking = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.pause();
      playerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopVadLoop();
      recorderRef.current?.state !== "inactive" && recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      void audioCtxRef.current?.close();
    };
  }, [stopVadLoop]);

  return { state, startPushToTalk, stopPushToTalk, toggleHandsFree, stopSpeaking };
}
