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
  accountId: string;
  account: FunnelEntity | null;
  campaigns: FunnelEntity[];
};

/** One selectable source = a client + one of its ad accounts that has funnel data. */
export type FunnelAccountOption = { accountId: string; label: string };
export type FunnelClientOption = {
  clientId: string;
  name: string;
  slug: string;
  accounts: FunnelAccountOption[];
};

function rawObject(raw: FunnelEvent["raw"]): Record<string, unknown> | null {
  let v: unknown = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function rawNumber(raw: FunnelEvent["raw"], key: string): number | null {
  const obj = rawObject(raw);
  const n = obj?.[key];
  return typeof n === "number" ? n : null;
}

function buildEntity(events: FunnelEvent[], spendCents: number | null): FunnelEntity {
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
  const rawRoas = rawNumber(purchaseEvent?.raw ?? null, "roas");

  // Spend: authoritative snapshot value when present; otherwise reconstruct from
  // revenue / ROAS (used as a last resort).
  let spend: number | null = spendCents;
  if (spend == null && rawRoas && rawRoas > 0 && revenue_cents != null) {
    spend = Math.round(revenue_cents / rawRoas);
  }

  // ROAS: compute from revenue / spend (most reliable — both authoritative);
  // fall back to the value Meta reported in raw.
  let roas: number | null = null;
  if (revenue_cents != null && spend && spend > 0) roas = revenue_cents / spend;
  else if (rawRoas != null) roas = rawRoas;

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
 * Clients (and their ad accounts) that have at least one funnel snapshot. Powers
 * the client/account selectors. Read-only.
 */
export async function getFunnelDirectory(): Promise<FunnelClientOption[]> {
  const supabase = db();

  const accountsRes = await supabase
    .from("funnel_events")
    .select("client_id, meta_entity_id, entity_name, captured_at")
    .eq("level", "account")
    .order("captured_at", { ascending: false });
  if (accountsRes.error) throw accountsRes.error;

  const rows = accountsRes.data ?? [];
  if (rows.length === 0) return [];

  const clientIds = [...new Set(rows.map((r) => r.client_id))];
  const clientsRes = await supabase
    .from("clients")
    .select("id, name, slug")
    .in("id", clientIds);
  if (clientsRes.error) throw clientsRes.error;
  const clientsById = new Map((clientsRes.data ?? []).map((c) => [c.id, c]));

  // Dedupe to one entry per (client, account), newest first (rows are ordered).
  const byClient = new Map<string, Map<string, FunnelAccountOption>>();
  for (const r of rows) {
    const accounts = byClient.get(r.client_id) ?? new Map<string, FunnelAccountOption>();
    if (!accounts.has(r.meta_entity_id)) {
      accounts.set(r.meta_entity_id, {
        accountId: r.meta_entity_id,
        label: r.entity_name ?? r.meta_entity_id,
      });
    }
    byClient.set(r.client_id, accounts);
  }

  return [...byClient.entries()]
    .map(([clientId, accounts]) => {
      const client = clientsById.get(clientId);
      return {
        clientId,
        name: client?.name ?? clientId,
        slug: client?.slug ?? "",
        accounts: [...accounts.values()],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The most recent funnel snapshot for a given client/account (defaults to the
 * latest overall). Splits the account-level funnel (the hero) from per-campaign
 * funnels ranked by spend, and joins metric_snapshots for authoritative spend.
 * Read-only.
 */
export async function getLatestFunnel(opts?: {
  clientId?: string;
  accountId?: string;
}): Promise<FunnelData | null> {
  const supabase = db();

  // Resolve the latest analysis that has an account-level funnel for the selection.
  let sel = supabase
    .from("funnel_events")
    .select("analysis_id, meta_entity_id, client_id, captured_at")
    .eq("level", "account")
    .order("captured_at", { ascending: false });
  if (opts?.clientId) sel = sel.eq("client_id", opts.clientId);
  if (opts?.accountId) sel = sel.eq("meta_entity_id", opts.accountId);
  const latest = await sel.limit(1);
  if (latest.error) throw latest.error;
  const head = latest.data?.[0];
  if (!head) return null;
  const analysisId = head.analysis_id;
  const accountId = head.meta_entity_id;

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

  const snapshots = snapshotsRes.data ?? [];
  const spendByEntity = new Map<string, number | null>(
    snapshots.map((s) => [s.meta_entity_id, s.spend_cents]),
  );
  // Account has no snapshot row → its spend is the sum of campaign spend.
  const accountSpend = snapshots.reduce((sum, s) => sum + (s.spend_cents ?? 0), 0) || null;

  const clientRes = await supabase
    .from("clients")
    .select("name, currency")
    .eq("id", analysis.client_id)
    .single();

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
    if (key === `account:${accountId}`) {
      account = buildEntity(group, accountSpend);
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
    accountId,
    account,
    campaigns,
  };
}
