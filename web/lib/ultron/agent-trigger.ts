export const AGENT_TRIGGER_CHANNEL = "ultron-agent-triggers";
export const AGENT_TRIGGER_EVENT = "ultron-agent-trigger";

export type AgentTrigger = {
  jobId: string;
  skill: string;
  kind: string;
  clientSlug: string;
  queuedAt: string;
  source: "ultron";
};

export function isAgentTrigger(value: unknown): value is AgentTrigger {
  if (!value || typeof value !== "object") return false;
  const trigger = value as Partial<AgentTrigger>;
  return (
    typeof trigger.jobId === "string" &&
    trigger.jobId.length > 0 &&
    typeof trigger.skill === "string" &&
    trigger.skill.length > 0 &&
    typeof trigger.kind === "string" &&
    trigger.kind.length > 0 &&
    typeof trigger.clientSlug === "string" &&
    trigger.clientSlug.length > 0 &&
    typeof trigger.queuedAt === "string" &&
    trigger.queuedAt.length > 0 &&
    trigger.source === "ultron"
  );
}
