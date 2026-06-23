"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { type UltronStatus } from "./use-ultron-voice";
import { useUltron } from "./ultron-provider";
import { UltronVisualizer } from "./ultron-visualizer";
import { LiveReviewStage } from "./live-review-stage";

// Console window geometry. Position/size live in ephemeral React state (no storage),
// so a page refresh resets the console to its default bottom-right anchor.
const MIN_W = 300;
const MIN_H = 220;
const EDGE_MARGIN = 8;

type Pos = { left: number; top: number };
type Size = { width: number; height: number };

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const STATUS_LABEL: Record<UltronStatus, string> = {
  idle: "Ocioso",
  armed: 'Aguardando "Ultron"',
  listening: "Ouvindo",
  recording: "Gravando",
  transcribing: "Transcrevendo",
  thinking: "Pensando",
  capturing: "Vendo a tela",
  speaking: "Falando",
  error: "Erro",
};

const STATUS_COLOR: Record<UltronStatus, string> = {
  idle: "bg-white/30",
  armed: "bg-cyan-300 shadow-[0_0_14px_rgba(103,232,249,0.9)]",
  listening: "bg-sky-300 shadow-[0_0_14px_rgba(125,211,252,0.9)]",
  recording: "bg-orange-300 shadow-[0_0_14px_rgba(251,146,60,0.9)]",
  transcribing: "bg-amber-300 shadow-[0_0_14px_rgba(252,211,77,0.9)]",
  thinking: "bg-violet-300 shadow-[0_0_14px_rgba(196,181,253,0.9)]",
  capturing: "bg-fuchsia-300 shadow-[0_0_14px_rgba(240,171,252,0.9)]",
  speaking: "bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,0.95)]",
  error: "bg-red-600",
};

