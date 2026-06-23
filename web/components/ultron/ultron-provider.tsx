"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useUltronVoice } from "./use-ultron-voice";

// Single shared voice instance for the whole dashboard. Mounted once in the dashboard
// layout, it owns the only microphone, narration poller and TTS pipeline. Both the
// floating console (UltronWidget) and the 3D avatar tab (UltronStage) consume it, so
// the avatar's mouth syncs to the exact same audio that drives the console's reactor —
// no duplicate mic, no double TTS.
type UltronContextValue = ReturnType<typeof useUltronVoice>;

const UltronContext = createContext<UltronContextValue | null>(null);

export function UltronProvider({ children }: { children: ReactNode }) {
  const ultron = useUltronVoice();
  return <UltronContext.Provider value={ultron}>{children}</UltronContext.Provider>;
}

export function useUltron(): UltronContextValue {
  const ctx = useContext(UltronContext);
  if (!ctx) throw new Error("useUltron must be used within an UltronProvider");
  return ctx;
}
