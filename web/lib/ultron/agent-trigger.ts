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

// --- Landing page edits ---------------------------------------------------
// When Ultron applies a draft edit it writes straight to Supabase (no HTTP route),
// so the open editor never hears about it. We mirror the agent-trigger transport:
// the chat reply carries these signals back to the same browser, which fans them
// out via CustomEvent (same tab) + BroadcastChannel (cross tab) so the editor can
// refetch and reconcile. `section` is the section type, or "__theme" for theme edits.
export const LANDING_EDIT_CHANNEL = "ultron-landing-edits";
export const LANDING_EDIT_EVENT = "ultron-landing-edit";

export type LandingEditSignal = {
  landingPageId: string;
  section: string;
  version: number;
  at: string;
};

export function isLandingEditSignal(value: unknown): value is LandingEditSignal {
  if (!value || typeof value !== "object") return false;
  const signal = value as Partial<LandingEditSignal>;
  return (
    typeof signal.landingPageId === "string" &&
    signal.landingPageId.length > 0 &&
    typeof signal.section === "string" &&
    signal.section.length > 0 &&
    typeof signal.version === "number" &&
    typeof signal.at === "string" &&
    signal.at.length > 0
  );
}

export function landingEditKey(signal: LandingEditSignal): string {
  return `${signal.landingPageId}|${signal.section}|${signal.version}|${signal.at}`;
}
