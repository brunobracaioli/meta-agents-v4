"use client";

// SPEC-019 (ADR 0031) — the bridge between the voice pipeline and the Render Bus.
//
// The UltronProvider (voice) is mounted by the dashboard layout, ABOVE this page; the
// RenderBusProvider lives INSIDE arc-stage, BELOW it. So the voice hook cannot dispatch into
// the bus directly. Instead it publishes UIIntents over a same-window CustomEvent (and a
// cross-tab BroadcastChannel for a future popout window); this bridge — rendered inside the
// provider — listens on both and dispatches into the bus. Intents are revalidated with
// parseUIIntents before dispatch, so a malformed payload can never break the bus.
import { useEffect } from "react";
import { ARC_RENDER_CHANNEL, ARC_RENDER_EVENT } from "@/lib/ultron/agent-trigger";
import { parseUIIntents } from "@/lib/ultron/render-intents";
import { useRenderBus } from "./use-render-bus";

export function ArcBridge() {
  const { dispatchMany } = useRenderBus();

  useEffect(() => {
    const onEvent = (e: Event) => {
      const intents = parseUIIntents((e as CustomEvent<unknown>).detail);
      if (intents.length > 0) dispatchMany(intents);
    };
    window.addEventListener(ARC_RENDER_EVENT, onEvent as EventListener);

    let channel: BroadcastChannel | null = null;
    if ("BroadcastChannel" in window) {
      try {
        channel = new BroadcastChannel(ARC_RENDER_CHANNEL);
        channel.onmessage = (ev: MessageEvent) => {
          const intents = parseUIIntents(ev.data);
          if (intents.length > 0) dispatchMany(intents);
        };
      } catch {
        // Same-window CustomEvent still works; cross-tab delivery is best-effort.
      }
    }

    return () => {
      window.removeEventListener(ARC_RENDER_EVENT, onEvent as EventListener);
      channel?.close();
    };
  }, [dispatchMany]);

  return null;
}
