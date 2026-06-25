import "server-only";
import { getReadClient } from "@/lib/db/read-client";

// SPEC-018 — read side of the skills surface. Authenticated read client → RLS isolates to the
// operator's own skills. Joins the owning client's slug/name for display.

export type AdminSkill = {
  id: string;
  client_id: string;
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

export async function listSkillsForOperator(): Promise<AdminSkill[]> {
  const supabase = await getReadClient();
  const res = await supabase
    .from("client_skills")
    .select(
      "id, client_id, slug, name, description, capability, ultron_enabled, status, version, allowed_tools, client:clients(slug, name)",
    )
    .order("created_at", { ascending: true });
  if (res.error) throw res.error;
  return (res.data ?? []) as unknown as AdminSkill[];
}

export async function listClientsLite(): Promise<Array<{ id: string; slug: string; name: string }>> {
  const supabase = await getReadClient();
  const res = await supabase.from("clients").select("id, slug, name").order("created_at", { ascending: true });
  if (res.error) throw res.error;
  return res.data ?? [];
}

export type EditableSkill = {
  id: string;
  client_id: string;
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

/** Full skill row for the editor (RLS-scoped read). null if it does not exist / not owned. */
export async function getSkillForEdit(id: string): Promise<EditableSkill | null> {
  const supabase = await getReadClient();
  const res = await supabase
    .from("client_skills")
    .select(
      "id, client_id, slug, name, description, body, allowed_tools, capability, ultron_enabled, ultron_function, status, version",
    )
    .eq("id", id)
    .maybeSingle();
  if (res.error) throw res.error;
  return (res.data ?? null) as EditableSkill | null;
}
