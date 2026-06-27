import { describe, expect, it } from "vitest";
import { createChatEventParser, encodeChatEvent, type ChatStreamEvent } from "./chat-stream";

describe("chat-stream protocol", () => {
  it("round-trips events through encode + parse", () => {
    const parse = createChatEventParser();
    const events: ChatStreamEvent[] = [
      { type: "text", delta: "Olá" },
      { type: "text", delta: " mundo." },
      { type: "done", reply: "Olá mundo.", agentTriggers: [], uiIntents: [] },
    ];
    const wire = events.map(encodeChatEvent).join("");
    expect(parse(wire)).toEqual(events);
  });

  it("buffers frames split across chunks", () => {
    const parse = createChatEventParser();
    const frame = encodeChatEvent({ type: "text", delta: "oi" });
    const mid = Math.floor(frame.length / 2);
    expect(parse(frame.slice(0, mid))).toEqual([]);
    expect(parse(frame.slice(mid))).toEqual([{ type: "text", delta: "oi" }]);
  });

  it("ignores comment/heartbeat lines and malformed frames", () => {
    const parse = createChatEventParser();
    const wire =
      ": heartbeat\n\n" +
      "data: not-json\n\n" +
      encodeChatEvent({ type: "text", delta: "ok" });
    expect(parse(wire)).toEqual([{ type: "text", delta: "ok" }]);
  });

  it("parses need_capture with signals", () => {
    const parse = createChatEventParser();
    const wire = encodeChatEvent({ type: "need_capture", pendingId: "abc", liveReviews: [] });
    expect(parse(wire)).toEqual([{ type: "need_capture", pendingId: "abc", liveReviews: [] }]);
  });
});
