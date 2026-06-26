"use client";

// SPEC-019 Wave C.2b — the ARC "second screen" (mirror popout).
//
// `popout_element` (or the header button) opens a second browser window at /arc-popout that
// MIRRORS the panel stack: both windows consume the same ARC_RENDER stream, so a panel shows on
// both, not one. Because the popout opens after panels are already up, it announces itself with a
// `hello` on ARC_POPOUT_CHANNEL and the main window replies with a `sync` carrying the current
// panels as show-intents — then live updates flow over ARC_RENDER as usual.
import { useEffect, useRef } from "react";
import {
  ARC_POPOUT_CHANNEL,
  ARC_RENDER_CHANNEL,
  ARC_RENDER_EVENT,
} from "@/lib/ultron/agent-trigger";
import { parseUIIntents, type UIIntent } from "@/lib/ultron/render-intents";
import { type Panel } from "@/lib/ultron/render-bus-reducer";
import { useRenderBus } from "./use-render-bus";

const POPOUT_URL = "/arc-popout";
const POPOUT_NAME = "ultron-arc-popout";

type Control = { kind: "hello" } | { kind: "sync"; intents: UIIntent[] };

let popoutWindow: Window | null = null;

/** Open (or re-focus) the mirror window. Returns false if the browser blocked the popup — the
 *  caller degrades gracefully (the main surface keeps every panel; mirror is purely additive). */
export function openArcPopout(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (popoutWindow && !popoutWindow.closed) {
      popoutWindow.focus();
      return true;
    }
    const win = window.open(POPOUT_URL, POPOUT_NAME, "popup,width=960,height=720");
    if (!win) return false; // blocked
    popoutWindow = win;
    win.focus();
    return true;
  } catch {
    return false;
  }
}

function panelsToShowIntents(panels: Panel[]): UIIntent[] {
  return panels.map((p) => ({
    op: "show" as const,
    element: p.element,
    id: p.id,
    anchor: p.anchor,
    data: p.data,
  }));
}

/**
 * Main-window side. Opens the mirror window when a popout intent arrives and answers the popout's
 * hello with the current panels. No-op when we ARE the popout (`window.opener` is set), so it
 * never recursively spawns more windows.
 */
export function ArcPopoutHost() {
  const { panels } = useRenderBus();
  const panelsRef = useRef<Panel[]>(panels);
  panelsRef.current = panels;

  useEffect(() => {
    if (typeof window === "undefined" || window.opener) return;

    const handleIntents = (raw: unknown) => {
      if (parseUIIntents(raw).some((i) => i.op === "popout")) openArcPopout();
    };
    const onEvent = (e: Event) => handleIntents((e as CustomEvent<unknown>).detail);
    window.addEventListener(ARC_RENDER_EVENT, onEvent as EventListener);

    let render: BroadcastChannel | null = null;
    let control: BroadcastChannel | null = null;
    if ("BroadcastChannel" in window) {
      try {
        render = new BroadcastChannel(ARC_RENDER_CHANNEL);
        render.onmessage = (ev: MessageEvent) => handleIntents(ev.data);
      } catch {
        /* same-window CustomEvent still triggers the popout */
      }
      try {
        control = new BroadcastChannel(ARC_POPOUT_CHANNEL);
        control.onmessage = (ev: MessageEvent) => {
          const msg = ev.data as Control;
          if (msg?.kind === "hello" && control) {
            control.postMessage({ kind: "sync", intents: panelsToShowIntents(panelsRef.current) } satisfies Control);
          }
        };
      } catch {
        /* no cross-window catch-up; live updates still mirror */
      }
    }

    return () => {
      window.removeEventListener(ARC_RENDER_EVENT, onEvent as EventListener);
      render?.close();
      control?.close();
    };
  }, []);

  return null;
}

/**
 * Popout-window side. Announces readiness (hello) and applies the sync reply so it mirrors what is
 * already on screen; <ArcBridge> keeps it live afterwards. Mounted only by the popout stage.
 */
export function ArcPopoutClient() {
  const { dispatchMany } = useRenderBus();

  useEffect(() => {
    if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;
    let control: BroadcastChannel | null = null;
    try {
      control = new BroadcastChannel(ARC_POPOUT_CHANNEL);
      control.onmessage = (ev: MessageEvent) => {
        const msg = ev.data as Control;
        if (msg?.kind === "sync") {
          const intents = parseUIIntents(msg.intents);
          if (intents.length > 0) dispatchMany(intents);
        }
      };
      control.postMessage({ kind: "hello" } satisfies Control);
    } catch {
      /* no catch-up; live updates over ARC_RENDER still mirror */
    }
    return () => control?.close();
  }, [dispatchMany]);

  return null;
}
