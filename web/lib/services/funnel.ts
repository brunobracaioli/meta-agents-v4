import "server-only";
import { db } from "@/lib/db/client";
import type { Analysis, FunnelEvent } from "@/lib/db/types";

// Canonical funnel order — mirrors the funnel-analytics skill / ADR 0025.
export const FUNNEL_ORDER = [
  "impression",
  "link_click",
  "landing_page_view",
  "view_content",
  "add_to_cart",
  "initiate_checkout",
  "purchase",
] as const;

export type FunnelStep = Pick<
  FunnelEvent,
  | "step_order"
  | "event_type"
  | "count"
  | "value_cents"
  | "cost_per_event_cents"
  | "cvr_from_prev"
  | "cvr_from_top"
>;

export type FunnelEntity = {
  level: string;
  meta_entity_id: string;
  entity_name: string | null;
  objective: string | null;
  steps: FunnelStep[];
  // Derived headline numbers for the KPI strip / campaign rail.
  impressions: number;
  purchases: number;
  spend_cents: number | null;
  revenue_cents: number | null;
  roas: number | null;
};

export type FunnelData = {
  analysis: Pick<
    Analysis,
    | "id"
    | "created_at"
    | "overall_verdict"
    | "objective"
    | "summary"
    | "window_start"
    | "window_stop"
  >;
  clientName: string;
  currency: string;
  account: FunnelEntity | null;
  campaigns: FunnelEntity[];
};

function rawNumber(raw: FunnelEvent["raw"], key: string): number | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === "number") return v;
  }
  return null;
}

function buildEntity(
  events: FunnelEvent[],
  spendCents: number | null,
): FunnelEntity {
  const steps = [...events]
    .sort((a, b) => a.step_order - b.step_order)
    .map((e) => ({
      step_order: e.step_order,
      event_type: e.event_type,
      count: e.count,
      value_cents: e.value_cents,
      cost_per_event_cents: e.cost_per_event_cents,
      cvr_from_prev: e.cvr_from_prev,
      cvr_from_top: e.cvr_from_top,
    }));

  const purchaseEvent = events.find((e) => e.event_type === "purchase");
  const impressionEvent = events.find((e) => e.event_type === "impression");
  const purchases = purchaseEvent?.count ?? 0;
  const revenue_cents = purchaseEvent?.value_cents ?? null;
  // roas is stashed in raw on every row (Meta's purchase_roas).
  const roas = rawNumber(purchaseEvent?.raw ?? null, "roas");

  // Spend: prefer the authoritative snapshot value; otherwise reconstruct from
  // revenue/ROAS (account level has no snapshot row but always has purchases).
  let spend: number | null = spendCents;
  if (spend == null && roas && roas > 0 && revenue_cents != null) {
    spend = Math.round(revenue_cents / roas);
  }

  return {
    level: events[0]?.level ?? "campaign",
    meta_entity_id: events[0]?.meta_entity_id ?? "",
    entity_name: events[0]?.entity_name ?? null,
    objective: events[0]?.objective ?? null,
    steps,
    impressions: impressionEvent?.count ?? 0,
    purchases,
    spend_cents: spend,
    revenue_cents,
    roas,
  };
}

/**
 * The most recent funnel snapshot for the dashboard funnel view. Reads the
 * latest analysis that produced funnel_events, splits the account-level funnel
 * (the hero) from the per-campaign funnels (ranked by spend), and joins
 * metric_snapshots for authoritative campaign spend. Read-only.
 */
export async function getLatestFunnel(): Promise<FunnelData | null> {
  const supabase = db();

  // Latest analysis_id that actually has a funnel persisted.
  const latest = await supabase
    .from("funnel_events")
    .select("analysis_id, captured_at")
    .order("captured_at", { ascending: false })
    .limit(1);
  if (latest.error) throw latest.error;
  const analysisId = latest.data?.[0]?.analysis_id;
  if (!analysisId) return null;

  const [analysisRes, eventsRes, snapshotsRes] = await Promise.all([
    supabase
      .from("analyses")
      .select(
        "id, client_id, created_at, overall_verdict, objective, summary, window_start, window_stop",
      )
      .eq("id", analysisId)
      .single(),
    supabase
      .from("funnel_events")
      .select(
        "level, meta_entity_id, entity_name, objective, step_order, event_type, count, value_cents, cost_per_event_cents, cvr_from_prev, cvr_from_top, raw",
      )
      .eq("analysis_id", analysisId),
    supabase
      .from("metric_snapshots")
      .select("meta_entity_id, spend_cents")
      .eq("analysis_id", analysisId)
      .eq("level", "campaign"),
  ]);
  if (analysisRes.error) throw analysisRes.error;
  if (eventsRes.error) throw eventsRes.error;
  if (snapshotsRes.error) throw snapshotsRes.error;

  const analysis = analysisRes.data;
  const events = (eventsRes.data ?? []) as FunnelEvent[];
  if (events.length === 0) return null;

  const spendByEntity = new Map<string, number | null>(
    (snapshotsRes.data ?? []).map((s) => [s.meta_entity_id, s.spend_cents]),
  );

  const clientRes = await supabase
    .from("clients")
    .select("name, currency")
    .eq("id", analysis.client_id)
    .single();

  // Group events by entity.
  const byEntity = new Map<string, FunnelEvent[]>();
  for (const e of events) {
    const key = `${e.level}:${e.meta_entity_id}`;
    const list = byEntity.get(key) ?? [];
    list.push(e);
    byEntity.set(key, list);
  }

  let account: FunnelEntity | null = null;
  const campaigns: FunnelEntity[] = [];
  for (const [key, group] of byEntity) {
    if (key.startsWith("account:")) {
      account = buildEntity(group, null);
    } else if (key.startsWith("campaign:")) {
      const metaId = group[0]?.meta_entity_id ?? "";
      campaigns.push(buildEntity(group, spendByEntity.get(metaId) ?? null));
    }
  }

  campaigns.sort((a, b) => (b.spend_cents ?? 0) - (a.spend_cents ?? 0));

  return {
    analysis,
    clientName: clientRes.data?.name ?? "—",
    currency: clientRes.data?.currency ?? "BRL",
    account,
    campaigns,
  };
}
