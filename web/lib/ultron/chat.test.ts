import { describe, it, expect, vi, beforeEach } from "vitest";

// --- hoisted mocks (referenced inside vi.mock factories) ---

const { createMock, streamMock, recordedCalls } = vi.hoisted(() => ({
  createMock: vi.fn(),
  streamMock: vi.fn(),
  recordedCalls: [] as Array<{ messages: unknown[] }>,
}));

const { pendingStore, savePending, loadPending, deletePending } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    pendingStore: store,
    savePending: vi.fn(async (s: string, id: string, state: unknown) => void store.set(`${s}:${id}`, state)),
    loadPending: vi.fn(async (s: string, id: string) => store.get(`${s}:${id}`) ?? null),
    deletePending: vi.fn(async (s: string, id: string) => void store.delete(`${s}:${id}`)),
  };
});

const { loadMemory, appendExchange } = vi.hoisted(() => ({
  loadMemory: vi.fn(async () => [] as Array<{ role: string; content: string }>),
  appendExchange: vi.fn(async () => {}),
}));

const { runTool } = vi.hoisted(() => ({
  runTool: vi.fn(async (): Promise<unknown> => ({ ok: true, note: "dados de teste" })),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async (args: { messages: unknown[] }) => {
        recordedCalls.push(args);
        return createMock(args);
      },
      stream: (args: { messages: unknown[] }) => {
        recordedCalls.push(args);
        return streamMock(args);
      },
    };
  },
}));
vi.mock("@/lib/env", () => ({ env: { anthropicApiKey: () => "test-key" } }));
vi.mock("@/lib/ultron/tools", () => ({
  // Non-empty so the forced-tool gate (guarded on tools.length > 0) engages, as in prod.
  toolSpecs: [{ name: "dummy", description: "d", input_schema: { type: "object" as const } }],
  runTool,
  CLIENT_TOOLS: new Set(["capture_screen"]),
  loadDynamicSkillTools: vi.fn(async () => []),
}));
vi.mock("@/lib/ultron/memory", () => ({ loadMemory, appendExchange }));
vi.mock("@/lib/ultron/pending", () => ({ savePending, loadPending, deletePending }));

import { runChat, runChatStream, resumeChat } from "@/lib/ultron/chat";

const SESSION = "session-test-1";
const FAKE_IMAGE = { media_type: "image/jpeg" as const, data: "QUJD" };

// A fake MessageStream: registers the text callback, and on finalMessage() replays
// the deltas (simulating streaming) before resolving the final message — matching how
// runChatStream wires `.on("text")` then awaits `.finalMessage()`.
function makeStream(deltas: string[], finalMsg: unknown) {
  let textCb: ((d: string) => void) | null = null;
  return {
    on(event: string, cb: (d: string) => void) {
      if (event === "text") textCb = cb;
      return this;
    },
    async finalMessage() {
      for (const d of deltas) textCb?.(d);
      return finalMsg;
    },
  };
}

function capturePauseTurn() {
  return {
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id: "tu_cap", name: "capture_screen", input: {} }],
  };
}
function textTurn(text: string) {
  return { stop_reason: "end_turn", content: [{ type: "text", text }] };
}
function toolTurn(id: string, name: string, input: Record<string, unknown>) {
  return { stop_reason: "tool_use", content: [{ type: "tool_use", id, name, input }] };
}

beforeEach(() => {
  vi.clearAllMocks();
  pendingStore.clear();
  recordedCalls.length = 0;
});

