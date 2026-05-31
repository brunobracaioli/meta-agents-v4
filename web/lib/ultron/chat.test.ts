import { describe, it, expect, vi, beforeEach } from "vitest";

// --- hoisted mocks (referenced inside vi.mock factories) ---

const { createMock, recordedCalls } = vi.hoisted(() => ({
  createMock: vi.fn(),
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
  runTool: vi.fn(async () => ({ ok: true, note: "dados de teste" })),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async (args: { messages: unknown[] }) => {
        recordedCalls.push(args);
        return createMock(args);
      },
    };
  },
}));
vi.mock("@/lib/env", () => ({ env: { anthropicApiKey: () => "test-key" } }));
vi.mock("@/lib/ultron/tools", () => ({
  toolSpecs: [],
  runTool,
  CLIENT_TOOLS: new Set(["capture_screen"]),
}));
vi.mock("@/lib/ultron/memory", () => ({ loadMemory, appendExchange }));
vi.mock("@/lib/ultron/pending", () => ({ savePending, loadPending, deletePending }));

import { runChat, resumeChat } from "@/lib/ultron/chat";

const SESSION = "session-test-1";
const FAKE_IMAGE = { media_type: "image/jpeg" as const, data: "QUJD" };

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

    expect(runTool).toHaveBeenCalledWith("get_campaign_metrics", { client_slug: "brunobracaioli" });
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
    expect(runTool).toHaveBeenCalledWith("get_client_overview", { client_slug: "brunobracaioli" });

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
