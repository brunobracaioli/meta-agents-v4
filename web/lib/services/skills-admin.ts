import "server-only";
import { getReadClient } from "@/lib/db/read-client";

// SPEC-018 — read side of the skills surface. Authenticated read client → RLS isolates to the
// operator's own skills. Joins the owning client's slug/name for display.

export type AdminSkill = {
  id: string;
  client_id: string;
  product_id: string;
  slug: string;
  name: string;
  description: string | null;
  capability: "read" | "write";
  ultron_enabled: boolean;
  status: "draft" | "active" | "disabled";
  version: number;
  allowed_tools: string[];
  client: { slug: string; name: string } | null;
};

const ADMIN_SKILL_COLUMNS =
  "id, client_id, product_id, slug, name, description, capability, ultron_enabled, status, version, allowed_tools, client:clients(slug, name)";

/** Skills attached to a single product (RLS-scoped). Drives the nested product page. */
export async function listSkillsForProduct(productId: string): Promise<AdminSkill[]> {
  const supabase = await getReadClient();
  const res = await supabase
    .from("client_skills")
    .select(ADMIN_SKILL_COLUMNS)
    .eq("product_id", productId)
    .order("created_at", { ascending: true });
  if (res.error) throw res.error;
  return (res.data ?? []) as unknown as AdminSkill[];
}

export type EditableSkill = {
  id: string;
  client_id: string;
  product_id: string;
  slug: string;
  name: string;
  description: string | null;
  body: string;
  allowed_tools: string[];
  capability: "read" | "write";
  ultron_enabled: boolean;
  ultron_function: { name: string; description: string; parameters: Record<string, unknown> } | null;
  status: "draft" | "active" | "disabled";
  version: number;
};

export type SkillScheduleView = {
  recurrence: { freq: string; time?: string; weekday?: number; monthday?: number; every_n_hours?: number };
  timezone: string;
  enabled: boolean;
  next_run_at: string;
  last_run_at: string | null;
};

/** The skill's recurrence (RLS-scoped read), or null if none / not owned. One schedule per skill. */
export async function getScheduleForSkill(skillId: string): Promise<SkillScheduleView | null> {
  const supabase = await getReadClient();
  const res = await supabase
    .from("skill_schedules")
    .select("recurrence, timezone, enabled, next_run_at, last_run_at")
    .eq("skill_id", skillId)
    .maybeSingle();
  if (res.error) throw res.error;
  return (res.data ?? null) as SkillScheduleView | null;
}

/** Full skill row for the editor (RLS-scoped read). null if it does not exist / not owned. */
export async function getSkillForEdit(id: string): Promise<EditableSkill | null> {
  const supabase = await getReadClient();
  const res = await supabase
    .from("client_skills")
    .select(
      "id, client_id, product_id, slug, name, description, body, allowed_tools, capability, ultron_enabled, ultron_function, status, version",
    )
    .eq("id", id)
    .maybeSingle();
  if (res.error) throw res.error;
  return (res.data ?? null) as EditableSkill | null;
}
