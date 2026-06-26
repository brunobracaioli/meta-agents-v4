import "server-only";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import { ULTRON_SYSTEM_PROMPT } from "@/lib/ultron/prompt";
import { toolSpecs, runTool, CLIENT_TOOLS, loadDynamicSkillTools, type DynamicSkillTool } from "@/lib/ultron/tools";
import {
  isLandingEditSignal,
  isLiveReviewSignal,
  type AgentTrigger,
  type LandingEditSignal,
  type LiveReviewSignal,
} from "@/lib/ultron/agent-trigger";
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

export type ChatReply = {
  kind: "reply";
  reply: string;
  usedTools: string[];
  agentTriggers: AgentTrigger[];
  landingEdits: LandingEditSignal[];
  liveReviews: LiveReviewSignal[];
};
export type ChatNeedCapture = {
  kind: "need_capture";
  pendingId: string;
  usedTools: string[];
  agentTriggers: AgentTrigger[];
  landingEdits: LandingEditSignal[];
  liveReviews: LiveReviewSignal[];
};
export type ChatResult = ChatReply | ChatNeedCapture;

export type CapturedImage = {
  media_type: "image/jpeg" | "image/png" | "image/webp";
  data: string; // base64, no data: prefix
};

type LoopContext = {
  sessionId: string;
  priorMemory: ChatTurn[];
  userText: string;
  operatorId: string | null;
  dynamicTools: DynamicSkillTool[];
};

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .trim();
}

function stringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}

function agentTriggerFromToolResult(toolName: string, result: unknown): AgentTrigger | null {
  if (toolName !== "request_campaign_creation" && toolName !== "request_campaign_activation") return null;
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  if ((result as Record<string, unknown>).enqueued !== true) return null;

  const jobId = stringField(result, "job_id");
  const skill = stringField(result, "skill");
  const kind = stringField(result, "kind");
  const clientSlug = stringField(result, "client_slug");
  const queuedAt = stringField(result, "queued_at");
  if (!jobId || !skill || !kind || !clientSlug || !queuedAt) return null;

  return {
    jobId,
    skill,
    kind,
    clientSlug,
    queuedAt,
    source: "ultron",
  };
}

function pushAgentTrigger(agentTriggers: AgentTrigger[], trigger: AgentTrigger | null): void {
  if (!trigger || agentTriggers.some((item) => item.jobId === trigger.jobId)) return;
  agentTriggers.push(trigger);
}

function landingEditFromToolResult(toolName: string, result: unknown): LandingEditSignal | null {
  if (
    toolName !== "request_landing_page_edit" &&
    toolName !== "request_landing_page_theme" &&
    toolName !== "request_landing_page_section_image"
  )
    return null;
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  if ((result as Record<string, unknown>).applied !== true) return null;

  const signal = {
    landingPageId: stringField(result, "landing_page_id"),
    section: stringField(result, "section"),
    version: (result as Record<string, unknown>).version,
    at: stringField(result, "at"),
  };
  return isLandingEditSignal(signal) ? signal : null;
}

function pushLandingEdit(landingEdits: LandingEditSignal[], signal: LandingEditSignal | null): void {
  if (!signal) return;
  landingEdits.push(signal);
}

function liveReviewFromToolResult(toolName: string, result: unknown): LiveReviewSignal | null {
  if (toolName !== "request_live_review") return null;
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  if ((result as Record<string, unknown>).start_review !== true) return null;

  const signal = {
    landingPageId: stringField(result, "landingPageId"),
    previewUrl: stringField(result, "previewUrl"),
    at: stringField(result, "at"),
  };
  return isLiveReviewSignal(signal) ? signal : null;
}

function pushLiveReview(liveReviews: LiveReviewSignal[], signal: LiveReviewSignal | null): void {
  if (!signal) return;
  liveReviews.push(signal);
}

/**
 * The bounded Claude tool loop. Runs server-side tools inline. If Claude calls a
 * client-side tool (capture_screen), it CANNOT run here — we persist the in-flight
 * loop and return `need_capture` so the browser can produce the result and resume.
 */
