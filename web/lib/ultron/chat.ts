import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import { ULTRON_SYSTEM_PROMPT } from "@/lib/ultron/prompt";
import { toolSpecs, runTool } from "@/lib/ultron/tools";
import { loadMemory, appendExchange } from "@/lib/ultron/memory";

const MODEL = process.env.ULTRON_MODEL ?? "claude-opus-4-7";
const MAX_TOOL_ITERATIONS = 5;
const MAX_TOKENS = 1024;

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: env.anthropicApiKey() });
  return client;
}

export type ChatResult = { reply: string; usedTools: string[] };

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .trim();
}

/**
 * Runs one Ultron turn: loads the sliding-window memory, lets Claude call the
 * read-only data tools as needed (bounded loop), then persists the exchange.
 */
export async function runChat(sessionId: string, text: string): Promise<ChatResult> {
  const memory = await loadMemory(sessionId);
  const messages: Anthropic.MessageParam[] = memory.map((t) => ({ role: t.role, content: t.content }));
  messages.push({ role: "user", content: text });

  const usedTools: string[] = [];
  let reply = "";

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const res = await anthropic().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: ULTRON_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: toolSpecs,
      messages,
    });

    if (res.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: res.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of res.content) {
        if (block.type !== "tool_use") continue;
        usedTools.push(block.name);
        const result = await runTool(block.name, (block.input ?? {}) as Record<string, unknown>);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    reply = extractText(res.content);
    break;
  }

  if (!reply) {
    reply = "Desculpa, não consegui completar isso agora. Pode repetir?";
  }

  await appendExchange(sessionId, text, reply, memory);
  return { reply, usedTools };
}
