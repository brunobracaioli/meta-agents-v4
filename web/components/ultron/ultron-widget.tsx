"use client";

import { useUltronVoice, type UltronStatus } from "./use-ultron-voice";

const STATUS_LABEL: Record<UltronStatus, string> = {
  idle: "Ocioso",
  listening: "Ouvindo…",
  recording: "Gravando…",
  transcribing: "Transcrevendo…",
  thinking: "Pensando…",
  speaking: "Falando…",
  error: "Erro",
};

const STATUS_COLOR: Record<UltronStatus, string> = {
  idle: "bg-white/30",
  listening: "bg-blue-400 animate-pulse",
  recording: "bg-red-500 animate-pulse",
  transcribing: "bg-yellow-400 animate-pulse",
  thinking: "bg-purple-400 animate-pulse",
  speaking: "bg-[var(--color-orange)] animate-pulse",
  error: "bg-red-600",
};

export function UltronWidget() {
  const { state, startPushToTalk, stopPushToTalk, toggleHandsFree, stopSpeaking } = useUltronVoice();
  const busy = state.status !== "idle" && state.status !== "listening" && state.status !== "error";

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
          disabled={busy || state.handsFree}
          className="flex-1 select-none rounded-lg bg-[var(--color-orange)] px-3 py-2 text-sm font-medium text-black transition active:scale-[0.98] disabled:opacity-40"
        >
          Segurar p/ falar
        </button>

        <button
          onClick={toggleHandsFree}
          className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
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

      <p className="mt-2 text-[11px] leading-tight text-white/30">
        Pergunte o que os agents fizeram, métricas ou status de um cliente. Wake word
        &ldquo;Ultron&rdquo; chega quando a chave Picovoice for configurada.
      </p>
    </div>
  );
}
