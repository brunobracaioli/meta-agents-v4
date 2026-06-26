import { describe, expect, it } from "vitest";
import { initialRenderBusState, renderBusReducer, type RenderBusState } from "./render-bus-reducer";
import {
  MAX_ACTIVE_PANELS,
  parseUIIntents,
  uiIntentFromToolResult,
  type ShowIntent,
  type UIIntent,
} from "./render-intents";

function show(id: string, overrides: Partial<ShowIntent> = {}): UIIntent {
  return {
    op: "show",
    element: overrides.element ?? "funnel",
    id,
    ...(overrides.anchor ? { anchor: overrides.anchor } : {}),
    data: overrides.data ?? { ok: true },
  };
}

function reduce(intents: UIIntent[], from: RenderBusState = initialRenderBusState): RenderBusState {
  return intents.reduce(renderBusReducer, from);
}

describe("renderBusReducer", () => {
  it("starts empty", () => {
    expect(initialRenderBusState).toEqual({ panels: [], focusId: null });
  });

  it("show pushes a panel and focuses it", () => {
    const state = reduce([show("a")]);
    expect(state.panels).toHaveLength(1);
    expect(state.panels[0]!).toMatchObject({ id: "a", element: "funnel", anchor: "center", poppedOut: false });
    expect(state.focusId).toBe("a");
  });

  it("re-showing an id replaces data and brings it to the top + focus", () => {
    const state = reduce([show("a"), show("b"), show("a", { data: { v: 2 } })]);
    expect(state.panels.map((p) => p.id)).toEqual(["b", "a"]); // a moved to top
    expect(state.panels[1]!.data).toEqual({ v: 2 });
    expect(state.focusId).toBe("a");
  });

  it("enforces the active-panel cap by dropping the oldest", () => {
    const ids = Array.from({ length: MAX_ACTIVE_PANELS + 2 }, (_, i) => `p${i}`);
    const state = reduce(ids.map((id) => show(id)));
    expect(state.panels).toHaveLength(MAX_ACTIVE_PANELS);
    expect(state.panels[0]!.id).toBe("p2"); // p0, p1 dropped
    expect(state.focusId).toBe(`p${MAX_ACTIVE_PANELS + 1}`);
  });

  it("dismiss removes a panel and re-points focus to the new top", () => {
    const state = reduce([show("a"), show("b"), { op: "dismiss", target: "b" }]);
    expect(state.panels.map((p) => p.id)).toEqual(["a"]);
    expect(state.focusId).toBe("a");
  });

  it('dismiss "all" clears everything', () => {
    const state = reduce([show("a"), show("b"), { op: "dismiss", target: "all" }]);
    expect(state).toEqual({ panels: [], focusId: null });
  });

  it("dismiss of an unknown target is a no-op", () => {
    const before = reduce([show("a")]);
    const after = renderBusReducer(before, { op: "dismiss", target: "ghost" });
    expect(after).toBe(before);
  });

  it("focus brings an existing panel to the top", () => {
    const state = reduce([show("a"), show("b"), { op: "focus", target: "a" }]);
    expect(state.panels.map((p) => p.id)).toEqual(["b", "a"]);
    expect(state.focusId).toBe("a");
  });

  it("popout flags the target panel", () => {
    const state = reduce([show("a"), { op: "popout", target: "a" }]);
    expect(state.panels[0]!.poppedOut).toBe(true);
  });
});

describe("parseUIIntents", () => {
  it("keeps well-formed intents and drops malformed ones", () => {
    const intents = parseUIIntents([
      { op: "show", element: "funnel", id: "a", data: { x: 1 } },
      { op: "show", element: "not_a_real_element", id: "b", data: {} }, // bad enum
      { op: "dismiss", target: "a" },
      { op: "dismiss" }, // missing target
      { op: "whatever" }, // bad discriminator
      42,
    ]);
    expect(intents).toHaveLength(2);
    expect(intents[0]!).toMatchObject({ op: "show", id: "a" });
    expect(intents[1]!).toMatchObject({ op: "dismiss", target: "a" });
  });

  it("returns [] for non-array input", () => {
    expect(parseUIIntents(null)).toEqual([]);
    expect(parseUIIntents({ op: "show" })).toEqual([]);
  });
});

describe("uiIntentFromToolResult", () => {
  it("extracts and validates a well-formed ui_intent", () => {
    const intent = uiIntentFromToolResult({
      client_slug: "brunobracaioli",
      ui_intent: { op: "show", element: "funnel", id: "funnel", data: { x: 1 } },
    });
    expect(intent).toMatchObject({ op: "show", element: "funnel", id: "funnel" });
  });

  it("extracts a dismiss directive", () => {
    expect(uiIntentFromToolResult({ dismissed: "all", ui_intent: { op: "dismiss", target: "all" } })).toEqual({
      op: "dismiss",
      target: "all",
    });
  });

  it("returns null for a result without ui_intent (a normal data tool)", () => {
    expect(uiIntentFromToolResult({ client_slug: "x", campaigns: [] })).toBeNull();
    expect(uiIntentFromToolResult({ error: "cliente não encontrado" })).toBeNull();
  });

  it("returns null for a malformed ui_intent (bad element)", () => {
    expect(uiIntentFromToolResult({ ui_intent: { op: "show", element: "nope", id: "a", data: {} } })).toBeNull();
  });

  it("returns null for non-object results", () => {
    expect(uiIntentFromToolResult(null)).toBeNull();
    expect(uiIntentFromToolResult("funnel")).toBeNull();
    expect(uiIntentFromToolResult([{ op: "dismiss", target: "all" }])).toBeNull();
  });
});
