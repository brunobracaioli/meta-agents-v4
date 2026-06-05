"use client";

import { useState } from "react";
import { useUltronVoice, type UltronStatus } from "./use-ultron-voice";
import { UltronVisualizer } from "./ultron-visualizer";
import { LiveReviewStage } from "./live-review-stage";

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
  } = useUltronVoice();
  const idleish = state.status === "idle" || state.status === "armed" || state.status === "listening";
  const busy = !idleish && state.status !== "error";

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
      <div className="fixed bottom-4 right-4 z-50 max-h-[calc(100vh-2rem)] w-[min(calc(100vw-2rem),24rem)] overflow-y-auto rounded-lg border border-cyan-300/20 bg-[#06101a]/95 p-3 shadow-[0_24px_90px_rgba(0,0,0,0.5)] backdrop-blur-xl sm:bottom-6 sm:right-6">
      <div className="mb-3 flex items-start justify-between gap-3">
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
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="grid h-7 w-7 shrink-0 place-items-center rounded border border-white/10 bg-white/[0.03] font-mono text-xs text-white/60 transition hover:border-cyan-200/35 hover:text-white"
          aria-label="Recolher console Ultron"
          title="Recolher"
        >
          ×
        </button>
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

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">
        <span>PTT</span>
        <span>{sharing ? "Tela ON" : state.wakeActive ? 'Diga "Ultron"' : state.handsFree ? "Mic ativo" : "Manual"}</span>
      </div>
      </div>
    </>
  );
}
