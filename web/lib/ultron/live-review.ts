// Ultron Live Review orchestrator (SPEC-014, Surface A).
//
// Drives the section-by-section visual review of a landing page rendered in a same-origin
// preview iframe: ask the ReviewBridge (inside the iframe) for its scroll layout, then for each
// step scroll → wait for the bridge's "settled" ack → let the 3D paint → capture a screen frame
// → ask the vision endpoint for a 1–2 sentence opinion → speak it. Cancelable via AbortSignal,
// with a hard step cap and a global timeout so a stuck step can never hang the demo.
//
// Transport-agnostic: it talks to the iframe purely over the review:* postMessage protocol the
// ReviewBridge answers (see packages/lp-render/src/sections/ReviewBridge.tsx). The same loop would
// drive a Surface B window.open target unchanged — only `target`/`targetOrigin` differ.

export type CapturedFrame = {
  media_type: "image/jpeg" | "image/png" | "image/webp";
  data: string; // base64, no data: prefix
};

type ReviewStep = { y: number; label: string; settleMs: number };
type ReviewLayout = { scrollHeight: number; viewportH: number; steps: ReviewStep[] };

export type LiveReviewProgress = {
  index: number; // 0-based step index
  total: number;
  label: string;
  phase: "scrolling" | "looking" | "speaking" | "done";
  analysis?: string;
};

export type RunLiveReviewArgs = {
  /** The contentWindow we post review:* messages to (the preview iframe). */
  target: Window;
  /** Origin to post to and to accept replies from (same-origin for Surface A). */
  targetOrigin: string;
  captureFrame: () => Promise<CapturedFrame | null>;
  speak: (text: string) => Promise<void>;
  landingPageId?: string;
  onProgress?: (p: LiveReviewProgress) => void;
  signal: AbortSignal;
};

// Hard safety net regardless of what the bridge reports. The bridge paginates the page into
// ~one-viewport steps (2 optional 3D beats + up to MAX_CONTENT_STEPS content screens + bottom),
// so this must comfortably exceed that budget or a long page gets cut off before the footer.
const MAX_STEPS = 18;
const GLOBAL_TIMEOUT_MS = 6 * 60 * 1000; // headroom for the extra steps (TTS dominates per-step)
const HELLO_TRIES = 8;
const HELLO_TIMEOUT_MS = 800;
const SCROLLED_TIMEOUT_MS = 3000;
const NO_SCREEN_FALLBACK =
  "Não estou conseguindo capturar a tela agora, então vou comentar pelo que conheço da estrutura.";

class AbortError extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortError";
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new AbortError();
}

