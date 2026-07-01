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
import { uiIntentFromToolResult, type UIIntent } from "@/lib/ultron/render-intents";
import { classifyUtterance, assertsCompletedAction, stripCompletedClaims } from "@/lib/ultron/intent-gate";
import { loadMemory, appendExchange, type ChatTurn } from "@/lib/ultron/memory";
import { savePending, loadPending, deletePending } from "@/lib/ultron/pending";

// Sonnet 5: fast, strong tool use — better fit than Opus for a low-latency voice
// loop (Opus 4.8 defaults to extended thinking, which adds latency we don't want here).
const MODEL = process.env.ULTRON_MODEL ?? "claude-sonnet-5";
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
  uiIntents: UIIntent[];
};
export type ChatNeedCapture = {
  kind: "need_capture";
  pendingId: string;
  usedTools: string[];
  agentTriggers: AgentTrigger[];
  landingEdits: LandingEditSignal[];
  liveReviews: LiveReviewSignal[];
  uiIntents: UIIntent[];
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
  // When set, the loop streams Claude's text deltas live (sentence-by-sentence TTS
  // on the client) and the reply becomes the full streamed text. Absent = the
  // original one-shot behavior (used by the capture/resume path).
  emit?: (delta: string) => void;
  spoken?: { text: string };
  // When the operator's utterance is a COMMAND (classifyUtterance), force a tool call on
  // the first iteration so the model cannot narrate an action without executing it. See
  // intent-gate.ts for the full rationale. Never set on the resume path (the tool that
  // motivated the turn was already in flight).
  forceToolFirst?: boolean;
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

// SPEC-019: a read-only render-tool carries its directive under `ui_intent` in its result.
// Collected like the signals above and returned (non-blocking) so the ARC client can
// materialize the panel. De-duped by op+target/id+element so a retried tool call within the
// same turn can't stack duplicate directives.
function pushUiIntent(uiIntents: UIIntent[], intent: UIIntent | null): void {
  if (!intent) return;
  const key = (i: UIIntent) => (i.op === "show" ? `show:${i.element}:${i.id}` : `${i.op}:${i.target}`);
  if (uiIntents.some((existing) => key(existing) === key(intent))) return;
  uiIntents.push(intent);
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
  uiIntents: UIIntent[],
  startIteration: number,
  ctx: LoopContext,
): Promise<ChatResult> {
  for (let i = startIteration; i < MAX_TOOL_ITERATIONS; i++) {
    const tools = [...toolSpecs, ...ctx.dynamicTools.map((t) => t.spec)];
    // On the first iteration of a COMMAND turn, force a tool call: the model must emit a
    // tool_use (and thus NO spoken text) before anything is voiced, so it can't narrate an
    // action it never performed. Only the first iteration — afterwards the model needs
    // `auto` to speak the grounded summary. Guard on tools.length so `any` never goes out
    // with an empty tool list (an API error).
    const forceTool = ctx.forceToolFirst === true && i === startIteration && tools.length > 0;
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: ULTRON_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools,
      ...(forceTool ? { tool_choice: { type: "any" } } : {}),
      messages,
    };

    let res: Anthropic.Message;
    if (ctx.emit) {
      // Stream text deltas as they arrive (forwarded to the client for sentence-level
      // TTS), then resolve the final message and run the SAME tool-handling logic.
      const stream = anthropic().messages.stream(params);
      stream.on("text", (delta) => {
        if (ctx.spoken) ctx.spoken.text += delta;
        ctx.emit!(delta);
      });
      res = await stream.finalMessage();
    } else {
      res = await anthropic().messages.create(params);
    }

    // Prompt-cache + size telemetry: if cache_read is large and cache_write ~0 on
    // later turns, the system+tools prefix is being reused (good). A large input with
    // no cache_read means we're re-prefilling every turn — the TTFT culprit.
    const u = res.usage;
    if (u) {
      console.info(
        JSON.stringify({
          level: "info",
          event: "chat_usage",
          iter: i,
          input: u.input_tokens,
          output: u.output_tokens,
          cache_read: u.cache_read_input_tokens ?? 0,
          cache_write: u.cache_creation_input_tokens ?? 0,
        }),
      );
    }

    if (res.stop_reason !== "tool_use") {
      // In streaming mode the spoken accumulator already holds every text delta
      // (including any pre-tool preamble from earlier iterations).
      let reply = (ctx.emit ? ctx.spoken?.text.trim() : extractText(res.content)) || FALLBACK;

      // Phantom-claim guard: the reply asserts an action was done but no tool ran this turn.
      // The forced-tool gate above prevents this for classified commands; this is the
      // defense-in-depth net for whatever slips through (unrecognized phrasing).
      if (usedTools.length === 0 && assertsCompletedAction(reply)) {
        if (!ctx.emit) {
          // Non-streaming (capture/resume): nothing was voiced yet — scrub the false claim.
          reply = stripCompletedClaims(reply) ?? FALLBACK;
        }
        // Streaming path can't un-speak; log so we can measure leakage and expand patterns.
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "phantom_claim",
            streamed: Boolean(ctx.emit),
            sample: reply.slice(0, 160),
          }),
        );
      }

      return { kind: "reply", reply, usedTools, agentTriggers, landingEdits, liveReviews, uiIntents };
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
      pushUiIntent(uiIntents, uiIntentFromToolResult(result));
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
        uiIntents,
      });
      return { kind: "need_capture", pendingId, usedTools, agentTriggers, landingEdits, liveReviews, uiIntents };
    }

    messages.push({ role: "user", content: partialResults });
  }

  // Exhausted the tool-iteration budget without a final text answer.
  return { kind: "reply", reply: FALLBACK, usedTools, agentTriggers, landingEdits, liveReviews, uiIntents };
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
  // Independent I/O — fetch in parallel to shave a round-trip off time-to-first-token.
  const [memory, dynamicTools] = await Promise.all([
    loadMemory(sessionId),
    loadDynamicSkillTools(operatorId),
  ]);
  const messages: Anthropic.MessageParam[] = memory.map((t) => ({ role: t.role, content: t.content }));
  messages.push({ role: "user", content: text });
  const result = await runLoop(messages, [], [], [], [], [], 0, {
    sessionId,
    priorMemory: memory,
    userText: text,
    operatorId,
    dynamicTools,
    forceToolFirst: classifyUtterance(text) === "command",
  });
  if (result.kind === "reply") {
    await appendExchange(sessionId, text, result.reply, memory);
  }
  return result;
}

/**
 * Streaming variant of {@link runChat}: identical loop + memory semantics, but Claude's
 * text is streamed to `emit` token-by-token so the client can speak sentence-by-sentence
 * instead of waiting for the whole reply. May still return `need_capture` (the client
 * then falls back to the one-shot capture round-trip for that turn).
 */
export async function runChatStream(
  sessionId: string,
  text: string,
  operatorId: string | null,
  emit: (delta: string) => void,
): Promise<ChatResult> {
  // Independent I/O — fetch in parallel to shave a round-trip off time-to-first-token.
  const [memory, dynamicTools] = await Promise.all([
    loadMemory(sessionId),
    loadDynamicSkillTools(operatorId),
  ]);
  const messages: Anthropic.MessageParam[] = memory.map((t) => ({ role: t.role, content: t.content }));
  messages.push({ role: "user", content: text });
  const result = await runLoop(messages, [], [], [], [], [], 0, {
    sessionId,
    priorMemory: memory,
    userText: text,
    operatorId,
    dynamicTools,
    emit,
    spoken: { text: "" },
    forceToolFirst: classifyUtterance(text) === "command",
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
      uiIntents: [],
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
    pending.uiIntents ?? [],
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
