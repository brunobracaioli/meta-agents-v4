// Browser-side realtime STT over the OpenAI Realtime API (ADR 0032). Streams mic PCM live
// while the operator speaks so the transcript is ~ready at end-of-speech, instead of the
// post-speech one-shot upload (which cost ~1s+). Gated by a feature flag and ALWAYS paired
// with the one-shot fallback in use-ultron-voice — if anything here fails, the caller still
// has the recorded blob to transcribe the old way.
//
// Confirmed against the real API (HTTP 200): GA schema, ephemeral token from
// /api/ultron/stt-token, connect wss://api.openai.com/v1/realtime with subprotocol
// "openai-insecure-api-key.<token>" (NO beta marker), append via input_audio_buffer.append
// {audio: base64 pcm16 @24kHz}, server_vad finalizes → conversation.item.input_audio_transcription.completed.
//
// Telemetry is PII-free: we log event TYPES and counts, never the transcript text.

const REALTIME_URL = "wss://api.openai.com/v1/realtime";
const PCM_WORKLET_URL = "/ultron/pcm-capture-processor.js";
const SAMPLE_RATE = 24000;
const SEND_INTERVAL_MS = 120; // batch mic PCM into ~120ms appends (decouples worklet rate from WS sends)
const SESSION_READY_TIMEOUT_MS = 4000;

type Phase = "idle" | "connecting" | "streaming" | "finishing" | "closed";

function logEvent(event: string, extra?: Record<string, unknown>): void {
  // No PII: types/counts/durations only.
  console.info(JSON.stringify({ level: "info", event, ...extra }));
}

/**
 * Per-browser opt-in for the streaming path — NOT a build-time flag, so it toggles with
 * NO redeploy: the operator enables it by visiting `?stt=stream` once or setting
 * localStorage `ultron_stt_streaming=1`, and disabling reverts to the one-shot instantly.
 * Default OFF, so merging to main is safe for everyone.
 */
export function sttStreamingEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("stt") === "stream") {
      window.localStorage.setItem("ultron_stt_streaming", "1");
    }
    return window.localStorage.getItem("ultron_stt_streaming") === "1";
  } catch {
    return false;
  }
}

export type RealtimeTranscriber = {
  /** Connects (token + WS + session.created) and starts capturing mic PCM from `stream`. */
  start: (stream: MediaStream) => Promise<void>;
  /** Stops capture and resolves the final transcript (best-effort within `timeoutMs`). */
  finish: (timeoutMs?: number) => Promise<string>;
  /** Tears everything down (barge-in / error / cleanup). Idempotent. */
  abort: () => void;
};