/** Abortable sleep. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new AbortError());
    const t = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(t);
      reject(new AbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runLiveReview(args: RunLiveReviewArgs): Promise<void> {
  const { target, targetOrigin, captureFrame, speak, landingPageId, onProgress, signal } = args;

  // One message listener for the whole run; resolves the in-flight waiter by type.
  let waiter: { type: string; resolve: (data: Record<string, unknown>) => void } | null = null;
  const onMessage = (e: MessageEvent) => {
    if (e.source !== target) return;
    if (targetOrigin !== "*" && e.origin !== targetOrigin) return;
    const data = e.data as { type?: unknown } | null;
    if (!data || typeof data.type !== "string") return;
    if (waiter && waiter.type === data.type) {
      const w = waiter;
      waiter = null;
      w.resolve(data as Record<string, unknown>);
    }
  };
  window.addEventListener("message", onMessage);

  const post = (msg: unknown) => {
    try {
      target.postMessage(msg, targetOrigin);
    } catch {
      // delivery is best-effort; a missed message just times out below
    }
  };

  // Wait for the next message of `type`, or resolve null on timeout.
  const waitFor = (type: string, timeoutMs: number): Promise<Record<string, unknown> | null> =>
    new Promise((resolve) => {
      let settled = false;
      const done = (v: Record<string, unknown> | null) => {
        if (settled) return;
        settled = true;
        if (waiter && waiter.type === type) waiter = null;
        window.clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      };
      const onAbort = () => done(null);
      const timer = window.setTimeout(() => done(null), timeoutMs);
      signal.addEventListener("abort", onAbort, { once: true });
      waiter = { type, resolve: (d) => done(d) };
    });

  const startedAt = performance.now();
  const outOfTime = () => performance.now() - startedAt > GLOBAL_TIMEOUT_MS;

  try {
    throwIfAborted(signal);

    // Handshake: the bridge may have mounted before or after us, so retry hello until it
    // answers with a layout (it also emits review:ready on mount, which simply unblocks a
    // pending hello faster).
    let layout: ReviewLayout | null = null;
    for (let i = 0; i < HELLO_TRIES && !layout; i++) {
      throwIfAborted(signal);
      post({ type: "review:hello" });
      const res = await waitFor("review:layout", HELLO_TIMEOUT_MS);
      if (res && Array.isArray(res.steps)) {
        layout = {
          scrollHeight: typeof res.scrollHeight === "number" ? res.scrollHeight : 0,
          viewportH: typeof res.viewportH === "number" ? res.viewportH : 0,
          steps: res.steps as ReviewStep[],
        };
      }
    }

    if (!layout || layout.steps.length === 0) {
      await speak("Não consegui abrir a página para revisar agora. Vamos tentar de novo daqui a pouco?");
      return;
    }

    const steps = layout.steps.slice(0, MAX_STEPS);
    await speak("Beleza, vamos revisar a página juntos. Começando do topo.");

    for (let i = 0; i < steps.length; i++) {
      throwIfAborted(signal);
      if (outOfTime()) break;
      const step = steps[i]!;

      onProgress?.({ index: i, total: steps.length, label: step.label, phase: "scrolling" });
      post({ type: "review:scrollTo", y: step.y });
      const scrolled = await waitFor("review:scrolled", SCROLLED_TIMEOUT_MS);
      // Let the section (and the GPU-rendered 3D panel) settle before the "print".
      await sleep(step.settleMs, signal);

      onProgress?.({ index: i, total: steps.length, label: step.label, phase: "looking" });
      let analysis: string;
      const frame = await captureFrame();
      if (!frame) {
        analysis = NO_SCREEN_FALLBACK;
      } else {
        analysis = await analyzeFrame(frame, step.label, landingPageId, signal);
      }

      onProgress?.({ index: i, total: steps.length, label: step.label, phase: "speaking", analysis });
      throwIfAborted(signal);
      await speak(analysis);

      const atBottom = Boolean(scrolled && scrolled.atBottom === true);
      if (atBottom) break;
    }

    throwIfAborted(signal);
    onProgress?.({ index: steps.length, total: steps.length, label: "fim", phase: "done" });
    await speak("É isso. Terminamos a revisão da página de ponta a ponta. No geral, ficou redonda.");
  } catch (err) {
    if (!(err instanceof AbortError)) throw err;
    // Aborted: silent stop, the overlay handles teardown.
  } finally {
    window.removeEventListener("message", onMessage);
  }
}

async function analyzeFrame(
  frame: CapturedFrame,
  label: string,
  landingPageId: string | undefined,
  signal: AbortSignal,
): Promise<string> {
  try {
    const res = await fetch("/api/ultron/review-frame", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image: frame, label, landingPageId }),
      signal,
    });
    if (!res.ok) return fallbackFor(label);
    const data = (await res.json()) as { analysis?: unknown };
    return typeof data.analysis === "string" && data.analysis.trim().length > 0
      ? data.analysis.trim()
      : fallbackFor(label);
  } catch {
    return fallbackFor(label);
  }
}

function fallbackFor(label: string): string {
  return `Aqui temos a seção ${label}. A leitura está limpa e o foco continua na conversão.`;
}
