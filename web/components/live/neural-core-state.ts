export type LiveEvent = {
  id: string;
  run_id: string | null;
  ts: string;
  agent_name: string;
  agent_type: string;
  event_type: string;
  tool_name: string | null;
  summary: string | null;
};

export type NeuralCoreMode = "stand-by" | "activated";

export type ActiveSubagent = {
  name: string;
  color: string;
  lastEventAt: string;
  eventCount: number;
};

export type NeuralCoreState = {
  mode: NeuralCoreMode;
  activeAgents: string[];
  activeSubagents: ActiveSubagent[];
  overflowSubagentCount: number;
  recentEventCount: number;
  lastEventAt: string | null;
};

const CORE_ACTIVITY_MS = 60_000;
const SUBAGENT_ACTIVITY_MS = 120_000;
const MAX_SUBAGENTS = 6;
const SUBAGENT_COLORS = ["#f472b6", "#6ee7b7", "#fb923c", "#c4b5fd", "#facc15", "#60a5fa"];

function eventTime(event: Pick<LiveEvent, "ts">): number {
  const parsed = Date.parse(event.ts);
  return Number.isFinite(parsed) ? parsed : 0;
}

function colorForSubagent(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return SUBAGENT_COLORS[hash % SUBAGENT_COLORS.length] ?? "#f472b6";
}

export function deriveNeuralCoreState(events: LiveEvent[], nowMs: number): NeuralCoreState {
  const recentEvents = events.filter((event) => nowMs - eventTime(event) <= CORE_ACTIVITY_MS);
  const mode: NeuralCoreMode = recentEvents.length > 0 ? "activated" : "stand-by";
  const activeAgents = Array.from(new Set(recentEvents.map((event) => event.agent_name))).sort((a, b) =>
    a.localeCompare(b),
  );

  const subagentMap = new Map<string, { lastEventAt: string; lastMs: number; eventCount: number }>();
  for (const event of events) {
    if (event.agent_type !== "subagent") continue;
    const tsMs = eventTime(event);
    if (nowMs - tsMs > SUBAGENT_ACTIVITY_MS) continue;
    const current = subagentMap.get(event.agent_name);
    if (!current || tsMs > current.lastMs) {
      subagentMap.set(event.agent_name, {
        lastEventAt: event.ts,
        lastMs: tsMs,
        eventCount: (current?.eventCount ?? 0) + 1,
      });
    } else {
      current.eventCount += 1;
    }
  }

  const allActiveSubagents = Array.from(subagentMap.entries())
    .sort(([, a], [, b]) => b.lastMs - a.lastMs)
    .map(([name, value]) => ({
      name,
      color: colorForSubagent(name),
      lastEventAt: value.lastEventAt,
      eventCount: value.eventCount,
    }));
  const activeSubagents = allActiveSubagents.slice(0, MAX_SUBAGENTS);

  const lastEvent = events.reduce<LiveEvent | null>((latest, event) => {
    if (!latest) return event;
    return eventTime(event) > eventTime(latest) ? event : latest;
  }, null);

  return {
    mode,
    activeAgents,
    activeSubagents,
    overflowSubagentCount: Math.max(0, allActiveSubagents.length - activeSubagents.length),
    recentEventCount: recentEvents.length,
    lastEventAt: lastEvent?.ts ?? null,
  };
}
