"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LIVE_REVIEW_CHANNEL,
  LIVE_REVIEW_EVENT,
  isLiveReviewSignal,
  type LiveReviewSignal,
} from "@/lib/ultron/agent-trigger";
import { runLiveReview, type CapturedFrame, type LiveReviewProgress } from "@/lib/ultron/live-review";

// Surface A of the Ultron Live Review (SPEC-014): a fullscreen overlay that embeds the same-origin
// landing-page preview (?review=1 → ReviewBridge active) and runs the scroll→capture→vision→voice
// loop driven by runLiveReview. Listens for LiveReviewSignal (same-tab CustomEvent + cross-tab
// BroadcastChannel) emitted when Ultron's request_live_review tool fires.
//
// Gesture requirements: getDisplayMedia (screen capture) and the Fullscreen API both need a user
// gesture, but the trigger arrives from a voice command. So we surface a single "Iniciar" button —
// one click satisfies both, which is also natural for a recording ("click to begin"). If the
// operator already shared the screen, the button still drives fullscreen + starts the loop.

type Props = {
  /** Ensure the persistent screen-capture stream exists (prompts if needed). Returns granted. */
  startShare: () => Promise<boolean>;
  sharing: boolean;
  captureFrame: () => Promise<CapturedFrame | null>;
  speak: (text: string) => Promise<void>;
};

type Phase = "prompt" | "running" | "done";

export function LiveReviewStage({ startShare, sharing, captureFrame, speak }: Props) {
  const [active, setActive] = useState<LiveReviewSignal | null>(null);
  const [phase, setPhase] = useState<Phase>("prompt");
  const [progress, setProgress] = useState<LiveReviewProgress | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Subscribe to the live-review signal (same-tab + cross-tab). Ignore re-triggers while one runs.
  useEffect(() => {
    const onSignal = (value: unknown) => {
      if (!isLiveReviewSignal(value)) return;
      setActive((current) => {
        if (current) return current; // a review is already open
        setPhase("prompt");
        setProgress(null);
        return value;
      });
    };
    const onLocal = (e: Event) => onSignal((e as CustomEvent<unknown>).detail);
    window.addEventListener(LIVE_REVIEW_EVENT, onLocal);

    let channel: BroadcastChannel | null = null;
    if ("BroadcastChannel" in window) {
      channel = new BroadcastChannel(LIVE_REVIEW_CHANNEL);
      channel.onmessage = (e: MessageEvent<unknown>) => onSignal(e.data);
    }
    return () => {
      window.removeEventListener(LIVE_REVIEW_EVENT, onLocal);
      channel?.close();
    };
  }, []);

  const teardown = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (typeof document !== "undefined" && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
    setActive(null);
    setPhase("prompt");
    setProgress(null);
  }, []);

  // Esc cancels the review.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") teardown();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, teardown]);

  const begin = useCallback(async () => {
    if (!active) return;
    // Best-effort true fullscreen (hides browser chrome); degrades to the fixed overlay if denied.
    if (containerRef.current && !document.fullscreenElement) {
      await containerRef.current.requestFullscreen().catch(() => {});
    }
    if (!sharing) {
      await startShare().catch(() => false);
    }
    const target = iframeRef.current?.contentWindow;
    if (!target) {
      teardown();
      return;
    }
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase("running");
    try {
      await runLiveReview({
        target,
        targetOrigin: window.location.origin,
        captureFrame,
        speak,
        landingPageId: active.landingPageId,
        onProgress: setProgress,
        signal: ac.signal,
      });
      if (!ac.signal.aborted) setPhase("done");
    } catch {
      if (!ac.signal.aborted) setPhase("done");
    }
  }, [active, sharing, startShare, captureFrame, speak, teardown]);

  if (!active) return null;

  const caption =
    progress?.phase === "speaking" || progress?.phase === "done"
      ? progress.analysis ?? "Revisão concluída."
      : progress?.phase === "looking"
        ? "Analisando esta seção…"
        : progress?.phase === "scrolling"
          ? "Rolando para a próxima seção…"
          : "Pronto para começar.";

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] flex flex-col bg-black"
      role="dialog"
      aria-label="Revisão ao vivo da landing page"
    >
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 border-b border-cyan-300/15 bg-[#06101a]/90 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-cyan-100">
          <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-300 shadow-[0_0_14px_rgba(103,232,249,0.9)]" />
          Ultron — Revisão ao vivo
          {progress && phase === "running" ? (
            <span className="ml-2 text-white/45">
              {Math.min(progress.index + 1, progress.total)}/{progress.total} · {progress.label}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={teardown}
          className="grid h-7 w-7 place-items-center rounded border border-white/10 bg-white/[0.03] font-mono text-xs text-white/60 transition hover:border-red-300/45 hover:bg-red-500/10 hover:text-red-100"
          aria-label="Encerrar revisão"
          title="Encerrar (Esc)"
        >
          ×
        </button>
      </div>

      {/* Preview surface */}
      <div className="relative flex-1 overflow-hidden bg-black">
        <iframe
          ref={iframeRef}
          src={active.previewUrl}
          title="Revisão da landing page"
          className="h-full w-full border-0 bg-white"
        />

        {phase === "prompt" && (
          <div className="absolute inset-0 grid place-items-center bg-black/70 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-4 px-6 text-center">
              <p className="max-w-md text-sm leading-relaxed text-white/70">
                Vou abrir a página em tela cheia e revisar com você, seção por seção, comentando por
                voz. Clique para começar — vou pedir o compartilhamento de tela se ainda não estiver
                ativo.
              </p>
              <button
                type="button"
                onClick={() => void begin()}
                className="rounded-md border border-cyan-200/40 bg-cyan-300 px-5 py-2.5 text-sm font-semibold text-black shadow-[0_0_24px_rgba(103,232,249,0.25)] transition hover:bg-cyan-200"
              >
                Iniciar revisão ao vivo
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Caption band — "the AI is looking/talking" */}
      <div className="border-t border-cyan-300/15 bg-[#06101a]/90 px-4 py-3 backdrop-blur">
        <p className="mx-auto max-w-3xl text-center text-sm leading-relaxed text-white/85">
          <span className="font-mono uppercase tracking-[0.16em] text-emerald-200/70">ultron </span>
          {caption}
        </p>
        {phase === "done" && (
          <div className="mt-2 text-center">
            <button
              type="button"
              onClick={teardown}
              className="rounded-md border border-white/15 bg-white/[0.03] px-4 py-1.5 text-xs font-semibold text-white/75 transition hover:border-cyan-200/35 hover:text-white"
            >
              Fechar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