describe("runChatStream — streams deltas and accumulates the reply", () => {
  it("emits each text delta and returns the full spoken text", async () => {
    streamMock.mockReturnValueOnce(makeStream(["Oi", ", tudo", " certo."], textTurn("ignored")));

    const deltas: string[] = [];
    const result = await runChatStream(SESSION, "e aí", null, (d) => deltas.push(d));

    expect(deltas).toEqual(["Oi", ", tudo", " certo."]);
    expect(result.kind).toBe("reply");
    if (result.kind !== "reply") throw new Error("unreachable");
    // Reply is the accumulated streamed text, not extractText of the final message.
    expect(result.reply).toBe("Oi, tudo certo.");
    expect(appendExchange).toHaveBeenCalledTimes(1);
  });

  it("runs a tool turn then streams the final answer", async () => {
    runTool.mockResolvedValueOnce({ ok: true });
    streamMock
      .mockReturnValueOnce(
        makeStream([], toolTurn("tu_ov", "get_client_overview", { client_slug: "brunobracaioli" })),
      )
      .mockReturnValueOnce(makeStream(["Pronto."], textTurn("ignored")));

    const deltas: string[] = [];
    const result = await runChatStream(SESSION, "resumo do bruno", null, (d) => deltas.push(d));

    expect(runTool).toHaveBeenCalledTimes(1);
    expect(deltas).toEqual(["Pronto."]);
    expect(result.kind).toBe("reply");
    if (result.kind !== "reply") throw new Error("unreachable");
    expect(result.reply).toBe("Pronto.");
  });

  it("returns need_capture without requiring any text", async () => {
    streamMock.mockReturnValueOnce(makeStream([], capturePauseTurn()));

    const result = await runChatStream(SESSION, "o que tem na tela?", null, () => {});

    expect(result.kind).toBe("need_capture");
    expect(appendExchange).not.toHaveBeenCalled();
  });
});

describe("runChatStream — forces a tool on command turns", () => {
  const toolChoiceOf = (i: number) => (recordedCalls[i] as { tool_choice?: unknown }).tool_choice;

  it("forces tool_choice:any on iter 0 of a command, then auto for the summary", async () => {
    runTool.mockResolvedValueOnce({ popped_out: "all", ui_intent: { op: "popout", target: "all" } });
    streamMock
      .mockReturnValueOnce(makeStream([], toolTurn("tu_pop", "popout_element", { target: "all" })))
      .mockReturnValueOnce(makeStream(["Pronto, joguei pra segunda tela."], textTurn("ignored")));

    const result = await runChatStream(SESSION, "joga pra segunda tela", null, () => {});

    // iter 0 forced (no text spoken pre-tool); iter 1 back to auto so the model can speak.
    expect(toolChoiceOf(0)).toEqual({ type: "any" });
    expect(toolChoiceOf(1)).toBeUndefined();
    expect(runTool).toHaveBeenCalledWith("popout_element", { target: "all" }, expect.anything(), []);
    expect(result.kind).toBe("reply");
    if (result.kind !== "reply") throw new Error("unreachable");
    expect(result.uiIntents).toEqual([{ op: "popout", target: "all" }]);
    expect(result.reply).toBe("Pronto, joguei pra segunda tela.");
  });

  it("does NOT force a tool on a chit-chat turn", async () => {
    streamMock.mockReturnValueOnce(makeStream(["Oi!"], textTurn("ignored")));

    await runChatStream(SESSION, "oi, tudo bem?", null, () => {});

    expect(toolChoiceOf(0)).toBeUndefined();
  });
});

describe("phantom-claim reconciliation (non-streaming path)", () => {
  it("scrubs a completed-action claim when no tool ran this turn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Model narrates an action but never calls a tool (stop_reason end_turn, usedTools empty).
    createMock.mockResolvedValueOnce(textTurn("Pronto, abri a segunda tela. Quer ver o funil?"));

    const result = await runChat(SESSION, "abre a segunda tela");

    expect(result.kind).toBe("reply");
    if (result.kind !== "reply") throw new Error("unreachable");
    // The false "abri" sentence is dropped; the safe follow-up survives.
    expect(result.reply).toBe("Quer ver o funil?");
    expect(warn).toHaveBeenCalled();
    const logged = JSON.parse((warn.mock.calls[0]?.[0] as string) ?? "{}");
    expect(logged.event).toBe("phantom_claim");
    warn.mockRestore();
  });
});

