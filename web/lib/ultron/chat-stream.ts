/**
 * Wire protocol for the streaming Ultron chat endpoint (SSE). The server emits
 * `text` deltas as Claude generates them so the client can speak sentence-by-
 * sentence, then a terminal `done` (or `need_capture`) carrying the structured
 * signals the non-streaming endpoint used to return in one JSON blob.
 *
 * Pure (no server-only / DOM deps) so both the route handler and the browser hook
 * import the same encoder/parser, and the parser is unit-testable.
 */

export type ChatStreamSignals = {
  reply?: string;
  usedTools?: string[];
  agentTriggers?: unknown[];
  landingEdits?: unknown[];
  liveReviews?: unknown[];
  uiIntents?: unknown[];
  pendingId?: string;
};

export type ChatStreamEvent =
  | { type: "text"; delta: string }
  | ({ type: "need_capture" } & ChatStreamSignals)
  | ({ type: "done" } & ChatStreamSignals)
  | { type: "error" };

export function encodeChatEvent(event: ChatStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Stateful SSE parser. Feed it raw response-body chunks (already decoded to string);
 * it buffers partial frames across chunks and returns the events completed so far.
 * Tolerates heartbeat/comment lines (`:`-prefixed) and malformed frames (skipped).
 */
export function createChatEventParser(): (chunk: string) => ChatStreamEvent[] {
  let buf = "";
  return (chunk: string): ChatStreamEvent[] => {
    buf += chunk;
    const events: ChatStreamEvent[] = [];
    let sep: number;
    // Frames are separated by a blank line.
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue; // skip comments / event: lines
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          events.push(JSON.parse(payload) as ChatStreamEvent);
        } catch {
          // Drop a malformed frame rather than killing the whole stream.
        }
      }
    }
    return events;
  };
}