async function runLoop(
  messages: Anthropic.MessageParam[],
  usedTools: string[],
  agentTriggers: AgentTrigger[],
  landingEdits: LandingEditSignal[],
  liveReviews: LiveReviewSignal[],
  startIteration: number,
  ctx: LoopContext,
): Promise<ChatResult> {
  for (let i = startIteration; i < MAX_TOOL_ITERATIONS; i++) {
    const res = await anthropic().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: ULTRON_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: [...toolSpecs, ...ctx.dynamicTools.map((t) => t.spec)],
      messages,
    });

    if (res.stop_reason !== "tool_use") {
      return { kind: "reply", reply: extractText(res.content) || FALLBACK, usedTools, agentTriggers, landingEdits, liveReviews };
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
      const result = await runTool(
        block.name,
        (block.input ?? {}) as Record<string, unknown>,
        { sessionId: ctx.sessionId, operatorId: ctx.operatorId },
        ctx.dynamicTools,
      );
      pushAgentTrigger(agentTriggers, agentTriggerFromToolResult(block.name, result));
      pushLandingEdit(landingEdits, landingEditFromToolResult(block.name, result));
      pushLiveReview(liveReviews, liveReviewFromToolResult(block.name, result));
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
        agentTriggers,
        landingEdits,
        liveReviews,
      });
      return { kind: "need_capture", pendingId, usedTools, agentTriggers, landingEdits, liveReviews };
    }

    messages.push({ role: "user", content: partialResults });
  }

  // Exhausted the tool-iteration budget without a final text answer.
  return { kind: "reply", reply: FALLBACK, usedTools, agentTriggers, landingEdits, liveReviews };
}

/**
 * Runs one Ultron turn: loads the sliding-window memory, lets Claude call tools as
 * needed (bounded loop), then persists the exchange. May return `need_capture` if
 * Claude wants to see the operator's screen — in that case memory is persisted only
 * after the capture is resumed (resumeChat).
 */
export async function runChat(
  sessionId: string,
  text: string,
  operatorId: string | null = null,
): Promise<ChatResult> {
  const memory = await loadMemory(sessionId);
  const messages: Anthropic.MessageParam[] = memory.map((t) => ({ role: t.role, content: t.content }));
  messages.push({ role: "user", content: text });

  const dynamicTools = await loadDynamicSkillTools(operatorId);
  const result = await runLoop(messages, [], [], [], [], 0, {
    sessionId,
    priorMemory: memory,
    userText: text,
    operatorId,
    dynamicTools,
  });
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
  operatorId: string | null = null,
): Promise<ChatResult> {
  const pending = await loadPending(sessionId, pendingId);
  if (!pending) {
    return {
      kind: "reply",
      reply: "Perdi o contexto da captura. Pode repetir o pedido?",
      usedTools: [],
      agentTriggers: [],
      landingEdits: [],
      liveReviews: [],
    };
  }

  const captureResult: Anthropic.ToolResultBlockParam = {
    type: "tool_result",
    tool_use_id: pending.captureToolUseId,
    content: [{ type: "image", source: { type: "base64", media_type: image.media_type, data: image.data } }],
  };

  const messages = pending.messages;
  messages.push({ role: "user", content: [...pending.partialResults, captureResult] });

  const dynamicTools = await loadDynamicSkillTools(operatorId);
  const result = await runLoop(
    messages,
    pending.usedTools,
    pending.agentTriggers ?? [],
    pending.landingEdits ?? [],
    pending.liveReviews ?? [],
    pending.iteration,
    {
      sessionId,
      priorMemory: pending.priorMemory,
      userText: pending.userText,
      operatorId,
      dynamicTools,
    },
  );

  // This pending state is consumed; if the loop paused again it saved a fresh one.
  await deletePending(sessionId, pendingId);
  if (result.kind === "reply") {
    await appendExchange(sessionId, pending.userText, result.reply, pending.priorMemory);
  }
  return result;
}
