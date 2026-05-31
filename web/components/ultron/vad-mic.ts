"use client";

// Web Audio glue for the VAD AudioWorklet (public/ultron/vad-processor.js).
//
// The worklet runs the voice-activity detection on the audio render thread, which
// the browser does not throttle for backgrounded tabs — so hands-free listening
// keeps working when the operator switches windows/tabs. This module owns the
// AudioContext + graph + module loading; the React hook only reacts to events.

export type VadEvent = { type: "speech-start" } | { type: "speech-end"; reason: "silence" | "maxclip" };

export type VadConfig = {
  speechRms: number;
  silenceRms: number;
  silenceMs: number;
  maxClipMs: number;
};

export type VadMicHandle = {
  arm: () => void;
  disarm: () => void;
  resume: () => Promise<void>;
  close: () => Promise<void>;
};

const WORKLET_URL = "/ultron/vad-processor.js";
const PROCESSOR_NAME = "ultron-vad";

export function isVadWorkletSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.AudioWorkletNode !== "undefined" &&
    typeof AudioContext !== "undefined"
  );
}

// Loads the worklet module. Primary path is a same-origin URL (allowed by CSP
// `worker-src 'self'`); if that's blocked/fails, fall back to fetching the source
// and loading it as a Blob URL (allowed by `worker-src blob:`).
async function loadModule(ctx: AudioContext): Promise<void> {
  try {
    await ctx.audioWorklet.addModule(WORKLET_URL);
    return;
  } catch {
    const res = await fetch(WORKLET_URL);
    if (!res.ok) throw new Error(`vad worklet fetch failed: ${res.status}`);
    const code = await res.text();
    const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export async function createVadMic(opts: {
  stream: MediaStream;
  onEvent: (event: VadEvent) => void;
  config: VadConfig;
}): Promise<VadMicHandle> {
  const ctx = new AudioContext();
  await loadModule(ctx);

  const source = ctx.createMediaStreamSource(opts.stream);
  const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, { processorOptions: opts.config });
  // Muted sink: guarantees the worklet node has a path to the destination so its
  // process() is pumped even with the tab backgrounded, without emitting audio.
  const sink = ctx.createGain();
  sink.gain.value = 0;

  source.connect(node);
  node.connect(sink);
  sink.connect(ctx.destination);

  node.port.onmessage = (event: MessageEvent) => {
    const data = event.data as VadEvent | undefined;
    if (data && (data.type === "speech-start" || data.type === "speech-end")) opts.onEvent(data);
  };

  return {
    arm: () => node.port.postMessage({ type: "arm" }),
    disarm: () => node.port.postMessage({ type: "disarm" }),
    resume: async () => {
      if (ctx.state === "suspended") await ctx.resume();
    },
    close: async () => {
      try {
        node.port.onmessage = null;
        node.disconnect();
        source.disconnect();
        sink.disconnect();
      } catch {
        // nodes may already be detached
      }
      try {
        await ctx.close();
      } catch {
        // context may already be closed
      }
    },
  };
}
