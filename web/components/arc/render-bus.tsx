"use client";

// SPEC-019 — ARC Render Bus provider. Holds the active-panel stack (pure reducer) and
// exposes dispatch helpers. Mutates by event only, so it never thrashes the imperative
// lip-sync loop that reads `liveSignalRef` every frame (see ADR 0031).
import { createContext, useContext, useMemo, useReducer, type ReactNode } from "react";
import { type UIIntent } from "@/lib/ultron/render-intents";
import {
  initialRenderBusState,
  renderBusReducer,
  type Panel,
  type RenderBusState,
} from "@/lib/ultron/render-bus-reducer";

export type RenderBusValue = {
  state: RenderBusState;
  panels: Panel[];
  focusId: string | null;
  dispatch: (intent: UIIntent) => void;
  dispatchMany: (intents: UIIntent[]) => void;
};

const RenderBusContext = createContext<RenderBusValue | null>(null);

export function RenderBusProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(renderBusReducer, initialRenderBusState);

  const value = useMemo<RenderBusValue>(
    () => ({
      state,
      panels: state.panels,
      focusId: state.focusId,
      dispatch,
      dispatchMany: (intents: UIIntent[]) => {
        for (const intent of intents) dispatch(intent);
      },
    }),
    [state],
  );

  return <RenderBusContext.Provider value={value}>{children}</RenderBusContext.Provider>;
}

export function useRenderBusContext(): RenderBusValue {
  const ctx = useContext(RenderBusContext);
  if (!ctx) throw new Error("useRenderBus must be used within a RenderBusProvider");
  return ctx;
}