export function createRealtimeTranscriber(): RealtimeTranscriber {
  let phase: Phase = "idle";
  let ws: WebSocket | null = null;
  let audioCtx: AudioContext | null = null;
  let sourceNode: MediaStreamAudioSourceNode | null = null;
  let captureNode: AudioWorkletNode | null = null;
  let sinkNode: GainNode | null = null;
  let sendTimer: ReturnType<typeof setInterval> | null = null;

  const pending: Int16Array[] = []; // captured PCM awaiting the next batched send
  let deltaText = "";
  let finalText: string | null = null;
  let completedResolve: (() => void) | null = null;
  let eventCount = 0;

  const teardown = (): void => {
    if (phase === "closed") return;
    phase = "closed";
    if (sendTimer) clearInterval(sendTimer);
    sendTimer = null;
    try {
      captureNode?.port.close();
      captureNode?.disconnect();
      sourceNode?.disconnect();
      sinkNode?.disconnect();
    } catch {
      /* nodes may already be gone */
    }
    void audioCtx?.close().catch(() => {});
    audioCtx = null;
    sourceNode = captureNode = null;
    sinkNode = null;
    try {
      ws?.close();
    } catch {
      /* already closing */
    }
    ws = null;
    completedResolve?.();
    completedResolve = null;
  };

  const flush = (): void => {
    if (!ws || ws.readyState !== WebSocket.OPEN || pending.length === 0) return;
    let total = 0;
    for (const c of pending) total += c.length;
    const merged = new Int16Array(total);
    let off = 0;
    for (const c of pending) {
      merged.set(c, off);
      off += c.length;
    }
    pending.length = 0;
    // Int16Array → bytes → base64 (btoa over a binary string, chunked to avoid arg limits).
    const bytes = new Uint8Array(merged.buffer);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
    }
    ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: btoa(bin) }));
  };

  const onMessage = (raw: string): void => {
    let msg: { type?: string; delta?: string; transcript?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const t = msg.type ?? "";
    eventCount++;
    // Log only the type (and count), never the transcribed content.
    if (t === "error" || t.startsWith("input_audio_buffer.") || t.includes("input_audio_transcription")) {
      logEvent("rt_stt_event", { rt_type: t });
    }
    if (t.endsWith("input_audio_transcription.delta") && typeof msg.delta === "string") {
      deltaText += msg.delta;
    } else if (t.endsWith("input_audio_transcription.completed")) {
      finalText = (msg.transcript ?? deltaText ?? "").trim();
      completedResolve?.();
      completedResolve = null;
    }
  };

  const start = async (stream: MediaStream): Promise<void> => {
    phase = "connecting";
    const res = await fetch("/api/ultron/stt-token", { method: "POST" });
    if (!res.ok) throw new Error(`stt-token ${res.status}`);
    const { value } = (await res.json()) as { value: string };
    if (!value) throw new Error("stt-token empty");

    ws = new WebSocket(REALTIME_URL, ["realtime", `openai-insecure-api-key.${value}`]);
    ws.addEventListener("message", (e) => onMessage(typeof e.data === "string" ? e.data : ""));
    ws.addEventListener("error", () => logEvent("rt_stt_event", { rt_type: "ws_error" }));

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("session_timeout")), SESSION_READY_TIMEOUT_MS);
      const onMsg = (e: MessageEvent) => {
        let type = "";
        try {
          type = JSON.parse(typeof e.data === "string" ? e.data : "{}").type ?? "";
        } catch {
          /* ignore */
        }
        if (type === "session.created") {
          clearTimeout(timer);
          ws?.removeEventListener("message", onMsg);
          resolve();
        }
      };
      ws?.addEventListener("message", onMsg);
      ws?.addEventListener("close", () => {
        clearTimeout(timer);
        reject(new Error("ws_closed"));
      });
    });

    // Capture mic PCM at 24kHz (the context resamples the mic for us — no manual resample).
    audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
    if (audioCtx.state === "suspended") await audioCtx.resume().catch(() => {});
    await audioCtx.audioWorklet.addModule(PCM_WORKLET_URL);
    sourceNode = audioCtx.createMediaStreamSource(stream);
    captureNode = new AudioWorkletNode(audioCtx, "ultron-pcm-capture");
    captureNode.port.onmessage = (e: MessageEvent<Int16Array>) => {
      if (phase === "streaming" || phase === "finishing") pending.push(e.data);
    };
    // A muted sink keeps the worklet's process() pulled even though we discard its output.
    sinkNode = audioCtx.createGain();
    sinkNode.gain.value = 0;
    sourceNode.connect(captureNode);
    captureNode.connect(sinkNode);
    sinkNode.connect(audioCtx.destination);

    phase = "streaming";
    sendTimer = setInterval(flush, SEND_INTERVAL_MS);
    logEvent("rt_stt_started");
  };

  const finish = async (timeoutMs = 1500): Promise<string> => {
    if (phase !== "streaming") {
      const t = (finalText ?? "").trim();
      teardown();
      return t;
    }
    phase = "finishing";
    flush(); // ship whatever PCM is buffered
    if (finalText == null) {
      await new Promise<void>((resolve) => {
        completedResolve = resolve;
        setTimeout(resolve, timeoutMs);
      });
    }
    const text = (finalText ?? "").trim();
    logEvent("rt_stt_finish", { got_final: finalText != null, events: eventCount, chars: text.length });
    teardown();
    return text;
  };

  return { start, finish, abort: teardown };
}
