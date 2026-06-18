import "server-only";
import { getReadClient } from "@/lib/db/read-client";
import type { Campaign, Client, OperationLog } from "@/lib/db/types";

export type ClientOverview = {
  client: Pick<Client, "id" | "slug" | "name" | "currency" | "daily_budget_cap_cents">;
  campaigns: Array<
    Pick<
      Campaign,
      | "id"
      | "meta_campaign_id"
      | "name"
      | "objective"
      | "budget_mode"
      | "daily_budget_cents"
      | "status"
      | "ads_manager_url"
      | "created_at"
    >
  >;
};

export type DashboardOverview = {
  clients: ClientOverview[];
  recentActions: Array<
    Pick<OperationLog, "id" | "entity_type" | "action" | "summary" | "actor" | "created_at">
  >;
};

/**
 * Aggregated read for the dashboard home: every client with its campaigns plus a
 * recent activity feed from operation_logs. Read-only.
 */
export async function getOverview(): Promise<DashboardOverview> {
  const supabase = await getReadClient();

  const [clientsRes, campaignsRes, logsRes] = await Promise.all([
    supabase
      .from("clients")
      .select("id, slug, name, currency, daily_budget_cap_cents")
      .order("created_at", { ascending: true }),
    supabase
      .from("campaigns")
      .select(
        "id, client_id, meta_campaign_id, name, objective, budget_mode, daily_budget_cents, status, ads_manager_url, created_at",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("operation_logs")
      .select("id, entity_type, action, summary, actor, created_at")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  if (clientsRes.error) throw clientsRes.error;
  if (campaignsRes.error) throw campaignsRes.error;
  if (logsRes.error) throw logsRes.error;

  const campaignsByClient = new Map<string, DashboardOverview["clients"][number]["campaigns"]>();
  for (const campaign of campaignsRes.data ?? []) {
    const list = campaignsByClient.get(campaign.client_id) ?? [];
    const { client_id: _clientId, ...rest } = campaign;
    list.push(rest);
    campaignsByClient.set(campaign.client_id, list);
  }

  const clients: ClientOverview[] = (clientsRes.data ?? []).map((client) => ({
    client,
    campaigns: campaignsByClient.get(client.id) ?? [],
  }));

  return { clients, recentActions: logsRes.data ?? [] };
}