describe("runChat — pause on capture_screen", () => {
  it("returns need_capture and persists pending state with the capture tool_use id", async () => {
    createMock.mockResolvedValueOnce(capturePauseTurn());

    const result = await runChat(SESSION, "que erro é esse na tela?");

    expect(result.kind).toBe("need_capture");
    if (result.kind !== "need_capture") throw new Error("unreachable");
    expect(result.usedTools).toContain("capture_screen");
    expect(savePending).toHaveBeenCalledTimes(1);
    const [, savedId, savedState] = savePending.mock.calls[0] as [string, string, { captureToolUseId: string }];
    expect(savedId).toBe(result.pendingId);
    expect(savedState.captureToolUseId).toBe("tu_cap");
    // Memory is NOT persisted until the turn completes on resume.
    expect(appendExchange).not.toHaveBeenCalled();
  });
});

describe("runChat — agent trigger metadata", () => {
  it("exposes a trigger when an Ultron write tool enqueues a job", async () => {
    runTool.mockResolvedValueOnce({
      enqueued: true,
      job_id: "job-1",
      skill: "create-traffic-brunobracaioli-campaign",
      kind: "create",
      client_slug: "brunobracaioli",
      queued_at: "2026-06-01T13:00:00.000Z",
    });
    createMock
      .mockResolvedValueOnce(
        toolTurn("tu_create", "request_campaign_creation", { client_slug: "brunobracaioli", confirm: true }),
      )
      .mockResolvedValueOnce(textTurn("Pedido enfileirado."));

    const result = await runChat(SESSION, "sim, pode criar");

    expect(result.kind).toBe("reply");
    expect(result.agentTriggers).toEqual([
      {
        jobId: "job-1",
        skill: "create-traffic-brunobracaioli-campaign",
        kind: "create",
        clientSlug: "brunobracaioli",
        queuedAt: "2026-06-01T13:00:00.000Z",
        source: "ultron",
      },
    ]);
  });

  it("does not expose a trigger when enqueue is rejected", async () => {
    runTool.mockResolvedValueOnce({ enqueued: false, reason: "já existe um pedido em andamento" });
    createMock
      .mockResolvedValueOnce(
        toolTurn("tu_create", "request_campaign_creation", { client_slug: "brunobracaioli", confirm: true }),
      )
      .mockResolvedValueOnce(textTurn("Já existe um pedido em andamento."));

    const result = await runChat(SESSION, "sim, pode criar");

    expect(result.kind).toBe("reply");
    expect(result.agentTriggers).toEqual([]);
  });
});

describe("runChat — landing edit signal (section image)", () => {
  it("emits a landingEdit when request_landing_page_section_image applies", async () => {
    runTool.mockResolvedValueOnce({
      applied: true,
      landing_page_id: "lp-1",
      section: "hero",
      version: 4,
      at: "2026-06-04T12:00:00.000Z",
      field_path: "image",
    });
    createMock
      .mockResolvedValueOnce(
        toolTurn("tu_img", "request_landing_page_section_image", {
          landing_page_id: "lp-1",
          section_type: "hero",
          image_url: "https://x.supabase.co/storage/v1/object/public/landing-assets/lp-1/hero.png",
          confirm: true,
        }),
      )
      .mockResolvedValueOnce(textTurn("Troquei a imagem do hero."));

    const result = await runChat(SESSION, "troca a imagem do hero");

    expect(result.kind).toBe("reply");
    if (result.kind !== "reply") throw new Error("unreachable");
    expect(result.landingEdits).toEqual([
      { landingPageId: "lp-1", section: "hero", version: 4, at: "2026-06-04T12:00:00.000Z" },
    ]);
  });
});

