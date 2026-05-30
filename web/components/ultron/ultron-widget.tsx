"use client";

import { useUltronVoice, type UltronStatus } from "./use-ultron-voice";

const STATUS_LABEL: Record<UltronStatus, string> = {
  idle: "Ocioso",
  armed: 'Aguardando "Ultron"…',
  listening: "Ouvindo…",
  recording: "Gravando…",
  transcribing: "Transcrevendo…",
  thinking: "Pensando…",
  speaking: "Falando…",
  error: "Erro",
};

const STATUS_COLOR: Record<UltronStatus, string> = {
  idle: "bg-white/30",
  armed: "bg-cyan-400 animate-pulse",
  listening: "bg-blue-400 animate-pulse",
  recording: "bg-red-500 animate-pulse",
  transcribing: "bg-yellow-400 animate-pulse",
  thinking: "bg-purple-400 animate-pulse",
  speaking: "bg-[var(--color-orange)] animate-pulse",
  error: "bg-red-600",
};

export function UltronWidget() {
  const { state, startPushToTalk, stopPushToTalk, toggleHandsFree, toggleWakeWord, stopSpeaking } =
    useUltronVoice();
  const idleish = state.status === "idle" || state.status === "armed" || state.status === "listening";
  const busy = !idleish && state.status !== "error";

  return (
    <div className="fixed bottom-6 right-6 z-50 w-80 rounded-2xl border border-white/10 bg-[var(--color-navy-soft)]/95 p-4 shadow-2xl backdrop-blur">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_COLOR[state.status]}`} />
          <span className="text-sm font-semibold text-white">Ultron</span>
        </div>
        <span className="text-xs text-white/40">{STATUS_LABEL[state.status]}</span>
      </div>

      {(state.transcript || state.reply) && (
        <div className="mb-3 max-h-40 space-y-2 overflow-y-auto text-sm">
          {state.transcript && (
            <p className="text-white/50">
              <span className="text-white/30">você: </span>
              {state.transcript}
            </p>
          )}
          {state.reply && (
            <p className="text-white/90">
              <span className="text-[var(--color-orange)]">ultron: </span>
              {state.reply}
            </p>
          )}
        </div>
      )}

      {state.error && <p className="mb-3 text-xs text-red-400">{state.error}</p>}

      <div className="flex items-center gap-2">
        <button
          onPointerDown={(e) => {
            e.preventDefault();
            startPushToTalk();
          }}
          onPointerUp={(e) => {
            e.preventDefault();
            stopPushToTalk();
          }}
          onPointerLeave={() => stopPushToTalk()}
          disabled={busy || state.handsFree || state.wakeActive}
          className="flex-1 select-none rounded-lg bg-[var(--color-orange)] px-3 py-2 text-sm font-medium text-black transition active:scale-[0.98] disabled:opacity-40"
        >
          Segurar p/ falar
        </button>

        <button
          onClick={toggleHandsFree}
          disabled={state.wakeActive}
          className={`rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-40 ${
            state.handsFree
              ? "bg-blue-500 text-white"
              : "border border-white/15 text-white/80 hover:bg-white/5"
          }`}
        >
          {state.handsFree ? "Parar" : "Mãos livres"}
        </button>

        {state.status === "speaking" && (
          <button
            onClick={stopSpeaking}
            className="rounded-lg border border-white/15 px-2 py-2 text-xs text-white/60 hover:bg-white/5"
            aria-label="Interromper fala"
          >
            ⏹
          </button>
        )}
      </div>

      {state.wakeSupported && (
        <button
          onClick={toggleWakeWord}
          disabled={state.handsFree}
          className={`mt-2 w-full rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-40 ${
            state.wakeActive
              ? "bg-cyan-500 text-black"
              : "border border-white/15 text-white/80 hover:bg-white/5"
          }`}
        >
          {state.wakeActive ? 'Wake word ON — diga "Ultron"' : 'Ativar wake word "Ultron"'}
        </button>
      )}

      <p className="mt-2 text-[11px] leading-tight text-white/30">
        {state.wakeSupported
          ? 'Ative o wake word e diga "Ultron" para falar sem as mãos, ou segure o botão. Pergunte métricas, status de um cliente ou o que os agents fizeram.'
          : "Use Chrome/Edge para o wake word. Por enquanto, segure o botão ou use mãos livres."}
      </p>
    </div>
  );
}
