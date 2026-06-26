// SPEC-019 — pure reducer for the ARC Render Bus.
//
// Kept framework-free (no React) so it can be unit-tested in the node vitest env. The
// provider in `components/arc/render-bus.tsx` wires it to `useReducer`. The panel list is
// ordered: the last element is the topmost in the stack. `focusId` is the panel that voice
// and (later) gestures act on.
import {
  MAX_ACTIVE_PANELS,
  type Anchor,
  type RenderElement,
  type ShowIntent,
  type UIIntent,
} from "./render-intents";

export type Panel = {
  id: string;
  element: RenderElement;
  anchor: Anchor;
  data: unknown;
  poppedOut: boolean;
};

export type RenderBusState = {
  panels: Panel[];
  focusId: string | null;
};

export const initialRenderBusState: RenderBusState = { panels: [], focusId: null };

const DEFAULT_ANCHOR: Anchor = "center";

export function renderBusReducer(state: RenderBusState, intent: UIIntent): RenderBusState {
  switch (intent.op) {
    case "show":
      return showPanel(state, intent);
    case "dismiss":
      return dismissPanel(state, intent.target);
    case "focus":
      return focusPanel(state, intent.target);
    case "popout":
      return popoutPanel(state, intent.target);
    default:
      return state;
  }
}

function showPanel(state: RenderBusState, intent: ShowIntent): RenderBusState {
  const existingIdx = state.panels.findIndex((p) => p.id === intent.id);
  const existing = existingIdx >= 0 ? state.panels[existingIdx] : undefined;

  const panel: Panel = {
    id: intent.id,
    element: intent.element,
    anchor: intent.anchor ?? DEFAULT_ANCHOR,
    data: intent.data,
    poppedOut: existing?.poppedOut ?? false,
  };

  // Re-showing an existing id replaces its data and brings it to the top of the stack.
  const rest =
    existingIdx >= 0
      ? [...state.panels.slice(0, existingIdx), ...state.panels.slice(existingIdx + 1)]
      : [...state.panels];

  let panels = [...rest, panel];

  // Enforce the active-panel cap by dropping the oldest (front of the stack).
  if (panels.length > MAX_ACTIVE_PANELS) {
    panels = panels.slice(panels.length - MAX_ACTIVE_PANELS);
  }

  return { panels, focusId: panel.id };
}

function dismissPanel(state: RenderBusState, target: string): RenderBusState {
  if (target === "all") return { panels: [], focusId: null };

  const panels = state.panels.filter((p) => p.id !== target);
  if (panels.length === state.panels.length) return state; // no-op: unknown target

  const newTop = panels.length ? panels[panels.length - 1] : undefined;
  const focusId =
    state.focusId === target ? (newTop ? newTop.id : null) : state.focusId;

  return { panels, focusId };
}

function focusPanel(state: RenderBusState, target: string): RenderBusState {
  const idx = state.panels.findIndex((p) => p.id === target);
  const panel = idx >= 0 ? state.panels[idx] : undefined;
  if (!panel) return state; // no-op: unknown target

  const panels = [...state.panels.slice(0, idx), ...state.panels.slice(idx + 1), panel];
  return { panels, focusId: target };
}

function popoutPanel(state: RenderBusState, target: string): RenderBusState {
  const idx = state.panels.findIndex((p) => p.id === target);
  if (idx < 0) return state; // no-op: unknown target

  const panels = state.panels.map((p) => (p.id === target ? { ...p, poppedOut: true } : p));
  return { ...state, panels };
}
