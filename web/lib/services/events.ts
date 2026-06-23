import "server-only";
import { getReadClient } from "@/lib/db/read-client";
import type { AgentEvent, AgentJob, Json } from "@/lib/db/types";

export type LiveEvent = Pick<
  AgentEvent,
  "id" | "run_id" | "ts" | "agent_name" | "agent_type" | "event_type" | "tool_name" | "summary"
>;

const MAX_EVENTS = 100;
const MAX_ACTIVE_JOBS = 50;
const MAX_TERMINAL_JOBS = 25;
const MAX_RUN_EVENTS = 200;

const ACTIVE_JOB_STATUSES = ["pending", "claimed", "running"] as const;
const TERMINAL_JOB_STATUSES = ["completed", "failed", "cancelled"] as const;

type AgentJobProcessRow = Pick<
  AgentJob,
  "id" | "skill" | "kind" | "status" | "created_at" | "claimed_at" | "started_at" | "finished_at" | "error"
>;

type RunLifecycleEvent = Pick<
  AgentEvent,
  "id" | "run_id" | "ts" | "agent_name" | "event_type" | "summary" | "payload"
>;

export type LiveProcess = {
  id: string;
  source: "agent_job" | "agent_run";
  skill: string;
  kind: string | null;
  state: "active" | "success" | "error";
  phase: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};

/**
 * Recent agent activity for the live view. When `since` (ISO timestamp) is given,
 * returns only newer events (ascending) so the client can append on poll. Read-only.
 */
export async function getEvents(since?: string): Promise<LiveEvent[]> {
  const supabase = await getReadClient();
  let query = supabase
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

export function mapAgentJobToLiveProcess(job: AgentJobProcessRow): LiveProcess {
  const state = ACTIVE_JOB_STATUSES.includes(job.status as (typeof ACTIVE_JOB_STATUSES)[number])
    ? "active"
    : job.status === "completed"
      ? "success"
      : "error";

  return {
    id: job.id,
    source: "agent_job",
    skill: job.skill,
    kind: job.kind,
    state,
    phase: job.status,
    startedAt: job.started_at ?? job.claimed_at ?? job.created_at ?? null,
    finishedAt: job.finished_at,
    error: state === "error" ? job.error : null,
  };
}

export function mapRunLifecycleEventsToLiveProcesses(events: RunLifecycleEvent[]): LiveProcess[] {
  const sorted = [...events].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const byRun = new Map<string, LiveProcess>();

  for (const event of sorted) {
    const runId = event.run_id ?? event.id;
    const current = byRun.get(runId);
    const skill = payloadString(event.payload, "skill") ?? event.agent_name;
    const next: LiveProcess = current ?? {
      id: runId,
      source: "agent_run",
      skill,
      kind: payloadString(event.payload, "kind") ?? inferKind(skill),
      state: "active",
      phase: event.event_type,
      startedAt: null,
      finishedAt: null,
      error: null,
    };

    next.skill = skill;
    next.kind = payloadString(event.payload, "kind") ?? next.kind ?? inferKind(skill);
    next.phase = event.event_type;

    if (event.event_type === "start") {
      next.state = "active";
      next.startedAt = next.startedAt ?? event.ts;
      next.finishedAt = null;
      next.error = null;
    } else if (event.event_type === "end") {
      next.state = "success";
      next.finishedAt = event.ts;
      next.error = null;
    } else if (event.event_type === "error") {
      next.state = "error";
      next.finishedAt = event.ts;
      next.error = event.summary;
    }

    byRun.set(runId, next);
  }

  return Array.from(byRun.values()).sort(compareProcesses);
}

export async function getProcesses(): Promise<LiveProcess[]> {
  const select = "id, skill, kind, status, created_at, claimed_at, started_at, finished_at, error";
  const supabase = await getReadClient();
  const [activeJobs, terminalJobs, runEvents] = await Promise.all([
    supabase
      .from("agent_jobs")
      .select(select)
      .in("status", [...ACTIVE_JOB_STATUSES])
      .order("created_at", { ascending: false })
      .limit(MAX_ACTIVE_JOBS),
    supabase
      .from("agent_jobs")
      .select(select)
      .in("status", [...TERMINAL_JOB_STATUSES])
      .order("finished_at", { ascending: false })
      .limit(MAX_TERMINAL_JOBS),
    supabase
      .from("agent_events")
      .select("id, run_id, ts, agent_name, event_type, summary, payload")
      .eq("tool_name", "run-skill.sh")
      .in("event_type", ["start", "end", "error"])
      .order("ts", { ascending: false })
      .limit(MAX_RUN_EVENTS),
  ]);

  if (activeJobs.error) throw activeJobs.error;
  if (terminalJobs.error) throw terminalJobs.error;
  if (runEvents.error) throw runEvents.error;

  return [
    ...(activeJobs.data ?? []).map(mapAgentJobToLiveProcess),
    ...(terminalJobs.data ?? []).map(mapAgentJobToLiveProcess),
    ...mapRunLifecycleEventsToLiveProcesses(runEvents.data ?? []),
  ].sort(compareProcesses);
}

function compareProcesses(a: LiveProcess, b: LiveProcess): number {
  if (a.state === "active" && b.state !== "active") return -1;
  if (a.state !== "active" && b.state === "active") return 1;
  return processTime(b) - processTime(a);
}

function processTime(process: LiveProcess): number {
  const parsed = Date.parse(process.finishedAt ?? process.startedAt ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function payloadString(payload: Json | null, key: string): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function inferKind(skill: string): string | null {
  if (skill.startsWith("create-landing-page")) return "landing";
  if (skill.startsWith("create-")) return "create";
  if (skill.startsWith("activate-")) return "activate";
  if (skill.startsWith("analyze-")) return "analyze";
  if (skill.startsWith("summarize-")) return "summarize";
  return null;
}