export function UltronWidget() {
  const [open, setOpen] = useState(false);
  const {
    state,
    startPushToTalk,
    stopPushToTalk,
    toggleHandsFree,
    toggleWakeWord,
    stopSpeaking,
    sharing,
    toggleShare,
    startShare,
    captureFrame,
    speak,
    autoReview,
    toggleAutoReview,
  } = useUltron();
  const idleish = state.status === "idle" || state.status === "armed" || state.status === "listening";
  const busy = !idleish && state.status !== "error";

  // Window-like geometry for the open console: null position/size = default
  // bottom-right anchor (responsive). Lifted above the open/collapsed branch so it
  // survives collapse→reopen within a session but resets on refresh.
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; baseLeft: number; baseTop: number } | null>(null);
  const reszRef = useRef<{ startX: number; startY: number; baseW: number; baseH: number; left: number; top: number } | null>(null);

  const onHeaderPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (maximized) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseLeft: rect.left, baseTop: rect.top };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [maximized]);

  const onHeaderPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const rect = panelRef.current?.getBoundingClientRect();
    const w = rect?.width ?? MIN_W;
    const h = rect?.height ?? MIN_H;
    const left = clamp(d.baseLeft + (e.clientX - d.startX), EDGE_MARGIN, window.innerWidth - w - EDGE_MARGIN);
    const top = clamp(d.baseTop + (e.clientY - d.startY), EDGE_MARGIN, window.innerHeight - h - EDGE_MARGIN);
    setPos({ left, top });
  }, []);

  const onHeaderPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const onResizePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (maximized) return;
    e.stopPropagation();
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Anchor the panel by its current top-left so resizing grows predictably from that corner.
    setPos({ left: rect.left, top: rect.top });
    setSize({ width: rect.width, height: rect.height });
    reszRef.current = { startX: e.clientX, startY: e.clientY, baseW: rect.width, baseH: rect.height, left: rect.left, top: rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [maximized]);

  const onResizePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const r = reszRef.current;
    if (!r) return;
    const width = clamp(r.baseW + (e.clientX - r.startX), MIN_W, window.innerWidth - r.left - EDGE_MARGIN);
    const height = clamp(r.baseH + (e.clientY - r.startY), MIN_H, window.innerHeight - r.top - EDGE_MARGIN);
    setSize({ width, height });
  }, []);

  const onResizePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    reszRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  // Keep the console inside the viewport when the window shrinks (so it can't get lost off-screen).
  useEffect(() => {
    if (!pos && !size) return;
    const onResize = () => {
      const rect = panelRef.current?.getBoundingClientRect();
      const w = size?.width ?? rect?.width ?? MIN_W;
      const h = size?.height ?? rect?.height ?? MIN_H;
      setSize((s) => (s ? { width: Math.min(s.width, window.innerWidth - 2 * EDGE_MARGIN), height: Math.min(s.height, window.innerHeight - 2 * EDGE_MARGIN) } : s));
      setPos((p) =>
        p
          ? {
              left: clamp(p.left, EDGE_MARGIN, Math.max(EDGE_MARGIN, window.innerWidth - w - EDGE_MARGIN)),
              top: clamp(p.top, EDGE_MARGIN, Math.max(EDGE_MARGIN, window.innerHeight - h - EDGE_MARGIN)),
            }
          : p,
      );
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [pos, size]);

  const floating = pos !== null || size !== null;
  // Default anchor (bottom-right, responsive) when untouched; plain `fixed` + inline geometry once moved/resized.
  const panelClassName = maximized
    ? "fixed inset-2 z-50 overflow-y-auto rounded-lg border border-cyan-300/20 bg-[#06101a]/95 p-3 shadow-[0_24px_90px_rgba(0,0,0,0.5)] backdrop-blur-xl"
    : floating
      ? "fixed z-50 overflow-y-auto rounded-lg border border-cyan-300/20 bg-[#06101a]/95 p-3 shadow-[0_24px_90px_rgba(0,0,0,0.5)] backdrop-blur-xl"
      : "fixed bottom-4 right-4 z-50 max-h-[calc(100vh-2rem)] w-[min(calc(100vw-2rem),24rem)] overflow-y-auto rounded-lg border border-cyan-300/20 bg-[#06101a]/95 p-3 shadow-[0_24px_90px_rgba(0,0,0,0.5)] backdrop-blur-xl sm:bottom-6 sm:right-6";
  const panelStyle: CSSProperties | undefined =
    maximized || !floating
      ? undefined
      : {
          left: pos?.left,
          top: pos?.top,
          width: size?.width,
          height: size?.height,
          maxHeight: size ? undefined : "calc(100vh - 2rem)",
          ...(size ? null : { width: "min(calc(100vw - 2rem), 24rem)" }),
        };

  // The Live Review overlay (SPEC-014) renders independently of the console's open/collapsed
  // state: it appears in fullscreen when Ultron's request_live_review tool fires.
  const liveReview = (
    <LiveReviewStage startShare={startShare} sharing={sharing} captureFrame={captureFrame} speak={speak} />
  );

  if (!open) {
    return (
      <>
        {liveReview}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-50 grid h-11 w-11 place-items-center rounded-full border border-cyan-300/25 bg-[#06101a]/95 font-mono text-sm font-semibold uppercase text-cyan-100 shadow-[0_18px_55px_rgba(0,0,0,0.45)] backdrop-blur-xl transition hover:border-cyan-200/45 sm:bottom-6 sm:right-6"
          aria-label="Abrir console Ultron"
          title="Abrir Ultron"
        >
          <span className={`absolute left-1.5 top-1.5 h-2.5 w-2.5 rounded-full ${STATUS_COLOR[state.status]}`} />
          U
        </button>
      </>
    );
  }

  return (
    <>
      {liveReview}
      <div ref={panelRef} className={panelClassName} style={panelStyle}>
      <div
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
        className={`mb-3 flex touch-none select-none items-start justify-between gap-3 ${maximized ? "" : dragging ? "cursor-grabbing" : "cursor-grab"}`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className={`mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_COLOR[state.status]}`} />
          <div className="min-w-0">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-100">
              Ultron
            </p>
            <p className="truncate text-xs text-white/45">Console de voz</p>
          </div>
        </div>
        <span className="shrink-0 rounded border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/55">
          {STATUS_LABEL[state.status]}
        </span>
        <div className="flex shrink-0 items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setMaximized((m) => !m)}
            className="grid h-7 w-7 place-items-center rounded border border-white/10 bg-white/[0.03] font-mono text-xs text-white/60 transition hover:border-cyan-200/35 hover:text-white"
            aria-label={maximized ? "Restaurar console Ultron" : "Maximizar console Ultron"}
            title={maximized ? "Restaurar" : "Maximizar"}
          >
            {maximized ? "❐" : "⤢"}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="grid h-7 w-7 place-items-center rounded border border-white/10 bg-white/[0.03] font-mono text-xs text-white/60 transition hover:border-cyan-200/35 hover:text-white"
            aria-label="Recolher console Ultron"
            title="Recolher"
          >
            ×
          </button>
        </div>
      </div>

      <UltronVisualizer
        status={state.status}
        outputLevel={state.outputLevel}
        outputBands={state.outputBands}
      />

      {(state.transcript || state.reply) && (
        <div className="mt-3 max-h-36 space-y-2 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-3 text-xs leading-relaxed">
          {state.transcript && (
            <p className="text-white/50">
              <span className="font-mono uppercase tracking-[0.14em] text-cyan-200/55">você </span>
              {state.transcript}
            </p>
          )}
          {state.reply && (
            <p className="text-white/90">
              <span className="font-mono uppercase tracking-[0.14em] text-emerald-200/70">ultron </span>
              {state.reply}
            </p>
          )}
        </div>
      )}

      {state.error && (
        <p className="mt-3 rounded border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {state.error}
        </p>
      )}

      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
        <button
          onPointerDown={(e) => {
            e.preventDefault();
            startPushToTalk();
          }}
          onPointerUp={(e) => {
            e.preventDefault();
            stopPushToTalk();
          }}
          onPointerCancel={() => stopPushToTalk()}
          onPointerLeave={() => stopPushToTalk()}
          disabled={busy || state.handsFree || state.wakeActive}
          className="min-h-10 select-none rounded-md border border-orange-200/30 bg-orange-300 px-3 py-2 text-sm font-semibold text-black shadow-[0_0_18px_rgba(251,146,60,0.18)] transition active:scale-[0.99] disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/10 disabled:text-white/35"
        >
          Segurar para falar
        </button>

        {state.status === "speaking" && (
          <button
            onClick={stopSpeaking}
            className="h-10 w-10 rounded-md border border-white/15 bg-white/[0.03] font-mono text-sm text-white/70 transition hover:border-red-300/45 hover:bg-red-500/10 hover:text-red-100"
            aria-label="Interromper fala"
            title="Interromper fala"
          >
            ■
          </button>
        )}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          onClick={toggleHandsFree}
          disabled={state.wakeActive}
          aria-pressed={state.handsFree}
          className={`min-h-9 rounded-md border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-35 ${
            state.handsFree
              ? "border-sky-200/40 bg-sky-400/20 text-sky-100"
              : "border-white/15 bg-white/[0.02] text-white/70 hover:border-sky-200/35 hover:text-white"
          }`}
        >
          {state.handsFree ? "Parar" : "Mãos livres"}
        </button>

        {state.wakeSupported ? (
          <button
            onClick={toggleWakeWord}
            disabled={state.handsFree}
            aria-pressed={state.wakeActive}
            className={`min-h-9 rounded-md border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-35 ${
              state.wakeActive
                ? "border-cyan-200/45 bg-cyan-300 text-black"
                : "border-white/15 bg-white/[0.02] text-white/70 hover:border-cyan-200/35 hover:text-white"
            }`}
          >
            {state.wakeActive ? "Wake ON" : "Wake word"}
          </button>
        ) : (
          <span className="flex min-h-9 items-center justify-center rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 text-center text-xs text-white/35">
            Wake indisponível
          </span>
        )}
      </div>

      <button
        onClick={toggleShare}
        aria-pressed={sharing}
        className={`mt-2 min-h-9 w-full rounded-md border px-3 py-2 text-xs font-semibold transition ${
          sharing
            ? "border-fuchsia-200/45 bg-fuchsia-400/20 text-fuchsia-100"
            : "border-white/15 bg-white/[0.02] text-white/70 hover:border-fuchsia-200/35 hover:text-white"
        }`}
        title="Compartilhe a tela uma vez; depois o Ultron consegue olhar quando você pedir."
      >
        {sharing ? "Ultron está vendo sua tela" : "Ultron pode ver minha tela"}
      </button>

      <button
        onClick={toggleAutoReview}
        aria-pressed={autoReview}
        className={`mt-2 min-h-9 w-full rounded-md border px-3 py-2 text-xs font-semibold transition ${
          autoReview
            ? "border-cyan-200/45 bg-cyan-400/20 text-cyan-100"
            : "border-white/15 bg-white/[0.02] text-white/70 hover:border-cyan-200/35 hover:text-white"
        }`}
        title="Quando uma landing page terminar de ser criada, o Ultron abre a revisão visual ao vivo automaticamente (compartilhe a tela para rodar sem cliques)."
      >
        {autoReview ? "Auto-revisar ao concluir: ON" : "Auto-revisar ao concluir"}
      </button>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">
        <span>PTT</span>
        <span>{sharing ? "Tela ON" : state.wakeActive ? 'Diga "Ultron"' : state.handsFree ? "Mic ativo" : "Manual"}</span>
      </div>

      {!maximized && (
        <div
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
          className="absolute bottom-1 right-1 z-10 grid h-4 w-4 cursor-se-resize touch-none place-items-center text-white/30 transition hover:text-cyan-200/70"
          role="separator"
          aria-label="Redimensionar console Ultron"
          title="Redimensionar"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M14 6 6 14M14 11l-3 3" />
          </svg>
        </div>
      )}
      </div>
    </>
  );
}
