// Pure helpers for the analyses table: sorting, recommendation labels and the
// rule that picks the "primary" finding per campaign. Kept free of server-only
// imports so both the service (server) and the table (client) can share them.

export type SortableSnapshot = {
  meta_entity_id: string;
  entity_name: string | null;
  spend_cents: number | null;
  ctr: number | null;
  cpc_cents: number | null;
  cplpv_cents: number | null;
  cpm_cents: number | null;
  results: number | null;
};

export type SortKey =
  | "spend_desc"
  | "ctr_desc"
  | "cpc_asc"
  | "cplpv_asc"
  | "cpm_asc"
  | "results_desc"
  | "name_asc";

export const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: "spend_desc", label: "Maior gasto" },
  { key: "ctr_desc", label: "Maior CTR" },
  { key: "cpc_asc", label: "Menor CPC" },
  { key: "cplpv_asc", label: "Menor CPLPV" },
  { key: "cpm_asc", label: "Menor CPM" },
  { key: "results_desc", label: "Mais resultados" },
  { key: "name_asc", label: "Nome A-Z" },
];

const NUMERIC_SORTS: Record<
  Exclude<SortKey, "name_asc">,
  { field: keyof SortableSnapshot & string; direction: "asc" | "desc" }
> = {
  spend_desc: { field: "spend_cents", direction: "desc" },
  ctr_desc: { field: "ctr", direction: "desc" },
  cpc_asc: { field: "cpc_cents", direction: "asc" },
  cplpv_asc: { field: "cplpv_cents", direction: "asc" },
  cpm_asc: { field: "cpm_cents", direction: "asc" },
  results_desc: { field: "results", direction: "desc" },
};

export function snapshotDisplayName(snapshot: SortableSnapshot): string {
  return snapshot.entity_name ?? snapshot.meta_entity_id;
}

/** Comparator for the chosen sort. Null metrics always sink to the bottom. */
export function compareSnapshots(
  sort: SortKey,
): (a: SortableSnapshot, b: SortableSnapshot) => number {
  if (sort === "name_asc") {
    return (a, b) => snapshotDisplayName(a).localeCompare(snapshotDisplayName(b), "pt-BR");
  }
  const { field, direction } = NUMERIC_SORTS[sort];
  return (a, b) => {
    const av = a[field] as number | null;
    const bv = b[field] as number | null;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return direction === "asc" ? av - bv : bv - av;
  };
}

export const RECOMMENDATION_LABELS: Record<string, string> = {
  rotate_creative: "Trocar criativo",
  pause_loser: "Pausar",
  fix_landing_page: "Corrigir LP",
  reallocate_budget: "Realocar verba",
  adjust_audience: "Ajustar público",
  add_negative_keywords: "Negativar termos",
  adjust_keywords: "Ajustar keywords",
  scale: "Escalar",
  observe: "Observar",
  none: "—",
};

export type FindingLike = {
  severity: string;
  is_significant: boolean;
  recommendation_type: string;
  created_at: string;
};

const SEVERITY_RANK: Record<string, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

const NON_ACTIONABLE = new Set(["observe", "none"]);

/**
 * Picks the finding the table surfaces when an entity has several in the same
 * round: highest severity, then significant first, then actionable
 * recommendations before observe/none, then most recent.
 */
export function pickPrimaryFinding<T extends FindingLike>(findings: T[]): T | null {
  if (findings.length === 0) return null;
  const sorted = [...findings].sort((a, b) => {
    const severityDelta =
      (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0);
    if (severityDelta !== 0) return severityDelta;
    if (a.is_significant !== b.is_significant) return a.is_significant ? -1 : 1;
    const aActionable = !NON_ACTIONABLE.has(a.recommendation_type);
    const bActionable = !NON_ACTIONABLE.has(b.recommendation_type);
    if (aActionable !== bActionable) return aActionable ? -1 : 1;
    return b.created_at.localeCompare(a.created_at);
  });
  return sorted[0] ?? null;
}