describe("resumeChat — inject image and finish", () => {
  it("injects the screenshot as the capture tool_result, replies, and clears state", async () => {
    createMock.mockResolvedValueOnce(capturePauseTurn());
    const paused = await runChat(SESSION, "analisa o que estou vendo");
    if (paused.kind !== "need_capture") throw new Error("expected need_capture");

    createMock.mockResolvedValueOnce(textTurn("Vejo um erro 404 na página."));
    const result = await resumeChat(SESSION, paused.pendingId, FAKE_IMAGE);

    expect(result.kind).toBe("reply");
    if (result.kind !== "reply") throw new Error("unreachable");
    expect(result.reply).toBe("Vejo um erro 404 na página.");
    expect(deletePending).toHaveBeenCalledWith(SESSION, paused.pendingId);
    expect(appendExchange).toHaveBeenCalledTimes(1);
    expect((appendExchange.mock.calls[0] as unknown[] | undefined)?.[1]).toBe("analisa o que estou vendo");

    // The resume turn must carry the image as the tool_result for tu_cap.
    const resumeCall = recordedCalls.at(-1)!;
    const lastMsg = resumeCall.messages.at(-1) as { role: string; content: Array<Record<string, unknown>> };
    expect(lastMsg.role).toBe("user");
    const capResult = lastMsg.content.find((b) => b.tool_use_id === "tu_cap") as {
      content: Array<{ type: string; source: { media_type: string } }>;
    };
    expect(capResult.content[0]?.type).toBe("image");
    expect(capResult.content[0]?.source.media_type).toBe("image/jpeg");
  });

  it("returns a graceful reply when the pending state is gone", async () => {
    const result = await resumeChat(SESSION, "00000000-0000-0000-0000-000000000000", FAKE_IMAGE);
    expect(result.kind).toBe("reply");
    if (result.kind !== "reply") throw new Error("unreachable");
    expect(result.reply).toMatch(/captura/i);
  });
});

describe("resumeChat — chain capture into a data tool", () => {
  it("after seeing the screen, calls a server-side data tool and answers", async () => {
    createMock.mockResolvedValueOnce(capturePauseTurn());
    const paused = await runChat(SESSION, "analisa essa campanha que estou vendo");
    if (paused.kind !== "need_capture") throw new Error("expected need_capture");

    createMock
      .mockResolvedValueOnce(toolTurn("tu_metrics", "get_campaign_metrics", { client_slug: "brunobracaioli" }))
      .mockResolvedValueOnce(textTurn("O CPLPV está alto pro CTR observado."));

    const result = await resumeChat(SESSION, paused.pendingId, FAKE_IMAGE);

    expect(runTool).toHaveBeenCalledWith(
      "get_campaign_metrics",
      { client_slug: "brunobracaioli" },
      { sessionId: SESSION, operatorId: null },
      [],
    );
    expect(result.kind).toBe("reply");
    if (result.kind !== "reply") throw new Error("unreachable");
    expect(result.reply).toBe("O CPLPV está alto pro CTR observado.");
    expect(result.usedTools).toEqual(expect.arrayContaining(["capture_screen", "get_campaign_metrics"]));
  });
});

describe("runChat — mixed turn (capture_screen + data tool together)", () => {
  it("runs the data tool now, defers capture, recombines both results on resume", async () => {
    createMock.mockResolvedValueOnce({
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: "tu_ov", name: "get_client_overview", input: { client_slug: "brunobracaioli" } },
        { type: "tool_use", id: "tu_cap", name: "capture_screen", input: {} },
      ],
    });

    const paused = await runChat(SESSION, "o que tem nessa tela do bruno?");
    if (paused.kind !== "need_capture") throw new Error("expected need_capture");
    expect(runTool).toHaveBeenCalledWith(
      "get_client_overview",
      { client_slug: "brunobracaioli" },
      { sessionId: SESSION, operatorId: null },
      [],
    );

    createMock.mockResolvedValueOnce(textTurn("Pronto, cruzei tela e dados."));
    await resumeChat(SESSION, paused.pendingId, FAKE_IMAGE);

    const resumeCall = recordedCalls.at(-1)!;
    const lastMsg = resumeCall.messages.at(-1) as { role: string; content: Array<Record<string, unknown>> };
    // One user turn carrying BOTH the deferred data tool_result and the image.
    expect(lastMsg.content).toHaveLength(2);
    const ids = lastMsg.content.map((b) => b.tool_use_id);
    expect(ids).toEqual(expect.arrayContaining(["tu_ov", "tu_cap"]));
  });
});
