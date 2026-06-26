import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { redis } from "@/lib/redis";
import type { AgentTrigger, LandingEditSignal, LiveReviewSignal } from "@/lib/ultron/agent-trigger";
import type { UIIntent } from "@/lib/ultron/render-intents";
import type { ChatTurn } from "@/lib/ultron/memory";

/**
 * Resume state for a chat turn that paused on a client-side tool (capture_screen).
 * The Claude tool loop runs server-side, but a screen capture can only happen in
 * the operator's browser — so we persist the in-flight loop here, hand control to
 * the client, and rebuild it on the follow-up /ultron/capture call. Short-lived:
 * a capture that never comes back simply expires.
 */
export type PendingTurn = {
  // Full message history up to and including the assistant turn that issued the
  // capture_screen tool_use. The capture's tool_result is appended on resume.
  messages: Anthropic.MessageParam[];
  // Results of any OTHER tools called in the same assistant turn, already run
  // server-side. Recombined with the capture result into a single user turn.
  partialResults: Anthropic.ToolResultBlockParam[];
  // tool_use id of the capture_screen call, to address its tool_result on resume.
  captureToolUseId: string;
  // Conversation window from before this exchange — needed to persist memory at the end.
  priorMemory: ChatTurn[];
  userText: string;
  iteration: number;
  usedTools: string[];
  agentTriggers?: AgentTrigger[];
  landingEdits?: LandingEditSignal[];
  liveReviews?: LiveReviewSignal[];
  uiIntents?: UIIntent[];
};

const TTL_SECONDS = 120; // a capture round-trip is seconds; don't keep state around.

function pendingKey(sessionId: string, id: string): string {
  return `ultron:pending:${sessionId}:${id}`;
}

export async function savePending(sessionId: string, id: string, state: PendingTurn): Promise<void> {
  try {
    await redis().set(pendingKey(sessionId, id), state, { ex: TTL_SECONDS });
  } catch (err) {
    console.warn(
      JSON.stringify({ level: "warn", event: "ultron_pending_unavailable", op: "save", message: errMsg(err) }),
    );
    throw err; // a capture we can't resume must fail loudly, not silently drop the turn.
  }
}

/** Returns null if the pending state is gone (expired, evicted, or never existed). */
export async function loadPending(sessionId: string, id: string): Promise<PendingTurn | null> {
  try {
    const raw = await redis().get<PendingTurn>(pendingKey(sessionId, id));
    return raw ?? null;
  } catch (err) {
    console.warn(
      JSON.stringify({ level: "warn", event: "ultron_pending_unavailable", op: "load", message: errMsg(err) }),
    );
    return null;
  }
}

export async function deletePending(sessionId: string, id: string): Promise<void> {
  try {
    await redis().del(pendingKey(sessionId, id));
  } catch {
    // Best-effort: it expires on its own via TTL.
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : "unknown";
}
