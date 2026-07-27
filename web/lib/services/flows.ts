import "server-only";
import { getReadClient } from "@/lib/db/read-client";
import { EMPTY_GRAPH, flowGraphSchema, type FlowGraph } from "@/lib/flows/validate";

// SPEC-020 (Wave 1) — read side of the Flow Builder. The authenticated read client makes RLS
// isolate rows to the operator's own flows (supabase mode); mutations go through /api/flows.

const ASSETS_BUCKET = "flow-assets";

export type FlowListItem = {
  id: string;
  name: string;
  status: string;
  version: number;
  updated_at: string;
  clientName: string | null;
  clientSlug: string | null;
};

export type FlowDetail = {
  id: string;
  client_id: string;
  name: string;
  description: string | null;
  status: string;
  graph: FlowGraph;
  version: number;
  clientName: string | null;
  clientSlug: string | null;
};

export type FlowAssetItem = {
  id: string;
  path: string;
  mime: string;
  size_bytes: number;
  created_at: string;
  url: string;
};

type ClientJoin = { slug: string; name: string } | null;

export async function getAllFlows(): Promise<FlowListItem[]> {
  const supabase = await getReadClient();
  const res = await supabase
    .from("flows")
    .select("id, name, status, version, updated_at, client:clients(slug, name)")
    .neq("status", "archived")
    .order("updated_at", { ascending: false });
  if (res.error) throw res.error;
  return (res.data ?? []).map((f) => {
    const client = f.client as ClientJoin;
    return {
      id: f.id,
      name: f.name,
      status: f.status,
      version: f.version,
      updated_at: f.updated_at,
      clientName: client?.name ?? null,
      clientSlug: client?.slug ?? null,
    };
  });
}

export async function getFlowDetail(id: string): Promise<FlowDetail | null> {
  const supabase = await getReadClient();
  const res = await supabase
    .from("flows")
    .select("id, client_id, name, description, status, graph, version, client:clients(slug, name)")
    .eq("id", id)
    .maybeSingle();
  if (res.error) throw res.error;
  if (!res.data) return null;
  const client = res.data.client as ClientJoin;
  // A malformed graph (should never happen — API validates on write) degrades to empty
  // instead of crashing the editor.
  const graph = flowGraphSchema.safeParse(res.data.graph);
  return {
    id: res.data.id,
    client_id: res.data.client_id,
    name: res.data.name,
    description: res.data.description,
    status: res.data.status,
    graph: graph.success ? graph.data : EMPTY_GRAPH,
    version: res.data.version,
    clientName: client?.name ?? null,
    clientSlug: client?.slug ?? null,
  };
}

export async function getFlowAssets(flowId: string): Promise<FlowAssetItem[]> {
  const supabase = await getReadClient();
  const res = await supabase
    .from("flow_assets")
    .select("id, path, mime, size_bytes, created_at")
    .eq("flow_id", flowId)
    .order("created_at", { ascending: false });
  if (res.error) throw res.error;
  return (res.data ?? []).map((a) => ({
    ...a,
    url: supabase.storage.from(ASSETS_BUCKET).getPublicUrl(a.path).data.publicUrl,
  }));
}
