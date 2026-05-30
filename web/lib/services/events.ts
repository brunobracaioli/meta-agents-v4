import "server-only";
import { db } from "@/lib/db/client";
import type { AgentEvent } from "@/lib/db/types";

export type LiveEvent = Pick<
  AgentEvent,
  "id" | "run_id" | "ts" | "agent_name" | "agent_type" | "event_type" | "tool_name" | "summary"
>;

const MAX_EVENTS = 100;

/**
 * Recent agent activity for the live view. When `since` (ISO timestamp) is given,
 * returns only newer events (ascending) so the client can append on poll. Read-only.
 */
export async function getEvents(since?: string): Promise<LiveEvent[]> {
  let query = db()
    .from("agent_events")
    .select("id, run_id, ts, agent_name, agent_type, event_type, tool_name, summary");

  if (since) {
    const { data, error } = await query.gt("ts", since).order("ts", { ascending: true }).limit(MAX_EVENTS);
    if (error) throw error;
    return data ?? [];
  }

  // Initial load: most recent first, then present oldest→newest in the UI.
  const { data, error } = await query.order("ts", { ascending: false }).limit(MAX_EVENTS);
  if (error) throw error;
  return (data ?? []).reverse();
}
