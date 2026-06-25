// SPEC-018 — curated tool catalog for operator-authored skills.
//
// A user-authored skill runs under `claude -p --dangerously-skip-permissions`, so the set of
// tools it may touch must be CONSTRAINED to what the operator picked from this catalog — never
// free-form. The selected group ids expand into the concrete tool identifiers that land in the
// materialized SKILL.md frontmatter `allowed-tools`. Groups are tagged read|write: any write
// group forces capability='write' (the spend gate). Base tools are always available.
//
// Keep the Meta tool names in sync with the active connector (ADR 0029: MCP_META_ADS_B2_TECH).

const META = "mcp__claude_ai_MCP_META_ADS_B2_TECH";
const SUPABASE = "mcp__supabase";

export type ToolTier = "read" | "write";

export type ToolGroup = {
  id: string;
  label: string;
  description: string;
  tier: ToolTier;
  tools: string[];
};

// Always granted — generic, non-spending capabilities every skill needs to read context, run
// curl/jq, and write a report file. None of these can move money on Meta.
export const BASE_TOOLS: string[] = ["Read", "Glob", "Bash", "Write", "Skill"];

export const TOOL_GROUPS: ToolGroup[] = [
  {
    id: "meta_insights",
    label: "Métricas da Meta (leitura)",
    description: "Ler campanhas, conjuntos, anúncios, criativos e insights de performance.",
    tier: "read",
    tools: [
      `${META}__meta_token_status`,
      `${META}__list_ad_accounts`,
      `${META}__list_campaigns`,
      `${META}__list_adsets`,
      `${META}__list_ads`,
      `${META}__list_creatives`,
      `${META}__list_pixels`,
      `${META}__get_insights`,
      `${META}__run_insights_report`,
    ],
  },
  {
    id: "supabase_read",
    label: "Banco de dados (leitura)",
    description: "Consultar dados que os agentes persistiram (campanhas, análises, funil).",
    tier: "read",
    tools: [`${SUPABASE}__execute_sql`, `${SUPABASE}__list_tables`],
  },
  {
    id: "meta_campaign_write",
    label: "Criar campanhas na Meta",
    description: "Criar campanha, conjunto, anúncio e criativo (sobe SEMPRE pausado).",
    tier: "write",
    tools: [
      `${META}__list_ad_accounts`,
      `${META}__list_campaigns`,
      `${META}__list_adsets`,
      `${META}__list_ads`,
      `${META}__list_creatives`,
      `${META}__create_campaign`,
      `${META}__create_adset`,
      `${META}__create_creative`,
      `${META}__create_ad`,
      `${META}__copy_campaign`,
      `${META}__copy_adset`,
      `${META}__copy_ad`,
    ],
  },
  {
    id: "meta_activate",
    label: "Ativar/pausar campanhas",
    description: "Mudar status (ACTIVE/PAUSED) — ativa gasto real, respeite o budget cap.",
    tier: "write",
    tools: [
      `${META}__list_campaigns`,
      `${META}__list_adsets`,
      `${META}__list_ads`,
      `${META}__update_campaign`,
      `${META}__update_adset`,
      `${META}__update_ad`,
      `${META}__pause_campaign`,
      `${META}__pause_adset`,
      `${META}__pause_ad`,
    ],
  },
];

const GROUP_BY_ID = new Map(TOOL_GROUPS.map((g) => [g.id, g]));

export function isValidGroupId(id: string): boolean {
  return GROUP_BY_ID.has(id);
}

/** Does this selection include any write-tier group? (write groups require capability='write'.) */
export function selectionHasWrite(groupIds: string[]): boolean {
  return groupIds.some((id) => GROUP_BY_ID.get(id)?.tier === "write");
}

/** Expand selected group ids into the concrete `allowed-tools` list (base tools + de-duped). */
export function expandAllowedTools(groupIds: string[]): string[] {
  const set = new Set<string>(BASE_TOOLS);
  for (const id of groupIds) {
    const g = GROUP_BY_ID.get(id);
    if (g) for (const t of g.tools) set.add(t);
  }
  return [...set];
}

/** Reverse of expandAllowedTools: which groups are fully present in a stored allow-list. Used by
 * the editor to rehydrate the wizard checkboxes from client_skills.allowed_tools. */
export function deriveSelectedGroups(allowedTools: string[]): string[] {
  const set = new Set(allowedTools);
  return TOOL_GROUPS.filter((g) => g.tools.every((t) => set.has(t))).map((g) => g.id);
}
