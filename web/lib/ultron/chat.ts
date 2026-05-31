import "server-only";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import { ULTRON_SYSTEM_PROMPT } from "@/lib/ultron/prompt";
import { toolSpecs, runTool, CLIENT_TOOLS } from "@/lib/ultron/tools";
import { loadMemory, appendExchange, type ChatTurn } from "@/lib/ultron/memory";
import { savePending, loadPending, deletePending } from "@/lib/ultron/pending";

// Sonnet 4.6: fast, strong tool use — better fit than Opus for a low-latency voice
// loop (Opus 4.8 defaults to extended thinking, which adds latency we don't want here).
const MODEL = process.env.ULTRON_MODEL ?? "claude-sonnet-4-6";
const MAX_TOOL_ITERATIONS = 5;
const MAX_TOKENS = 1024;
const FALLBACK = "Desculpa, não consegui completar isso agora. Pode repetir?";

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: env.anthropicApiKey() });
  return client;
}

export type ChatReply = { kind: "reply"; reply: string; usedTools: string[] };
export type ChatNeedCapture = { kind: "need_capture"; pendingId: string; usedTools: string[] };
export type ChatResult = ChatReply | ChatNeedCapture;

export type CapturedImage = {
  media_type: "image/jpeg" | "image/png" | "image/webp";
  data: string; // base64, no data: prefix
};

type LoopContext = { sessionId: string; priorMemory: ChatTurn[]; userText: string };

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .trim();
}

/**
 * The bounded Claude tool loop. Runs server-side tools inline. If Claude calls a
 * client-side tool (capture_screen), it CANNOT run here — we persist the in-flight
 * loop and return `need_capture` so the browser can produce the result and resume.
 */
async function runLoop(
  messages: Anthropic.MessageParam[],
  usedTools: string[],
  startIteration: number,
  ctx: LoopContext,
): Promise<ChatResult> {
  for (let i = startIteration; i < MAX_TOOL_ITERATIONS; i++) {
    const res = await anthropic().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: ULTRON_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: toolSpecs,
      messages,
    });

    if (res.stop_reason !== "tool_use") {
      return { kind: "reply", reply: extractText(res.content) || FALLBACK, usedTools };
    }

    messages.push({ role: "assistant", content: res.content });

    // Run server-side tools now; defer any client-side tool to a resume round-trip.
    // Every tool_use in this assistant turn must be answered together in one user
    // turn, so if a capture is pending we hold ALL results until resume.
    const partialResults: Anthropic.ToolResultBlockParam[] = [];
    let captureToolUseId: string | null = null;
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      usedTools.push(block.name);
      if (CLIENT_TOOLS.has(block.name)) {
        captureToolUseId = block.id;
        continue;
      }
      const result = await runTool(block.name, (block.input ?? {}) as Record<string, unknown>);
      partialResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
    }

    if (captureToolUseId) {
      const pendingId = randomUUID();
      await savePending(ctx.sessionId, pendingId, {
        messages,
        partialResults,
        captureToolUseId,
        priorMemory: ctx.priorMemory,
        userText: ctx.userText,
        iteration: i + 1,
        usedTools,
      });
      return { kind: "need_capture", pendingId, usedTools };
    }

    messages.push({ role: "user", content: partialResults });
  }

  // Exhausted the tool-iteration budget without a final text answer.
  return { kind: "reply", reply: FALLBACK, usedTools };
}

/**
 * Runs one Ultron turn: loads the sliding-window memory, lets Claude call tools as
 * needed (bounded loop), then persists the exchange. May return `need_capture` if
 * Claude wants to see the operator's screen — in that case memory is persisted only
 * after the capture is resumed (resumeChat).
 */
export async function runChat(sessionId: string, text: string): Promise<ChatResult> {
  const memory = await loadMemory(sessionId);
  const messages: Anthropic.MessageParam[] = memory.map((t) => ({ role: t.role, content: t.content }));
  messages.push({ role: "user", content: text });

  const result = await runLoop(messages, [], 0, { sessionId, priorMemory: memory, userText: text });
  if (result.kind === "reply") {
    await appendExchange(sessionId, text, result.reply, memory);
  }
  return result;
}

/**
 * Resumes a turn that paused on capture_screen: injects the captured image as the
 * tool_result (combined with any server-side results from the same turn) and runs
 * the loop to completion. Claude can chain a data tool afterwards (e.g. identify the
 * campaign on screen, then get_campaign_metrics) within the same resumed loop.
 */
export async function resumeChat(
  sessionId: string,
  pendingId: string,
  image: CapturedImage,
): Promise<ChatResult> {
  const pending = await loadPending(sessionId, pendingId);
  if (!pending) {
    return { kind: "reply", reply: "Perdi o contexto da captura. Pode repetir o pedido?", usedTools: [] };
  }

  const captureResult: Anthropic.ToolResultBlockParam = {
    type: "tool_result",
    tool_use_id: pending.captureToolUseId,
    content: [{ type: "image", source: { type: "base64", media_type: image.media_type, data: image.data } }],
  };

  const messages = pending.messages;
  messages.push({ role: "user", content: [...pending.partialResults, captureResult] });

  const result = await runLoop(messages, pending.usedTools, pending.iteration, {
    sessionId,
    priorMemory: pending.priorMemory,
    userText: pending.userText,
  });

  // This pending state is consumed; if the loop paused again it saved a fresh one.
  await deletePending(sessionId, pendingId);
  if (result.kind === "reply") {
    await appendExchange(sessionId, pending.userText, result.reply, pending.priorMemory);
  }
  return result;
}
