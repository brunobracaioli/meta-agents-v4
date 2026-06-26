import "server-only";
import { getReadClient } from "@/lib/db/read-client";

// SPEC-018.1 — read side of product management + the skill wizard's product context. RLS isolates
// products to the operator's own clients (products_select_own via operator_owns_client).

export type AdminProduct = {
  id: string;
  client_id: string;
  slug: string;
  name: string;
  default_subdomain: string | null;
  status: string;
};

const COLUMNS = "id, client_id, slug, name, default_subdomain, status";

export async function listProductsForClient(clientId: string): Promise<AdminProduct[]> {
  const supabase = await getReadClient();
  const res = await supabase
    .from("products")
    .select(COLUMNS)
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });
  if (res.error) throw res.error;
  return (res.data ?? []) as AdminProduct[];
}

/** Resolve a product by client slug + product slug (the nested route params). null if not owned. */
export async function getProductBySlugs(
  clientSlug: string,
  productSlug: string,
): Promise<{ id: string; client_id: string; slug: string; name: string; clientSlug: string } | null> {
  const supabase = await getReadClient();
  const clientRes = await supabase.from("clients").select("id, slug").eq("slug", clientSlug).maybeSingle();
  if (clientRes.error) throw clientRes.error;
  if (!clientRes.data) return null;
  const res = await supabase
    .from("products")
    .select("id, client_id, slug, name")
    .eq("client_id", clientRes.data.id)
    .eq("slug", productSlug)
    .maybeSingle();
  if (res.error) throw res.error;
  if (!res.data) return null;
  return { ...res.data, clientSlug: clientRes.data.slug };
}
