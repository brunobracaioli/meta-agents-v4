import "server-only";
import { getReadClient } from "@/lib/db/read-client";

// SPEC-018 — read side of client management. The authenticated read client makes RLS isolate
// rows to the operator's own clients (in supabase mode); password mode returns all (single-tenant).

export type AdminClient = {
  id: string;
  operator_id: string | null;
  slug: string;
  name: string;
  ad_account_id: string;
  business_manager_id: string | null;
  facebook_page_id: string | null;
  default_landing_url: string | null;
  daily_budget_cap_cents: number;
  currency: string;
  materials_path: string | null;
};

const COLUMNS =
  "id, operator_id, slug, name, ad_account_id, business_manager_id, facebook_page_id, default_landing_url, daily_budget_cap_cents, currency, materials_path";

export async function listClientsForOperator(): Promise<AdminClient[]> {
  const supabase = await getReadClient();
  const res = await supabase.from("clients").select(COLUMNS).order("created_at", { ascending: true });
  if (res.error) throw res.error;
  return (res.data ?? []) as AdminClient[];
}
