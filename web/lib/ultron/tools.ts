import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db/client";

/**
 * Read-only data tools the Ultron assistant can call. Every handler runs a
 * parameterized SELECT via the Supabase client and returns plain JSON. None of
 * them mutate anything — there is intentionally no write tool.
 */

type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>;

type ToolDef = {
  spec: Anthropic.Tool;
  handler: ToolHandler;
};

function str(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

async function resolveClientId(slug: string): Promise<{ id: string; currency: string } | null> {
  const { data } = await db().from("clients").select("id, currency").eq("slug", slug).maybeSingle();
  return data ?? null;
}

const tools: Record<string, ToolDef> = {
  list_clients: {
    spec: {
      name: "list_clients",
      description: "Lista todos os clientes (infoprodutores) gerenciados, com slug e nome.",
      input_schema: { type: "object", properties: {} },
    },
    handler: async () => {
      const { data, error } = await db()
        .from("clients")
        .select("slug, name, currency, daily_budget_cap_cents")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  },

  get_client_overview: {
    spec: {
      name: "get_client_overview",
      description:
        "Visão geral de um cliente: dados da conta e lista de campanhas com status e orçamento. Use o slug do cliente.",
      input_schema: {
        type: "object",
        properties: { client_slug: { type: "string", description: "slug do cliente, ex.: brunobracaioli" } },
        required: ["client_slug"],
      },
    },
    handler: async (input) => {
      const slug = str(input, "client_slug");
      if (!slug) return { error: "client_slug é obrigatório" };
      const client = await resolveClientId(slug);
      if (!client) return { error: `cliente '${slug}' não encontrado` };
      const { data, error } = await db()
        .from("campaigns")
        .select("name, objective, budget_mode, daily_budget_cents, status, created_at")
        .eq("client_id", client.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return { client_slug: slug, currency: client.currency, campaigns: data ?? [] };
    },
  },

  get_campaign_metrics: {
    spec: {
      name: "get_campaign_metrics",
      description:
        "Métricas da análise mais recente de um cliente (CPLPV north-star, CTR, CPC, CPM, frequência, gasto) por entidade. Sempre cruze ao menos 2 métricas ao interpretar — nunca uma isolada.",
      input_schema: {
        type: "object",
        properties: { client_slug: { type: "string" } },
        required: ["client_slug"],
      },
    },
    handler: async (input) => {
      const slug = str(input, "client_slug");
      if (!slug) return { error: "client_slug é obrigatório" };
      const client = await resolveClientId(slug);
      if (!client) return { error: `cliente '${slug}' não encontrado` };
      const { data: analysis } = await db()
        .from("analyses")
        .select("id, overall_verdict, window_start, window_stop, created_at")
        .eq("client_id", client.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!analysis) return { client_slug: slug, note: "nenhuma análise de performance ainda" };
      const { data: snapshots, error } = await db()
        .from("metric_snapshots")
        .select(
          "level, entity_name, impressions, spend_cents, ctr, cpc_cents, cpm_cents, cplpv_cents, frequency, link_clicks, landing_page_views",
        )
        .eq("analysis_id", analysis.id)
        .order("spend_cents", { ascending: false });
      if (error) throw error;
      return { client_slug: slug, currency: client.currency, analysis, snapshots: snapshots ?? [] };
    },
  },

  get_latest_analysis: {
    spec: {
      name: "get_latest_analysis",
      description:
        "Veredito e diagnósticos (findings) da análise mais recente de um cliente: severidade, diagnóstico relacional e ação recomendada.",
      input_schema: {
        type: "object",
        properties: { client_slug: { type: "string" } },
        required: ["client_slug"],
      },
    },
    handler: async (input) => {
      const slug = str(input, "client_slug");
      if (!slug) return { error: "client_slug é obrigatório" };
      const client = await resolveClientId(slug);
      if (!client) return { error: `cliente '${slug}' não encontrado` };
      const { data: analysis } = await db()
        .from("analyses")
        .select("id, overall_verdict, summary, created_at")
        .eq("client_id", client.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!analysis) return { client_slug: slug, note: "nenhuma análise ainda" };
      const { data: findings, error } = await db()
        .from("analysis_findings")
        .select("severity, metric_focus, diagnosis, recommended_action, recommendation_type, confidence, entity_name")
        .eq("analysis_id", analysis.id);
      if (error) throw error;
      return { client_slug: slug, analysis, findings: findings ?? [] };
    },
  },

  get_recent_actions: {
    spec: {
      name: "get_recent_actions",
      description:
        "Ações recentes dos agents (create/update/pause/activate) a partir do log de operações. Filtra por cliente se informado.",
      input_schema: {
        type: "object",
        properties: {
          client_slug: { type: "string", description: "opcional" },
          limit: { type: "number", description: "padrão 20, máximo 50" },
        },
      },
    },
    handler: async (input) => {
      const slug = str(input, "client_slug");
      const rawLimit = typeof input.limit === "number" ? input.limit : 20;
      const limit = Math.min(Math.max(1, rawLimit), 50);
      let query = db()
        .from("operation_logs")
        .select("entity_type, action, summary, actor, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (slug) {
        const client = await resolveClientId(slug);
        if (!client) return { error: `cliente '${slug}' não encontrado` };
        query = query.eq("client_id", client.id);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  },

  get_daily_summary: {
    spec: {
      name: "get_daily_summary",
      description:
        "Resumo diário gerado por IA do que os agents fizeram (por cliente). Use para 'o que foi feito hoje'. Se não houver, caia para get_recent_actions.",
      input_schema: {
        type: "object",
        properties: {
          client_slug: { type: "string", description: "opcional" },
          date: { type: "string", description: "YYYY-MM-DD; padrão hoje" },
        },
      },
    },
    handler: async (input) => {
      const slug = str(input, "client_slug");
      const date = str(input, "date");
      let clientId: string | undefined;
      if (slug) {
        const client = await resolveClientId(slug);
        if (!client) return { error: `cliente '${slug}' não encontrado` };
        clientId = client.id;
      }
      let query = db()
        .from("daily_summaries")
        .select("summary_date, summary, structured, client_id")
        .order("summary_date", { ascending: false })
        .limit(7);
      if (date) query = query.eq("summary_date", date);
      if (clientId) query = query.eq("client_id", clientId);
      const { data, error } = await query;
      if (error) throw error;
      if (!data || data.length === 0) {
        return { note: "sem resumo diário registrado; use get_recent_actions" };
      }
      return data;
    },
  },
};

export const toolSpecs: Anthropic.Tool[] = Object.values(tools).map((t) => t.spec);

export async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  const tool = tools[name];
  if (!tool) return { error: `tool desconhecida: ${name}` };
  try {
    return await tool.handler(input);
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "ultron_tool_error",
        tool: name,
        message: err instanceof Error ? err.message : "unknown",
      }),
    );
    return { error: "falha ao consultar os dados" };
  }
}
