import "server-only";
import { getReadClient } from "@/lib/db/read-client";
import type { Analysis, AnalysisFinding, MetricSnapshot } from "@/lib/db/types";
import { pickPrimaryFinding } from "@/components/analyses/analyses-table-utils";

export type CampaignAnalysisRow = {
  snapshot: Pick<
    MetricSnapshot,
    | "id"
    | "meta_entity_id"
    | "entity_name"
    | "impressions"
    | "frequency"
    | "spend_cents"
    | "link_clicks"
    | "landing_page_views"
    | "results"
    | "ctr"
    | "cpc_cents"
    | "cpm_cents"
    | "cplpv_cents"
    | "cost_per_result_cents"
  >;
  finding: Pick<
    AnalysisFinding,
    | "id"
    | "severity"
    | "recommendation_type"
    | "recommended_action"
    | "diagnosis"
    | "metric_focus"
    | "is_significant"
  > | null;
  extraFindingsCount: number;
};

export type AnalysisRound = {
  analysis: Pick<
    Analysis,
    | "id"
    | "client_id"
    | "created_at"
    | "overall_verdict"
    | "summary"
    | "objective"
    | "window_start"
    | "window_stop"
    | "triggered_by"
  >;
  clientName: string;
  clientSlug: string;
  currency: string;
  campaigns: CampaignAnalysisRow[];
  globalFindings: Array<
    Pick<AnalysisFinding, "id" | "severity" | "diagnosis" | "recommended_action">
  >;
};

const DEFAULT_ROUNDS_LIMIT = 30;

/**
 * Recent analysis rounds across all clients, newest first. Each round carries
 * its campaign-level snapshots joined (in memory, by meta_entity_id) with the
 * primary AI finding for that campaign, plus account-wide findings. Read-only.
 */
export async function getAnalysisRounds(
  limit = DEFAULT_ROUNDS_LIMIT,
): Promise<AnalysisRound[]> {
  const supabase = await getReadClient();

  const analysesRes = await supabase
    .from("analyses")
    .select(
      "id, client_id, created_at, overall_verdict, summary, objective, window_start, window_stop, triggered_by",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (analysesRes.error) throw analysesRes.error;
  const analyses = analysesRes.data ?? [];
  if (analyses.length === 0) return [];

  const analysisIds = analyses.map((a) => a.id);
  const clientIds = [...new Set(analyses.map((a) => a.client_id))];

  const [snapshotsRes, findingsRes, clientsRes] = await Promise.all([
    supabase
      .from("metric_snapshots")
      .select(
        "id, analysis_id, meta_entity_id, entity_name, impressions, frequency, spend_cents, link_clicks, landing_page_views, results, ctr, cpc_cents, cpm_cents, cplpv_cents, cost_per_result_cents",
      )
      .in("analysis_id", analysisIds)
      .eq("level", "campaign")
      .order("spend_cents", { ascending: false }),
    supabase
      .from("analysis_findings")
      .select(
        "id, analysis_id, meta_entity_id, severity, recommendation_type, recommended_action, diagnosis, metric_focus, is_significant, created_at",
      )
      .in("analysis_id", analysisIds),
    supabase.from("clients").select("id, name, slug, currency").in("id", clientIds),
  ]);
  if (snapshotsRes.error) throw snapshotsRes.error;
  if (findingsRes.error) throw findingsRes.error;
  if (clientsRes.error) throw clientsRes.error;

  const snapshotsByAnalysis = new Map<string, typeof snapshotsRes.data>();
  for (const s of snapshotsRes.data ?? []) {
    const list = snapshotsByAnalysis.get(s.analysis_id) ?? [];
    list.push(s);
    snapshotsByAnalysis.set(s.analysis_id, list);
  }

  const findingsByAnalysis = new Map<string, typeof findingsRes.data>();
  for (const f of findingsRes.data ?? []) {
    const list = findingsByAnalysis.get(f.analysis_id) ?? [];
    list.push(f);
    findingsByAnalysis.set(f.analysis_id, list);
  }

  const clientsById = new Map((clientsRes.data ?? []).map((c) => [c.id, c]));

  return analyses.map((analysis) => {
    const client = clientsById.get(analysis.client_id);
    const roundFindings = findingsByAnalysis.get(analysis.id) ?? [];

    const campaigns: CampaignAnalysisRow[] = (
      snapshotsByAnalysis.get(analysis.id) ?? []
    ).map((snapshot) => {
      // Findings link to snapshots by Meta entity id within the same round.
      const entityFindings = roundFindings.filter(
        (f) => f.meta_entity_id === snapshot.meta_entity_id,
      );
      const primary = pickPrimaryFinding(entityFindings);
      return {
        snapshot,
        finding: primary
          ? {
              id: primary.id,
              severity: primary.severity,
              recommendation_type: primary.recommendation_type,
              recommended_action: primary.recommended_action,
              diagnosis: primary.diagnosis,
              metric_focus: primary.metric_focus,
              is_significant: primary.is_significant,
            }
          : null,
        extraFindingsCount: primary ? entityFindings.length - 1 : 0,
      };
    });

    return {
      analysis,
      clientName: client?.name ?? analysis.client_id,
      clientSlug: client?.slug ?? "",
      currency: client?.currency ?? "BRL",
      campaigns,
      globalFindings: roundFindings
        .filter((f) => f.meta_entity_id == null)
        .map((f) => ({
          id: f.id,
          severity: f.severity,
          diagnosis: f.diagnosis,
          recommended_action: f.recommended_action,
        })),
    };
  });
}
