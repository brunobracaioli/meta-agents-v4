import "server-only";
import { redis } from "@/lib/redis";

export type ChatTurn = { role: "user" | "assistant"; content: string };

const MAX_TURNS = 10; // sliding window: last 10 exchanges (20 messages)
const TTL_SECONDS = 60 * 60 * 2; // 2h

function memKey(sessionId: string): string {
  return `ultron:mem:${sessionId}`;
}

/**
 * Loads the conversation window. Fails open to an empty history if Redis is
 * unreachable — a memory backend outage degrades context, it must not 500 the
 * chat endpoint.
 */
export async function loadMemory(sessionId: string): Promise<ChatTurn[]> {
  try {
    const raw = await redis().get<ChatTurn[]>(memKey(sessionId));
    return Array.isArray(raw) ? raw : [];
  } catch (err) {
    console.warn(
      JSON.stringify({ level: "warn", event: "ultron_memory_unavailable", op: "load", message: errMsg(err) }),
    );
    return [];
  }
}

/** Appends one exchange and trims to the last MAX_TURNS exchanges. */
export async function appendExchange(
  sessionId: string,
  user: string,
  assistant: string,
  previous: ChatTurn[],
): Promise<void> {
  const next = [...previous, { role: "user" as const, content: user }, { role: "assistant" as const, content: assistant }];
  const trimmed = next.slice(-MAX_TURNS * 2);
  try {
    await redis().set(memKey(sessionId), trimmed, { ex: TTL_SECONDS });
  } catch (err) {
    console.warn(
      JSON.stringify({ level: "warn", event: "ultron_memory_unavailable", op: "save", message: errMsg(err) }),
    );
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : "unknown";
}
