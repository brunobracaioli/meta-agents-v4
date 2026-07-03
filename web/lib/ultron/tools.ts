import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db/client";
import type { Json } from "@/lib/db/types";
import { rateLimiters, enforceLimit } from "@/lib/ratelimit";
import { themeSchema } from "@/lib/landing/validate";
import { validateSection } from "@/lib/landing/section-schemas";
import { applyScalarEdit } from "@/lib/landing/edit-path";
import { operatorOwnsClient, operatorRunnerReady } from "@/lib/auth/current-operator";
import { getLatestFunnel } from "@/lib/services/funnel";
import { isB2TechUrl } from "@/lib/ultron/arc-url";

// Shown when an operator tries to enqueue work before its Fly runner is provisioned + ready
// (ADR 0027). In password mode operatorRunnerReady() is always true, so this never fires.
const RUNNER_NOT_READY = "seu runner ainda não está pronto — conclua o onboarding (provisione o runner + conecte os connectors).";

/**
 * Tools the Ultron assistant can call. The data tools run parameterized SELECTs
 * and return plain JSON. The two write tools (request_campaign_creation,
 * request_campaign_activation) do NOT touch the Meta API directly — they only
 * enqueue a job into `agent_jobs` for the Fly.io runner to execute. The skill name
 * is resolved server-side from a fixed allowlist below (never free-form user text),
 * and both require an explicit two-turn confirmation (see prompt.ts).
 */

// Per-call context the chat loop threads into handlers. sessionId identifies the operator's
// browser tab — needed by start/stop_autonomous_mode so a watch knows which tab to narrate to.
// operatorId (ADR 0026) is the logged-in operator in AUTH_MODE=supabase, or null in password
// mode (single-tenant): write tools stamp it on enqueued jobs and guard client ownership.
export type ToolContext = { sessionId: string; operatorId: string | null };

type ToolHandler = (input: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;

type ToolDef = {
  spec: Anthropic.Tool;
  handler: ToolHandler;
};

// Client-side tools have NO server handler: they are executed in the operator's
// browser. The chat loop (chat.ts) detects a call to one of these and pauses,
// asking the client to produce the result (e.g. a screen capture) before resuming.
export const CLIENT_TOOLS = new Set<string>(["capture_screen"]);

const CAPTURE_SCREEN_TOOL: Anthropic.Tool = {
  name: "capture_screen",
  description:
    "Captura o que o operador está vendo na tela AGORA e te entrega a imagem para você analisar com visão. " +
    "Use quando ele pedir para você VER/olhar/analisar algo na tela (ex.: 'que erro é esse?', " +
    "'analisa o que estou vendo', 'essa campanha aqui'). Depois de ver a imagem, se precisar de números ou " +
    "status, use as tools de dados (ex.: identifique a campanha na tela e busque com get_client_overview ou " +
    "get_campaign_metrics). Se a captura não vier, é porque o operador não compartilhou a tela.",
  input_schema: { type: "object", properties: {} },
};

// Fixed server-side allowlist: spoken client slug -> the exact skill the runner may
// execute. A client absent from a map simply cannot trigger that action. This is the
// key control that keeps the write tools from becoming a "run any skill" primitive.
const CREATE_SKILL_BY_SLUG: Record<string, string> = {
  brunobracaioli: "create-traffic-brunobracaioli-campaign",
};
// Campanha de VENDAS reusando os criativos "top vendas" (OUTCOME_SALES + pixel PURCHASE).
const CREATE_SALES_SKILL_BY_SLUG: Record<string, string> = {
  brunobracaioli: "create-sales-brunobracaioli-campaign",
};
// Campanha de PESQUISA no GOOGLE ADS (Search, produto CCA-F Prep / claudeprep.io).
const GOOGLE_ADS_SKILL_BY_SLUG: Record<string, string> = {
  brunobracaioli: "criacao-de-campanha-google-ads-ccaf-prep",
};
const ACTIVATE_SKILL_BY_SLUG: Record<string, string> = {
  brunobracaioli: "activate-campaign-brunobracaioli",
};
const ANALYZE_SKILL_BY_SLUG: Record<string, string> = {
  brunobracaioli: "funnel-analytics-brunobracaioli-campaign",
};
const LANDING_SKILL_BY_SLUG: Record<string, string> = {
  brunobracaioli: "create-landing-page-brunobracaioli",
};
const PUBLISH_SKILL_BY_SLUG: Record<string, string> = {
  brunobracaioli: "publish-landing-page-brunobracaioli",
};

// `nome` becomes the subdomain (<nome>.b2tech.io) AND the Cloudflare project suffix
// (b2tech-<nome>) AND a runner arg — so it must satisfy the poller's args charset and
// CF naming. Lowercase letters, digits, hyphens; 2-40 chars. Validated server-side so a
// misheard voice command can't inject anything into the deploy.
const NOME_RE = /^[a-z0-9-]{2,40}$/;

function str(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

type ResolvedClient = { id: string; name: string; currency: string; daily_budget_cap_cents: number };

async function resolveClientId(slug: string): Promise<ResolvedClient | null> {
  const { data } = await db()
    .from("clients")
    .select("id, name, currency, daily_budget_cap_cents")
    .eq("slug", slug)
    .maybeSingle();
  return data ?? null;
}

// supabase-js surfaces a Postgres unique-violation as code 23505. Our partial unique
// index (agent_jobs_one_active_per_kind) raises it when a job of the same kind is
// already in flight for the client — i.e. a duplicate/misheard trigger.
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

type ResolvedLanding = {
  id: string;
  client_id: string;
  name: string;
  subdomain: string;
  url: string;
  status: string;
  draft_status: string;
  noindex: boolean;
  settings: unknown;
  theme: unknown;
};

async function resolveLanding(id: string): Promise<ResolvedLanding | null> {
  const { data } = await db()
    .from("landing_pages")
    .select("id, client_id, name, subdomain, url, status, draft_status, noindex, settings, theme")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

/** Truncate a value for read-back to the operator (spoken summaries stay short). */
function truncateValue(v: unknown, max = 90): unknown {
  if (typeof v === "string" && v.length > max) return `${v.slice(0, max)}…`;
  return v;
}

/** Append-only audit trail for Ultron's autonomous landing-page actions (Repudiation —
 * STRIDE). Best-effort: never let a logging failure break the edit/publish. */
async function logLandingOp(clientId: string, lpId: string, summary: string): Promise<void> {
  const res = await db()
    .from("operation_logs")
    .insert({ client_id: clientId, entity_type: "landing_page", entity_id: lpId, action: "update", actor: "ultron", summary });
  if (res.error) {
    console.error(JSON.stringify({ level: "error", event: "landing_oplog_failed", message: res.error.message }));
  }
}

// Theme tokens the voice tool may set, mapped to a themeSchema-shaped patch.
function buildThemePatch(token: string, value: string): Record<string, unknown> | null {
  const colorKeys = ["orange", "orangeHi", "navy900", "navy800", "text", "textDim", "bg", "bgAlt"];
  if (colorKeys.includes(token)) return { colors: { [token]: value } };
  if (token === "font_title") return { fonts: { title: value } };
  if (token === "font_body") return { fonts: { body: value } };
  if (token === "scale") return { scale: Number(value) };
  return null;
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
        .select("name, objective, budget_mode, daily_budget_cents, status, meta_campaign_id, created_at")
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

  // --- ARC render-tools (SPEC-019 / ADR 0031) ---
  // Read-only "display" tools: they resolve data server-side (reusing the same services as
  // the dashboard) and return a `ui_intent` directive that the ARC client materializes as a
  // holographic panel. They never mutate anything and never gain a confirm flow. Client data
  // is guarded by operatorOwnsClient before it leaves the server (threat model §S/§I).
  show_funnel: {
    spec: {
      name: "show_funnel",
      description:
        "MATERIALIZA na tela (modo ARC) o FUNIL de métricas mais recente de um cliente: passos do funil (impressão → clique → LPV → ... → compra), ROAS, gasto e compras. É read-only (não gasta, não mexe na Meta). Use quando o operador pedir para VER/MOSTRAR o funil/desempenho de um cliente (ex.: 'como estão as campanhas do Bruno', 'me mostra o funil do brunobracaioli'). Depois que o painel aparecer, RESUMA por voz cruzando ao menos duas métricas e ofereça tirar o painel. Não precisa de confirmação em dois passos.",
      input_schema: {
        type: "object",
        properties: { client_slug: { type: "string", description: "slug do cliente, ex.: brunobracaioli" } },
        required: ["client_slug"],
      },
    },
    handler: async (input, ctx) => {
      const slug = str(input, "client_slug");
      if (!slug) return { error: "client_slug é obrigatório" };
      const client = await resolveClientId(slug);
      if (!client) return { error: `cliente '${slug}' não encontrado` };
      if (!(await operatorOwnsClient(ctx.operatorId, client.id))) return { error: `cliente '${slug}' não encontrado` };
      const funnel = await getLatestFunnel({ clientId: client.id });
      if (!funnel) {
        return { client_slug: slug, note: "ainda não há dados de funil para este cliente; rode uma análise primeiro." };
      }
      return {
        client_slug: slug,
        // The directive the ARC client renders. The model also reads `data` here to speak the summary.
        ui_intent: { op: "show", element: "funnel", id: "funnel", data: funnel },
      };
    },
  },

  show_daily_summary: {
    spec: {
      name: "show_daily_summary",
      description:
        "MATERIALIZA na tela (modo ARC) o RESUMO DIÁRIO do que os agents fizeram para um cliente (gerado por IA). É read-only. Use quando o operador pedir para VER/MOSTRAR o resumo do dia / o que foi feito (ex.: 'o que os agentes fizeram hoje pro Bruno', 'mostra o resumo do dia do brunobracaioli'). Depois que aparecer, RESUMA por voz e ofereça tirar. Não precisa de confirmação. Se não houver resumo, caia para get_daily_summary/get_recent_actions e apenas fale.",
      input_schema: {
        type: "object",
        properties: {
          client_slug: { type: "string", description: "slug do cliente, ex.: brunobracaioli" },
          date: { type: "string", description: "YYYY-MM-DD; padrão: mais recentes" },
        },
        required: ["client_slug"],
      },
    },
    handler: async (input, ctx) => {
      const slug = str(input, "client_slug");
      const date = str(input, "date");
      if (!slug) return { error: "client_slug é obrigatório" };
      const client = await resolveClientId(slug);
      if (!client) return { error: `cliente '${slug}' não encontrado` };
      if (!(await operatorOwnsClient(ctx.operatorId, client.id))) return { error: `cliente '${slug}' não encontrado` };
      let query = db()
        .from("daily_summaries")
        .select("summary_date, summary, structured")
        .eq("client_id", client.id)
        .order("summary_date", { ascending: false })
        .limit(7);
      if (date) query = query.eq("summary_date", date);
      const { data, error } = await query;
      if (error) throw error;
      if (!data || data.length === 0) {
        return { client_slug: slug, note: "sem resumo diário registrado para este cliente; use get_recent_actions." };
      }
      return {
        client_slug: slug,
        ui_intent: { op: "show", element: "daily_summary", id: "daily_summary", data: { client_name: client.name, summaries: data } },
      };
    },
  },

  dismiss_element: {
    spec: {
      name: "dismiss_element",
      description:
        "TIRA da tela (modo ARC) um painel holográfico que você materializou. target = 'funnel' (funil), 'daily_summary' (resumo do dia), 'clients' (pastas/lista de clientes), 'client' (card do cliente), ou 'all' para limpar tudo. Use quando o operador disser 'pode tirar', 'fecha o funil', 'volta', 'tira isso', 'limpa tudo'. Read-only, sem confirmação.",
      input_schema: {
        type: "object",
        properties: {
          target: { type: "string", description: "'funnel', 'daily_summary' ou 'all'" },
        },
        required: ["target"],
      },
    },
    handler: async (input) => {
      const target = str(input, "target") ?? "all";
      return { dismissed: target, ui_intent: { op: "dismiss", target } };
    },
  },

  show_clients: {
    spec: {
      name: "show_clients",
      description:
        "MATERIALIZA na tela (modo ARC) a navegação de PASTAS do operador (Clientes / Funil / Pages / Configs / Ultron) com a lista rolante de clientes na pasta Clientes. É read-only. Use quando o operador pedir para VER/ABRIR clientes ou as pastas (ex.: 'abrir clientes', 'mostra meus clientes', 'abre as pastas'). Depois que aparecer, diga quantos clientes há e ofereça abrir um deles. Não precisa de confirmação.",
      input_schema: { type: "object", properties: {} },
    },
    handler: async (_input, ctx) => {
      let query = db()
        .from("clients")
        .select("slug, name, default_landing_url, currency, operator_id")
        .order("created_at", { ascending: true });
      // Multi-tenant (ADR 0026): in supabase mode scope to the operator's own clients; in
      // password mode (operatorId === null) the single tenant sees all.
      if (ctx.operatorId !== null) query = query.eq("operator_id", ctx.operatorId);
      const { data, error } = await query;
      if (error) throw error;
      const clients = (data ?? []).map((c) => ({
        slug: c.slug,
        name: c.name,
        site: c.default_landing_url,
        currency: c.currency,
      }));
      return {
        client_count: clients.length,
        ui_intent: { op: "show", element: "clients", id: "clients", data: { clients } },
      };
    },
  },

  open_client: {
    spec: {
      name: "open_client",
      description:
        "MATERIALIZA na tela (modo ARC) o CARD de um cliente: nome, site, produtos e skills (habilidades dos agents). É read-only. Use quando o operador pedir para ABRIR/VER um cliente específico (ex.: 'abrir brunobracaioli', 'abre o card do Bruno', 'me mostra os produtos e skills do brunobracaioli'). Depois que aparecer, resuma por voz (quantos produtos e skills) e ofereça tirar. Não precisa de confirmação.",
      input_schema: {
        type: "object",
        properties: { client_slug: { type: "string", description: "slug do cliente, ex.: brunobracaioli" } },
        required: ["client_slug"],
      },
    },
    handler: async (input, ctx) => {
      const slug = str(input, "client_slug");
      if (!slug) return { error: "client_slug é obrigatório" };
      const { data: client, error: clientErr } = await db()
        .from("clients")
        .select("id, name, slug, default_landing_url, currency")
        .eq("slug", slug)
        .maybeSingle();
      if (clientErr) throw clientErr;
      if (!client) return { error: `cliente '${slug}' não encontrado` };
      if (!(await operatorOwnsClient(ctx.operatorId, client.id))) return { error: `cliente '${slug}' não encontrado` };

      // Products + skills are scoped by the already-owned client_id (parent ownership verified
      // above), so the service-role reads are safe (threat model §I).
      const [productsRes, skillsRes] = await Promise.all([
        db()
          .from("products")
          .select("slug, name, default_subdomain, status")
          .eq("client_id", client.id)
          .order("created_at", { ascending: true }),
        db()
          .from("client_skills")
          .select("slug, name, capability, status, ultron_enabled, product_id")
          .eq("client_id", client.id)
          .order("created_at", { ascending: true }),
      ]);
      if (productsRes.error) throw productsRes.error;
      if (skillsRes.error) throw skillsRes.error;

      return {
        client_slug: slug,
        product_count: productsRes.data?.length ?? 0,
        skill_count: skillsRes.data?.length ?? 0,
        ui_intent: {
          op: "show",
          element: "client",
          id: "client",
          data: {
            slug: client.slug,
            name: client.name,
            site: client.default_landing_url,
            currency: client.currency,
            products: productsRes.data ?? [],
            skills: skillsRes.data ?? [],
          },
        },
      };
    },
  },

  show_analyses: {
    spec: {
      name: "show_analyses",
      description:
        "MATERIALIZA na tela (modo ARC) o resultado da ANÁLISE de performance mais recente de um cliente: veredito geral, resumo e os diagnósticos (findings) com severidade e ação recomendada. É read-only. Use quando o operador pedir para VER/MOSTRAR a última análise / diagnóstico (ex.: 'mostra a última análise do Bruno', 'me mostra o diagnóstico do brunobracaioli'). Depois resuma por voz (veredito + principal achado, cruzando métricas) e ofereça tirar. Sem confirmação.",
      input_schema: {
        type: "object",
        properties: { client_slug: { type: "string", description: "slug do cliente, ex.: brunobracaioli" } },
        required: ["client_slug"],
      },
    },
    handler: async (input, ctx) => {
      const slug = str(input, "client_slug");
      if (!slug) return { error: "client_slug é obrigatório" };
      const client = await resolveClientId(slug);
      if (!client) return { error: `cliente '${slug}' não encontrado` };
      if (!(await operatorOwnsClient(ctx.operatorId, client.id))) return { error: `cliente '${slug}' não encontrado` };
      const { data: analysis } = await db()
        .from("analyses")
        .select("id, overall_verdict, summary, objective, created_at")
        .eq("client_id", client.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!analysis) {
        return { client_slug: slug, note: "nenhuma análise ainda; rode uma análise primeiro (request_analysis)." };
      }
      const { data: findings, error } = await db()
        .from("analysis_findings")
        .select("severity, metric_focus, diagnosis, recommended_action, recommendation_type, entity_name")
        .eq("analysis_id", analysis.id)
        .order("severity", { ascending: true });
      if (error) throw error;
      return {
        client_slug: slug,
        ui_intent: {
          op: "show",
          element: "analyses",
          id: "analyses",
          data: { client_name: client.name, analysis, findings: findings ?? [] },
        },
      };
    },
  },

  show_creative: {
    spec: {
      name: "show_creative",
      description:
        "MATERIALIZA na tela (modo ARC) os CRIATIVOS (artes de anúncio) mais recentes de um cliente: imagem, headline, texto e CTA. É read-only. Use quando o operador pedir para VER/MOSTRAR o criativo / a arte / o anúncio gerado (ex.: 'mostra o criativo que você gerou', 'me mostra as artes do brunobracaioli'). Depois descreva por voz o que apareceu e ofereça tirar. Sem confirmação.",
      input_schema: {
        type: "object",
        properties: { client_slug: { type: "string", description: "slug do cliente, ex.: brunobracaioli" } },
        required: ["client_slug"],
      },
    },
    handler: async (input, ctx) => {
      const slug = str(input, "client_slug");
      if (!slug) return { error: "client_slug é obrigatório" };
      const client = await resolveClientId(slug);
      if (!client) return { error: `cliente '${slug}' não encontrado` };
      if (!(await operatorOwnsClient(ctx.operatorId, client.id))) return { error: `cliente '${slug}' não encontrado` };
      const { data, error } = await db()
        .from("creatives")
        .select("id, headline, primary_text, call_to_action_type, image_url, link_url")
        .eq("client_id", client.id)
        .not("image_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(6);
      if (error) throw error;
      if (!data || data.length === 0) {
        return { client_slug: slug, note: "nenhum criativo com imagem para este cliente ainda." };
      }
      return {
        client_slug: slug,
        creative_count: data.length,
        ui_intent: {
          op: "show",
          element: "creative",
          id: "creative",
          data: { client_name: client.name, creatives: data },
        },
      };
    },
  },

  show_landing: {
    spec: {
      name: "show_landing",
      description:
        "MATERIALIZA na tela (modo ARC) o PREVIEW (iframe) de uma landing page. É read-only. Use quando o operador pedir para VER/MOSTRAR a landing / a página (ex.: 'mostra a landing do brunobracaioli', 'abre a página que você criou'). Informe landing_page_id (use list_landing_pages) OU client_slug (pega a página mais recente do cliente). Depois descreva por voz e ofereça tirar. Sem confirmação.",
      input_schema: {
        type: "object",
        properties: {
          client_slug: { type: "string", description: "slug do cliente; pega a LP mais recente" },
          landing_page_id: { type: "string", description: "uuid da LP (use list_landing_pages)" },
        },
      },
    },
    handler: async (input, ctx) => {
      const id = str(input, "landing_page_id");
      const slug = str(input, "client_slug");

      let lp: { id: string; client_id: string; name: string; subdomain: string; url: string; status: string } | null = null;
      if (id) {
        const resolved = await resolveLanding(id);
        if (resolved) {
          lp = { id: resolved.id, client_id: resolved.client_id, name: resolved.name, subdomain: resolved.subdomain, url: resolved.url, status: resolved.status };
        }
      } else if (slug) {
        const client = await resolveClientId(slug);
        if (!client) return { error: `cliente '${slug}' não encontrado` };
        if (!(await operatorOwnsClient(ctx.operatorId, client.id))) return { error: `cliente '${slug}' não encontrado` };
        const { data, error } = await db()
          .from("landing_pages")
          .select("id, client_id, name, subdomain, url, status")
          .eq("client_id", client.id)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        lp = data;
      } else {
        return { error: "informe client_slug ou landing_page_id" };
      }

      if (!lp) return { error: "landing page não encontrada" };
      if (!(await operatorOwnsClient(ctx.operatorId, lp.client_id))) return { error: "landing page não encontrada" };
      // Frame the SAME-ORIGIN draft preview route (like the editor + live review do), not the public
      // b2tech.io URL: the app CSP is frame-src 'self', and the published page may set X-Frame-Options.
      // The preview renders the same sections from the draft. The public URL is passed only for the
      // "open in a new tab" link, validated as *.b2tech.io (threat model §I).
      return {
        landing_name: lp.name,
        ui_intent: {
          op: "show",
          element: "landing",
          id: "landing",
          data: {
            name: lp.name,
            previewUrl: `/lp-preview/${lp.id}`,
            url: isB2TechUrl(lp.url) ? lp.url : null,
            subdomain: lp.subdomain,
            status: lp.status,
          },
        },
      };
    },
  },

  focus_element: {
    spec: {
      name: "focus_element",
      description:
        "DESTACA (traz para o foco/topo) um painel holográfico já materializado, sem tirar os outros. target = 'funnel', 'daily_summary', 'clients', 'client', 'analyses', 'creative' ou 'landing'. Use quando o operador disser 'foca no funil', 'destaca o criativo', 'volta pro card'. Read-only, sem confirmação.",
      input_schema: {
        type: "object",
        properties: { target: { type: "string", description: "id do painel, ex.: 'funnel'" } },
        required: ["target"],
      },
    },
    handler: async (input) => {
      const target = str(input, "target");
      if (!target) return { error: "target é obrigatório" };
      return { focused: target, ui_intent: { op: "focus", target } };
    },
  },

  popout_element: {
    spec: {
      name: "popout_element",
      description:
        "Abre uma SEGUNDA TELA (janela espelho) do modo ARC: os painéis passam a aparecer também numa janela separada, útil pra jogar num segundo monitor. É read-only. Use quando o operador disser 'joga pra segunda tela', 'abre numa segunda janela', 'manda pro outro monitor'. target = o painel que motivou (ex.: 'funnel') ou 'all'. Se o navegador bloquear a janela, avise que ele pode clicar no botão '2ª tela' no topo do ARC.",
      input_schema: {
        type: "object",
        properties: { target: { type: "string", description: "id do painel, ex.: 'funnel', ou 'all'" } },
      },
    },
    handler: async (input) => {
      const target = str(input, "target") ?? "all";
      return { popped_out: target, ui_intent: { op: "popout", target } };
    },
  },

  request_campaign_creation: {
    spec: {
      name: "request_campaign_creation",
      description:
        "Enfileira a CRIAÇÃO de uma nova campanha de tráfego para um cliente (os agents rodam na VM). A campanha nasce PAUSED (sem gasto). FLUXO OBRIGATÓRIO: chame primeiro com confirm=false para obter os detalhes, leia-os ao operador e peça confirmação; só chame com confirm=true após um 'sim' explícito.",
      input_schema: {
        type: "object",
        properties: {
          client_slug: { type: "string", description: "slug do cliente, ex.: brunobracaioli" },
          confirm: {
            type: "boolean",
            description: "false = apenas devolve os detalhes para confirmar; true = enfileira de fato (use só após o operador confirmar)",
          },
        },
        required: ["client_slug", "confirm"],
      },
    },
    handler: async (input, ctx) => {
      const slug = str(input, "client_slug");
      const confirm = input.confirm === true;
      if (!slug) return { error: "client_slug é obrigatório" };
      const client = await resolveClientId(slug);
      if (!client) return { error: `cliente '${slug}' não encontrado` };
      if (!(await operatorOwnsClient(ctx.operatorId, client.id))) return { error: `cliente '${slug}' não encontrado` };
      if (!(await operatorRunnerReady(ctx.operatorId))) return { error: RUNNER_NOT_READY };
      const skill = CREATE_SKILL_BY_SLUG[slug];
      if (!skill) return { error: `cliente '${slug}' não está habilitado para criação automática de campanha` };

      if (!confirm) {
        return {
          confirmation_required: true,
          action: "criar campanha de tráfego",
          client: client.name,
          client_slug: slug,
          daily_budget_cents: client.daily_budget_cap_cents,
          currency: client.currency,
          note: "A campanha nasce PAUSED (gasto zero até ser ativada). Confirme com o operador antes de chamar com confirm=true.",
        };
      }

      const { allowed } = await enforceLimit(rateLimiters.campaignCreation(), slug, "campaign-creation");
      if (!allowed) return { error: "muitos pedidos de criação para este cliente agora; tente de novo daqui a pouco" };

      const { data, error } = await db()
        .from("agent_jobs")
        .insert({
          client_id: client.id,
          operator_id: ctx.operatorId,
          skill,
          kind: "create",
          args: { "budget-cents": client.daily_budget_cap_cents },
          requested_by: "ultron",
        })
        .select("id")
        .single();
      if (error) {
        if (isUniqueViolation(error)) {
          return { enqueued: false, reason: "já existe um pedido de criação em andamento para este cliente" };
        }
        throw error;
      }
      return {
        enqueued: true,
        job_id: data.id,
        skill,
        kind: "create",
        client_slug: slug,
        queued_at: new Date().toISOString(),
        message: "Pedido de criação enfileirado. Os agents começam em até um minuto; a campanha vai nascer pausada.",
      };
    },
  },

  request_sales_campaign_creation: {
    spec: {
      name: "request_sales_campaign_creation",
      description:
        "Enfileira a CRIAÇÃO de uma campanha de VENDAS (otimizada para compra) que REUSA os criativos que mais venderam da conta — não cria arte nem copy nova, reaproveita os top performers. A campanha nasce PAUSED (sem gasto). Use quando o operador pedir para 'criar campanha de vendas com os criativos que mais performaram / venderam / top criativos'. FLUXO OBRIGATÓRIO: chame primeiro com confirm=false para obter os detalhes, leia-os ao operador e peça confirmação; só chame com confirm=true após um 'sim' explícito.",
      input_schema: {
        type: "object",
        properties: {
          client_slug: { type: "string", description: "slug do cliente, ex.: brunobracaioli" },
          confirm: {
            type: "boolean",
            description: "false = apenas devolve os detalhes para confirmar; true = enfileira de fato (use só após o operador confirmar)",
          },
        },
        required: ["client_slug", "confirm"],
      },
    },
    handler: async (input, ctx) => {
      const slug = str(input, "client_slug");
      const confirm = input.confirm === true;
      if (!slug) return { error: "client_slug é obrigatório" };
      const client = await resolveClientId(slug);
      if (!client) return { error: `cliente '${slug}' não encontrado` };
      if (!(await operatorOwnsClient(ctx.operatorId, client.id))) return { error: `cliente '${slug}' não encontrado` };
      if (!(await operatorRunnerReady(ctx.operatorId))) return { error: RUNNER_NOT_READY };
      const skill = CREATE_SALES_SKILL_BY_SLUG[slug];
      if (!skill) return { error: `cliente '${slug}' não está habilitado para criação automática de campanha de vendas` };

      if (!confirm) {
        return {
          confirmation_required: true,
          action: "criar campanha de vendas reusando os top criativos",
          client: client.name,
          client_slug: slug,
          daily_budget_cents: client.daily_budget_cap_cents,
          currency: client.currency,
          note: "Campanha de vendas (otimizada por compra) reaproveitando os criativos que mais venderam nos últimos 30 dias. Nasce PAUSED (gasto zero até ser ativada). Confirme com o operador antes de chamar com confirm=true.",
        };
      }

      const { allowed } = await enforceLimit(rateLimiters.campaignCreation(), slug, "sales-campaign-creation");
      if (!allowed) return { error: "muitos pedidos de criação para este cliente agora; tente de novo daqui a pouco" };

      const { data, error } = await db()
        .from("agent_jobs")
        .insert({
          client_id: client.id,
          operator_id: ctx.operatorId,
          skill,
          kind: "create_sales",
          args: { "budget-cents": client.daily_budget_cap_cents },
          requested_by: "ultron",
        })
        .select("id")
        .single();
      if (error) {
        if (isUniqueViolation(error)) {
          return { enqueued: false, reason: "já existe um pedido de criação de campanha de vendas em andamento para este cliente" };
        }
        throw error;
      }
      return {
        enqueued: true,
        job_id: data.id,
        skill,
        kind: "create_sales",
        client_slug: slug,
        queued_at: new Date().toISOString(),
        message: "Pedido de criação de campanha de vendas enfileirado. Os agents começam em até um minuto; a campanha vai nascer pausada, reusando os top criativos.",
      };
    },
  },

  request_google_ads_campaign_creation: {
    spec: {
      name: "request_google_ads_campaign_creation",
      description:
        "Enfileira a CRIAÇÃO de uma campanha de PESQUISA no GOOGLE ADS (Search) para o produto CCA-F Prep (claudeprep.io) — copy validada, R$ 20 por dia, keywords de certificação Claude, Brasil. A campanha nasce PAUSED (sem gasto); a ativação no Google é manual, feita pelo operador. Use quando o operador pedir para 'criar/subir campanha no Google / no Google Ads / de pesquisa / search para o CCA-F Prep ou claudeprep'. FLUXO OBRIGATÓRIO: chame primeiro com confirm=false para obter os detalhes, leia-os ao operador e peça confirmação; só chame com confirm=true após um 'sim' explícito.",
      input_schema: {
        type: "object",
        properties: {
          client_slug: { type: "string", description: "slug do cliente, ex.: brunobracaioli" },
          confirm: {
            type: "boolean",
            description: "false = apenas devolve os detalhes para confirmar; true = enfileira de fato (use só após o operador confirmar)",
          },
        },
        required: ["client_slug", "confirm"],
      },
    },
    handler: async (input, ctx) => {
      const slug = str(input, "client_slug");
      const confirm = input.confirm === true;
      if (!slug) return { error: "client_slug é obrigatório" };
      const client = await resolveClientId(slug);
      if (!client) return { error: `cliente '${slug}' não encontrado` };
      if (!(await operatorOwnsClient(ctx.operatorId, client.id))) return { error: `cliente '${slug}' não encontrado` };
      if (!(await operatorRunnerReady(ctx.operatorId))) return { error: RUNNER_NOT_READY };
      const skill = GOOGLE_ADS_SKILL_BY_SLUG[slug];
      if (!skill) return { error: `cliente '${slug}' não está habilitado para criação automática de campanha no Google Ads` };

      if (!confirm) {
        return {
          confirmation_required: true,
          action: "criar campanha de pesquisa no Google Ads (CCA-F Prep)",
          client: client.name,
          client_slug: slug,
          daily_budget: "R$ 20,00/dia (fixo da skill; teto de orçamento Meta não se aplica)",
          note: "Campanha Search do CCA-F Prep (claudeprep.io) com a copy validada da skill. Nasce PAUSED (gasto zero); a ativação no Google Ads é um passo manual do operador. Confirme com o operador antes de chamar com confirm=true.",
        };
      }

      const { allowed } = await enforceLimit(rateLimiters.campaignCreation(), slug, "google-ads-campaign-creation");
      if (!allowed) return { error: "muitos pedidos de criação para este cliente agora; tente de novo daqui a pouco" };

      const { data, error } = await db()
        .from("agent_jobs")
        .insert({
          client_id: client.id,
          operator_id: ctx.operatorId,
          skill,
          kind: "create_google_ads",
          args: {},
          requested_by: "ultron",
        })
        .select("id")
        .single();
      if (error) {
        if (isUniqueViolation(error)) {
          return { enqueued: false, reason: "já existe um pedido de criação de campanha no Google Ads em andamento para este cliente" };
        }
        throw error;
      }
      return {
        enqueued: true,
        job_id: data.id,
        skill,
        kind: "create_google_ads",
        client_slug: slug,
        queued_at: new Date().toISOString(),
        message: "Pedido de criação de campanha no Google Ads enfileirado. Os agents começam em até um minuto; a campanha vai nascer pausada — a ativação no Google é manual.",
      };
    },
  },

  request_campaign_activation: {
    spec: {
      name: "request_campaign_activation",
      description:
        "Enfileira a ATIVAÇÃO de uma campanha existente (coloca no ar — começa o GASTO REAL). Só ativa campanhas PAUSED dentro do teto de orçamento do cliente. Use get_client_overview para achar o campaign_meta_id. FLUXO OBRIGATÓRIO: chame com confirm=false, releia nome e orçamento ao operador avisando que é gasto real, e só chame com confirm=true após um 'sim' explícito.",
      input_schema: {
        type: "object",
        properties: {
          client_slug: { type: "string", description: "slug do cliente, ex.: brunobracaioli" },
          campaign_meta_id: { type: "string", description: "id da campanha na Meta (meta_campaign_id), obtido via get_client_overview" },
          confirm: {
            type: "boolean",
            description: "false = apenas devolve os detalhes para confirmar; true = enfileira a ativação (use só após o operador confirmar)",
          },
        },
        required: ["client_slug", "campaign_meta_id", "confirm"],
      },
    },
    handler: async (input, ctx) => {
      const slug = str(input, "client_slug");
      const campaignMetaId = str(input, "campaign_meta_id");
      const confirm = input.confirm === true;
      if (!slug) return { error: "client_slug é obrigatório" };
      if (!campaignMetaId) return { error: "campaign_meta_id é obrigatório" };
      const client = await resolveClientId(slug);
      if (!client) return { error: `cliente '${slug}' não encontrado` };
      if (!(await operatorOwnsClient(ctx.operatorId, client.id))) return { error: `cliente '${slug}' não encontrado` };
      if (!(await operatorRunnerReady(ctx.operatorId))) return { error: RUNNER_NOT_READY };
      const skill = ACTIVATE_SKILL_BY_SLUG[slug];
      if (!skill) return { error: `cliente '${slug}' não está habilitado para ativação automática` };

      const { data: campaign } = await db()
        .from("campaigns")
        .select("name, status, daily_budget_cents, meta_campaign_id")
        .eq("client_id", client.id)
        .eq("meta_campaign_id", campaignMetaId)
        .maybeSingle();
      if (!campaign) return { error: `campanha ${campaignMetaId} não encontrada para o cliente '${slug}'` };
      if (campaign.status === "ACTIVE") return { error: `a campanha '${campaign.name}' já está ativa` };
      if (campaign.status !== "PAUSED") {
        return { error: `a campanha '${campaign.name}' está em status ${campaign.status}; só ativo campanhas PAUSED` };
      }
      const budget = campaign.daily_budget_cents;
      if (budget != null && budget > client.daily_budget_cap_cents) {
        return {
          error: `o orçamento da campanha (${budget} cents/dia) excede o teto do cliente (${client.daily_budget_cap_cents} cents/dia); não vou ativar`,
        };
      }

      if (!confirm) {
        return {
          confirmation_required: true,
          action: "ATIVAR campanha — começa o gasto real",
          client: client.name,
          campaign: campaign.name,
          campaign_meta_id: campaignMetaId,
          daily_budget_cents: budget,
          currency: client.currency,
          warning:
            "Ao confirmar, a campanha vai ao ar e passa a gastar de verdade. Releia nome e orçamento ao operador e só chame com confirm=true após um 'sim' explícito.",
        };
      }

      const { allowed } = await enforceLimit(rateLimiters.campaignActivation(), slug, "campaign-activation");
      if (!allowed) return { error: "muitos pedidos de ativação para este cliente agora; tente de novo daqui a pouco" };

      const { data, error } = await db()
        .from("agent_jobs")
        .insert({
          client_id: client.id,
          operator_id: ctx.operatorId,
          skill,
          kind: "activate",
          args: { campaign_meta_id: campaignMetaId },
          requested_by: "ultron",
        })
        .select("id")
        .single();
      if (error) {
        if (isUniqueViolation(error)) {
          return { enqueued: false, reason: "já existe um pedido de ativação em andamento para este cliente" };
        }
        throw error;
      }
      return {
        enqueued: true,
        job_id: data.id,
        skill,
        kind: "activate",
        client_slug: slug,
        queued_at: new Date().toISOString(),
        message: "Pedido de ativação enfileirado. A campanha vai ao ar em instantes.",
      };
    },
  },

  request_analysis: {
    spec: {
      name: "request_analysis",
      description:
        "Enfileira uma ANÁLISE DE PERFORMANCE sob demanda de todas as campanhas ativas de um cliente (os agents rodam na VM). É READ-ONLY na conta Meta — não cria, não ativa, não gasta nada; só lê métricas e grava diagnóstico + recomendações no banco. Não precisa de confirmação em dois passos. A análise leva alguns minutos; depois consulte o resultado com get_latest_analysis (e o andamento com get_recent_jobs). A mesma análise também roda sozinha todo dia às 8h.",
      input_schema: {
        type: "object",
        properties: {
          client_slug: { type: "string", description: "slug do cliente, ex.: brunobracaioli" },
        },
        required: ["client_slug"],
      },
    },
    handler: async (input, ctx) => {
      const slug = str(input, "client_slug");
      if (!slug) return { error: "client_slug é obrigatório" };
      const client = await resolveClientId(slug);
      if (!client) return { error: `cliente '${slug}' não encontrado` };
      if (!(await operatorOwnsClient(ctx.operatorId, client.id))) return { error: `cliente '${slug}' não encontrado` };
      if (!(await operatorRunnerReady(ctx.operatorId))) return { error: RUNNER_NOT_READY };
      const skill = ANALYZE_SKILL_BY_SLUG[slug];
      if (!skill) return { error: `cliente '${slug}' não está habilitado para análise sob demanda` };

      const { allowed } = await enforceLimit(rateLimiters.analysisRequest(), slug, "analysis-request");
      if (!allowed) return { error: "muitos pedidos de análise para este cliente agora; tente de novo daqui a pouco" };

      const { data, error } = await db()
        .from("agent_jobs")
        .insert({
          client_id: client.id,
          operator_id: ctx.operatorId,
          skill,
          kind: "analyze",
          args: {},
          requested_by: "ultron",
        })
        .select("id")
        .single();
      if (error) {
        if (isUniqueViolation(error)) {
          return { enqueued: false, reason: "já existe uma análise em andamento para este cliente" };
        }
        throw error;
      }
      return {
        enqueued: true,
        job_id: data.id,
        skill,
        kind: "analyze",
        client_slug: slug,
        queued_at: new Date().toISOString(),
        message:
          "Análise enfileirada. Os agents começam em até um minuto e levam alguns minutos; depois é só pedir o resultado (get_latest_analysis).",
      };
    },
  },

  request_landing_page_creation: {
    spec: {
      name: "request_landing_page_creation",
      description:
        "Enfileira a CRIAÇÃO de uma landing page profissional para um cliente (os agents rodam na VM, fazem deploy no Cloudflare Pages sob <nome>.b2tech.io). A página nasce em PREVIEW (noindex, não indexável) — NÃO gasta verba de anúncio. FLUXO OBRIGATÓRIO: chame primeiro com confirm=false para obter os detalhes, leia-os ao operador e peça confirmação; só chame com confirm=true após um 'sim' explícito.",
      input_schema: {
        type: "object",
        properties: {
          client_slug: { type: "string", description: "slug do cliente, ex.: brunobracaioli" },
          nome: {
            type: "string",
            description:
              "rótulo do subdomínio (vira <nome>.b2tech.io), só minúsculas, números e hífen, 2-40 chars, ex.: 'promo'. OBRIGATÓRIO: se o operador não informou, PERGUNTE qual subdomínio usar antes de chamar — nunca invente nem reutilize o de uma página existente.",
          },
          confirm: {
            type: "boolean",
            description: "false = apenas devolve os detalhes para confirmar; true = enfileira de fato (use só após o operador confirmar)",
          },
        },
        required: ["client_slug", "confirm"],
      },
    },
    handler: async (input, ctx) => {
      const slug = str(input, "client_slug");
      const confirm = input.confirm === true;
      const nomeRaw = str(input, "nome");
      if (!slug) return { error: "client_slug é obrigatório" };
      // No silent default: a missing subdomain must come back to the operator, never be
      // guessed — guessing could target a live page (e.g. cca.b2tech.io). See ADR 0012.
      if (!nomeRaw) {
        return {
          needs_input: true,
          field: "nome",
          message:
            "Preciso do nome do subdomínio para a landing page (ex.: 'promo' vira promo.b2tech.io). Pergunte ao operador qual usar — não invente um nome nem reutilize o de uma página existente.",
        };
      }
      const nome = nomeRaw.toLowerCase();
      if (!NOME_RE.test(nome)) {
        return { error: `nome '${nome}' inválido; só minúsculas, números e hífen (2-40 chars). Peça um subdomínio válido ao operador.` };
      }
      const client = await resolveClientId(slug);
      if (!client) return { error: `cliente '${slug}' não encontrado` };
      if (!(await operatorOwnsClient(ctx.operatorId, client.id))) return { error: `cliente '${slug}' não encontrado` };
      if (!(await operatorRunnerReady(ctx.operatorId))) return { error: RUNNER_NOT_READY };
      const skill = LANDING_SKILL_BY_SLUG[slug];
      if (!skill) return { error: `cliente '${slug}' não está habilitado para criação automática de landing page` };

      if (!confirm) {
        return {
          confirmation_required: true,
          action: "criar landing page",
          client: client.name,
          client_slug: slug,
          subdomain: `${nome}.b2tech.io`,
          note: "A página nasce em PREVIEW (noindex, não indexável) e NÃO gasta verba de anúncio. O go-live (tornar indexável) é um passo manual depois. Confirme com o operador antes de chamar com confirm=true.",
        };
      }

      const { allowed } = await enforceLimit(rateLimiters.landingCreation(), slug, "landing-creation");
      if (!allowed) return { error: "muitos pedidos de landing page para este cliente agora; tente de novo daqui a pouco" };

      const { data, error } = await db()
        .from("agent_jobs")
        .insert({
          client_id: client.id,
          operator_id: ctx.operatorId,
          skill,
          kind: "landing",
          args: { nome, "cart-state": "open", noindex: 1 },
          requested_by: "ultron",
        })
        .select("id")
        .single();
      if (error) {
        if (isUniqueViolation(error)) {
          return { enqueued: false, reason: "já existe um pedido de landing page em andamento para este cliente" };
        }
        throw error;
      }
      return {
        enqueued: true,
        job_id: data.id,
        skill,
        kind: "landing",
        client_slug: slug,
        subdomain: `${nome}.b2tech.io`,
        queued_at: new Date().toISOString(),
        message: "Pedido de landing page enfileirado. Os agents começam em até um minuto; a página vai nascer em preview (noindex).",
      };
    },
  },

  list_landing_pages: {
    spec: {
      name: "list_landing_pages",
      description:
        "Lista as landing pages de um cliente (id, subdomínio, status de deploy e do rascunho). Filtra por produto se informado. Use quando o operador quiser editar ou publicar uma LP, para descobrir o id correto.",
      input_schema: {
        type: "object",
        properties: {
          client_slug: { type: "string", description: "slug do cliente, ex.: brunobracaioli" },
          product_slug: { type: "string", description: "opcional: filtra por produto, ex.: cca" },
        },
        required: ["client_slug"],
      },
    },
    handler: async (input) => {
      const slug = str(input, "client_slug");
      if (!slug) return { error: "client_slug é obrigatório" };
      const client = await resolveClientId(slug);
      if (!client) return { error: `cliente '${slug}' não encontrado` };
      let productId: string | undefined;
      const product = str(input, "product_slug");
      if (product) {
        const pr = await db()
          .from("products")
          .select("id")
          .eq("client_id", client.id)
          .eq("slug", product)
          .maybeSingle();
        if (pr.error) throw pr.error;
        if (!pr.data) return { error: `produto '${product}' não encontrado para ${slug}` };
        productId = pr.data.id;
      }
      let query = db()
        .from("landing_pages")
        .select("id, name, subdomain, status, draft_status, url")
        .eq("client_id", client.id)
        .order("updated_at", { ascending: false })
        .limit(25);
      if (productId) query = query.eq("product_id", productId);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  },

  get_landing_page: {
    spec: {
      name: "get_landing_page",
      description:
        "Detalha uma landing page: suas seções (type/position) com as CHAVES e valores (truncados) de cada campo, mais tema e settings. É o mapa de 'endereços' para você mirar uma edição: a partir daqui você sabe o section_type e o field_path para request_landing_page_edit.",
      input_schema: {
        type: "object",
        properties: { landing_page_id: { type: "string", description: "uuid da landing page (use list_landing_pages)" } },
        required: ["landing_page_id"],
      },
    },
    handler: async (input) => {
      const id = str(input, "landing_page_id");
      if (!id) return { error: "landing_page_id é obrigatório" };
      const lp = await resolveLanding(id);
      if (!lp) return { error: "landing page não encontrada" };
      const secs = await db()
        .from("landing_page_sections")
        .select("type, position, enabled, fields")
        .eq("landing_page_id", id)
        .order("position", { ascending: true });
      if (secs.error) throw secs.error;
      const sections = (secs.data ?? []).map((s) => {
        const raw = (s.fields && typeof s.fields === "object" && !Array.isArray(s.fields)
          ? s.fields
          : {}) as Record<string, unknown>;
        const fields: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(raw)) {
          fields[k] = Array.isArray(v)
            ? `[lista com ${v.length} itens]`
            : v && typeof v === "object"
              ? "[objeto]"
              : truncateValue(v);
        }
        return { type: s.type, position: s.position, enabled: s.enabled, fields };
      });
      const settings = (lp.settings && typeof lp.settings === "object" ? lp.settings : {}) as Record<string, unknown>;
      return {
        id: lp.id,
        name: lp.name,
        subdomain: lp.subdomain,
        status: lp.status,
        draft_status: lp.draft_status,
        theme: lp.theme,
        settings: {
          cart_state: settings.cart_state,
          price_cents: settings.price_cents,
          noindex: settings.noindex,
          seo: settings.seo,
        },
        sections,
        note: "Para editar um texto escalar, use request_landing_page_edit com section_type + field_path (ex.: 'headline', 'subhead', 'items.0.title') + new_value. Listas/objetos inteiros só pelo painel do editor.",
      };
    },
  },

  request_landing_page_edit: {
    spec: {
      name: "request_landing_page_edit",
      description:
        "Edita UM campo de texto/número/sim-não de uma seção da landing page, aplicado DIRETO no rascunho do Supabase (edição barata, não vai ao ar até publicar). FLUXO OBRIGATÓRIO em dois passos: confirm=false devolve o de/para para você reler ao operador; confirm=true aplica só após o 'sim'. Se faltar seção/campo/valor, devolve needs_input — peça ao operador. Use get_landing_page para descobrir os endereços.",
      input_schema: {
        type: "object",
        properties: {
          landing_page_id: { type: "string", description: "uuid da LP (use list_landing_pages)" },
          section_type: { type: "string", description: "tipo da seção, ex.: hero, offer, faq" },
          field_path: { type: "string", description: "caminho do campo dentro da seção, ex.: 'headline', 'subhead', 'items.0.title'" },
          new_value: { type: "string", description: "novo valor do campo" },
          confirm: { type: "boolean", description: "false = devolve de/para; true = aplica (só após confirmação)" },
        },
        required: ["landing_page_id", "confirm"],
      },
    },
    handler: async (input) => {
      const id = str(input, "landing_page_id");
      if (!id) return { error: "landing_page_id é obrigatório" };
      const type = str(input, "section_type");
      const fieldPath = str(input, "field_path");
      const newValue =
        typeof input.new_value === "string"
          ? input.new_value
          : input.new_value != null
            ? String(input.new_value)
            : undefined;
      const confirm = input.confirm === true;
      if (!type)
        return { needs_input: true, field: "section_type", message: "Qual seção? (ex.: hero, offer, faq). Use get_landing_page para ver as seções." };
      if (!fieldPath)
        return { needs_input: true, field: "field_path", message: "Qual campo? (ex.: headline, subhead, items.0.title). Use get_landing_page para ver os campos." };
      if (newValue === undefined)
        return { needs_input: true, field: "new_value", message: "Qual o novo valor desse campo?" };

      const lp = await resolveLanding(id);
      if (!lp) return { error: "landing page não encontrada" };
      if (lp.draft_status === "generating" || lp.draft_status === "publishing")
        return { error: "a página está gerando ou publicando agora; espere terminar para editar" };

      const sec = await db()
        .from("landing_page_sections")
        .select("fields, version")
        .eq("landing_page_id", id)
        .eq("type", type)
        .maybeSingle();
      if (sec.error) throw sec.error;
      if (!sec.data) return { error: `a seção '${type}' não existe nessa página` };
      const fields0 = (sec.data.fields && typeof sec.data.fields === "object" && !Array.isArray(sec.data.fields)
        ? sec.data.fields
        : {}) as Record<string, unknown>;
      const res = applyScalarEdit(fields0, fieldPath, newValue);
      if (!res.ok) return { error: res.error };
      const check = validateSection(type, res.fields);
      if (!check.ok) return { error: check.error };

      if (!confirm) {
        return {
          confirmation_required: true,
          action: "editar landing page",
          subdomain: `${lp.subdomain}.b2tech.io`,
          section: type,
          field_path: fieldPath,
          from: truncateValue(res.applied.from),
          to: truncateValue(res.applied.to),
          note: "Edição barata aplicada direto no rascunho (não vai ao ar até publicar). Releia o de/para e confirme antes de chamar com confirm=true.",
        };
      }

      const { allowed } = await enforceLimit(rateLimiters.landingEdit(), id, "landing-edit");
      if (!allowed) return { error: "muitas edições nessa página agora; tente em instantes" };

      // Optimistic concurrency on `version`; on conflict re-read latest and re-apply once.
      let version = sec.data.version;
      let toFields: Record<string, unknown> = res.fields;
      let appliedTo: unknown = res.applied.to;
      for (let attempt = 0; attempt < 2; attempt++) {
        const upd = await db()
          .from("landing_page_sections")
          .update({ fields: toFields as Json, version: version + 1, updated_by: "ultron" })
          .eq("landing_page_id", id)
          .eq("type", type)
          .eq("version", version)
          .select("version")
          .maybeSingle();
        if (upd.error) throw upd.error;
        if (upd.data) {
          await logLandingOp(lp.client_id, id, `editou ${type}.${fieldPath}`);
          return {
            applied: true,
            landing_page_id: id,
            section: type,
            version: upd.data.version,
            at: new Date().toISOString(),
            field_path: fieldPath,
            to: truncateValue(appliedTo),
            message: "Pronto, ajustei no rascunho. Quer que eu publique?",
          };
        }
        const fresh = await db()
          .from("landing_page_sections")
          .select("fields, version")
          .eq("landing_page_id", id)
          .eq("type", type)
          .maybeSingle();
        if (fresh.error) throw fresh.error;
        if (!fresh.data) return { error: "a seção sumiu durante a edição" };
        const f0 = (fresh.data.fields && typeof fresh.data.fields === "object" && !Array.isArray(fresh.data.fields)
          ? fresh.data.fields
          : {}) as Record<string, unknown>;
        const r2 = applyScalarEdit(f0, fieldPath, newValue);
        if (!r2.ok) return { error: r2.error };
        version = fresh.data.version;
        toFields = r2.fields;
        appliedTo = r2.applied.to;
      }
      return { error: "a página mudou durante a edição; tente de novo" };
    },
  },

  request_landing_page_section_image: {
    spec: {
      name: "request_landing_page_section_image",
      description:
        "Define/troca a IMAGEM de uma seção da landing page (hero, problem, solution, features, proof, authority) por uma URL, direto no rascunho do Supabase. A URL deve ser https de imagem (de preferência uma já enviada ao bucket landing-assets pelo editor). O upload de arquivo é feito pelo operador no editor; aqui você só aplica a URL. FLUXO em dois passos: confirm=false devolve o de/para; confirm=true aplica após o 'sim'. Para REMOVER a imagem, passe image_url vazio.",
      input_schema: {
        type: "object",
        properties: {
          landing_page_id: { type: "string", description: "uuid da LP (use list_landing_pages)" },
          section_type: { type: "string", description: "hero|problem|solution|features|proof|authority" },
          image_url: { type: "string", description: "URL https da imagem (vazio = remover a imagem)" },
          confirm: { type: "boolean", description: "false = devolve de/para; true = aplica (só após confirmação)" },
        },
        required: ["landing_page_id", "confirm"],
      },
    },
    handler: async (input) => {
      const id = str(input, "landing_page_id");
      if (!id) return { error: "landing_page_id é obrigatório" };
      const type = str(input, "section_type");
      const imageUrl =
        typeof input.image_url === "string" ? input.image_url.trim() : input.image_url != null ? String(input.image_url) : undefined;
      const confirm = input.confirm === true;
      if (!type)
        return { needs_input: true, field: "section_type", message: "Qual seção? (hero, problem, solution, features, proof, authority)." };
      if (imageUrl === undefined)
        return { needs_input: true, field: "image_url", message: "Qual a URL da imagem? (ou vazio para remover)" };
      // Validate the URL unless clearing. Accept https rasters; block javascript:/data:/etc.
      if (imageUrl !== "") {
        const okScheme = /^https:\/\//i.test(imageUrl);
        const okShape =
          imageUrl.length <= 2000 &&
          (/\/storage\/v1\/object\/public\/landing-assets\//.test(imageUrl) ||
            /\.(png|jpe?g|webp|avif)(\?|#|$)/i.test(imageUrl));
        if (!okScheme || !okShape)
          return { error: "URL de imagem inválida — use https de uma imagem (png/jpg/webp/avif), idealmente do bucket landing-assets" };
      }

      const lp = await resolveLanding(id);
      if (!lp) return { error: "landing page não encontrada" };
      if (lp.draft_status === "generating" || lp.draft_status === "publishing")
        return { error: "a página está gerando ou publicando agora; espere terminar para editar" };

      const sec = await db()
        .from("landing_page_sections")
        .select("fields, version")
        .eq("landing_page_id", id)
        .eq("type", type)
        .maybeSingle();
      if (sec.error) throw sec.error;
      if (!sec.data) return { error: `a seção '${type}' não existe nessa página` };
      const fields0 = (sec.data.fields && typeof sec.data.fields === "object" && !Array.isArray(sec.data.fields)
        ? sec.data.fields
        : {}) as Record<string, unknown>;
      const res = applyScalarEdit(fields0, "image", imageUrl);
      if (!res.ok) return { error: res.error };
      const check = validateSection(type, res.fields);
      if (!check.ok)
        return { error: `a seção '${type}' não aceita imagem (${check.error})` };

      if (!confirm) {
        return {
          confirmation_required: true,
          action: imageUrl === "" ? "remover imagem da seção" : "trocar imagem da seção",
          subdomain: `${lp.subdomain}.b2tech.io`,
          section: type,
          field_path: "image",
          from: truncateValue(res.applied.from),
          to: truncateValue(res.applied.to),
          note: "Edição barata aplicada direto no rascunho (não vai ao ar até publicar). Confirme antes de chamar com confirm=true.",
        };
      }

      const { allowed } = await enforceLimit(rateLimiters.landingEdit(), id, "landing-edit");
      if (!allowed) return { error: "muitas edições nessa página agora; tente em instantes" };

      // Optimistic concurrency on `version`; on conflict re-read latest and re-apply once.
      let version = sec.data.version;
      let toFields: Record<string, unknown> = res.fields;
      let appliedTo: unknown = res.applied.to;
      for (let attempt = 0; attempt < 2; attempt++) {
        const upd = await db()
          .from("landing_page_sections")
          .update({ fields: toFields as Json, version: version + 1, updated_by: "ultron" })
          .eq("landing_page_id", id)
          .eq("type", type)
          .eq("version", version)
          .select("version")
          .maybeSingle();
        if (upd.error) throw upd.error;
        if (upd.data) {
          await logLandingOp(lp.client_id, id, `imagem de ${type}`);
          return {
            applied: true,
            landing_page_id: id,
            section: type,
            version: upd.data.version,
            at: new Date().toISOString(),
            field_path: "image",
            to: truncateValue(appliedTo),
            message: imageUrl === "" ? "Removi a imagem no rascunho. Quer que eu publique?" : "Troquei a imagem no rascunho. Quer que eu publique?",
          };
        }
        const fresh = await db()
          .from("landing_page_sections")
          .select("fields, version")
          .eq("landing_page_id", id)
          .eq("type", type)
          .maybeSingle();
        if (fresh.error) throw fresh.error;
        if (!fresh.data) return { error: "a seção sumiu durante a edição" };
        const f0 = (fresh.data.fields && typeof fresh.data.fields === "object" && !Array.isArray(fresh.data.fields)
          ? fresh.data.fields
          : {}) as Record<string, unknown>;
        const r2 = applyScalarEdit(f0, "image", imageUrl);
        if (!r2.ok) return { error: r2.error };
        version = fresh.data.version;
        toFields = r2.fields;
        appliedTo = r2.applied.to;
      }
      return { error: "a página mudou durante a edição; tente de novo" };
    },
  },

  request_landing_page_theme: {
    spec: {
      name: "request_landing_page_theme",
      description:
        "Ajusta UM token de design da landing page (cor, fonte ou escala) direto no rascunho. Tokens de cor: orange, orangeHi, navy900, navy800, text, textDim, bg, bgAlt (valor em hex, ex.: #FF6B1A). Fontes: font_title, font_body (nome de uma fonte da lista permitida). Escala: scale (número 0.8 a 1.3). FLUXO em dois passos (confirm=false devolve o que vai mudar; confirm=true aplica após o 'sim').",
      input_schema: {
        type: "object",
        properties: {
          landing_page_id: { type: "string", description: "uuid da LP" },
          token: { type: "string", description: "orange|orangeHi|navy900|navy800|text|textDim|bg|bgAlt|font_title|font_body|scale" },
          value: { type: "string", description: "hex (#RRGGBB), nome de fonte, ou número de escala" },
          confirm: { type: "boolean", description: "false = prévia; true = aplica" },
        },
        required: ["landing_page_id", "confirm"],
      },
    },
    handler: async (input) => {
      const id = str(input, "landing_page_id");
      if (!id) return { error: "landing_page_id é obrigatório" };
      const token = str(input, "token");
      const value =
        typeof input.value === "string" ? input.value : input.value != null ? String(input.value) : undefined;
      const confirm = input.confirm === true;
      if (!token)
        return { needs_input: true, field: "token", message: "Qual token de tema? Uma cor (orange, navy900, text, bg...), font_title, font_body ou scale." };
      if (value === undefined)
        return { needs_input: true, field: "value", message: "Qual o valor? Cor em hex (#FF6B1A), nome de fonte, ou número de escala." };

      const lp = await resolveLanding(id);
      if (!lp) return { error: "landing page não encontrada" };
      if (lp.draft_status === "generating" || lp.draft_status === "publishing")
        return { error: "a página está gerando ou publicando agora; espere terminar" };

      const patch = buildThemePatch(token, value);
      if (!patch) return { error: `token '${token}' desconhecido; use uma cor, font_title, font_body ou scale` };
      const parsed = themeSchema.safeParse(patch);
      if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "valor inválido para o tema" };

      if (!confirm) {
        return {
          confirmation_required: true,
          action: "ajustar tema da landing page",
          subdomain: `${lp.subdomain}.b2tech.io`,
          token,
          value,
          note: "Ajuste de design aplicado direto no rascunho (não vai ao ar até publicar). Confirme antes de chamar com confirm=true.",
        };
      }

      const { allowed } = await enforceLimit(rateLimiters.landingEdit(), id, "landing-edit");
      if (!allowed) return { error: "muitas edições nessa página agora; tente em instantes" };

      const current = (lp.theme && typeof lp.theme === "object" ? lp.theme : {}) as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...current };
      if (parsed.data.colors) merged.colors = { ...((current.colors as object) ?? {}), ...parsed.data.colors };
      if (parsed.data.fonts) merged.fonts = { ...((current.fonts as object) ?? {}), ...parsed.data.fonts };
      if (parsed.data.scale !== undefined) merged.scale = parsed.data.scale;
      const upd = await db().from("landing_pages").update({ theme: merged as Json }).eq("id", id);
      if (upd.error) throw upd.error;
      await logLandingOp(lp.client_id, id, `tema: ${token}=${value}`);
      return {
        applied: true,
        landing_page_id: id,
        section: "__theme",
        version: 0, // theme has no per-field version; the editor reconciles it by content
        at: new Date().toISOString(),
        token,
        value,
        message: "Tema ajustado no rascunho. Quer que eu publique?",
      };
    },
  },

  request_landing_page_publish: {
    spec: {
      name: "request_landing_page_publish",
      description:
        "Enfileira a PUBLICAÇÃO de uma landing page no Cloudflare (os agents serializam o rascunho atual, buildam e fazem deploy sob <subdomínio>.b2tech.io). Por padrão republica mantendo o noindex atual; passe noindex=false para go-live (indexável). FLUXO em dois passos: confirm=false devolve os detalhes; confirm=true enfileira após o 'sim'.",
      input_schema: {
        type: "object",
        properties: {
          landing_page_id: { type: "string", description: "uuid da LP (use list_landing_pages)" },
          noindex: { type: "boolean", description: "opcional; false = go-live indexável; omitido = mantém o estado atual" },
          confirm: { type: "boolean", description: "false = detalhes; true = enfileira (só após confirmação)" },
        },
        required: ["landing_page_id", "confirm"],
      },
    },
    handler: async (input, ctx) => {
      const id = str(input, "landing_page_id");
      if (!id) return { error: "landing_page_id é obrigatório" };
      const confirm = input.confirm === true;
      const lp = await resolveLanding(id);
      if (!lp) return { error: "landing page não encontrada" };
      if (!(await operatorOwnsClient(ctx.operatorId, lp.client_id))) return { error: "landing page não encontrada" };
      if (!(await operatorRunnerReady(ctx.operatorId))) return { error: RUNNER_NOT_READY };

      const clientRow = await db().from("clients").select("slug, name").eq("id", lp.client_id).maybeSingle();
      if (clientRow.error) throw clientRow.error;
      const slug = clientRow.data?.slug;
      const skill = slug ? PUBLISH_SKILL_BY_SLUG[slug] : undefined;
      if (!slug || !skill) return { error: "esta página não está habilitada para publicação automática" };

      const noindexParam = typeof input.noindex === "boolean" ? input.noindex : undefined;
      const noindex = noindexParam !== undefined ? (noindexParam ? 1 : 0) : lp.noindex ? 1 : 0;

      if (!confirm) {
        return {
          confirmation_required: true,
          action: "publicar landing page",
          client: clientRow.data?.name,
          subdomain: `${lp.subdomain}.b2tech.io`,
          indexavel: noindex === 0,
          note:
            noindex === 0
              ? "Vai publicar INDEXÁVEL (go-live, aparece no Google). Confirme antes de chamar com confirm=true."
              : "Vai publicar/republicar em PREVIEW (noindex, não indexável). Confirme antes de chamar com confirm=true.",
        };
      }

      const { allowed } = await enforceLimit(rateLimiters.landingPublish(), slug, "landing-publish");
      if (!allowed) return { error: "muitos pedidos de publicação agora; tente daqui a pouco" };

      const { data, error } = await db()
        .from("agent_jobs")
        .insert({
          client_id: lp.client_id,
          operator_id: ctx.operatorId,
          skill,
          kind: "landing_publish",
          landing_page_id: id,
          args: { landing_page_id: id, noindex },
          requested_by: "ultron",
        })
        .select("id")
        .single();
      if (error) {
        if (isUniqueViolation(error)) {
          return { enqueued: false, reason: "já existe uma publicação em andamento para esta página" };
        }
        throw error;
      }
      await logLandingOp(lp.client_id, id, `publish enfileirado (noindex=${noindex})`);
      return {
        enqueued: true,
        job_id: data.id,
        subdomain: `${lp.subdomain}.b2tech.io`,
        indexavel: noindex === 0,
        queued_at: new Date().toISOString(),
        message: "Publicação enfileirada; os agents publicam em até um minuto.",
      };
    },
  },

  request_live_review: {
    spec: {
      name: "request_live_review",
      description:
        "Inicia uma REVISÃO VISUAL AO VIVO de uma landing page no navegador do operador (operador PRESENTE, ex.: gravação): a página sobe em tela cheia e você percorre seção a seção — rola, olha (visão) e COMENTA por voz — até o rodapé, com o painel 3D renderizando de verdade. Use quando o operador disser algo como 'revisa a página comigo', 'abre a landing e me mostra o que achou', 'faz a revisão ao vivo'. NÃO publica nem edita nada — só abre e narra. Risco baixo, sem gasto de mídia: NÃO precisa de confirmação em dois passos. Pré-requisito: a landing já existe (use list_landing_pages para o id).",
      input_schema: {
        type: "object",
        properties: {
          landing_page_id: { type: "string", description: "uuid da LP (use list_landing_pages)" },
        },
        required: ["landing_page_id"],
      },
    },
    handler: async (input) => {
      const id = str(input, "landing_page_id");
      if (!id) return { error: "landing_page_id é obrigatório" };
      const lp = await resolveLanding(id);
      if (!lp) return { error: "landing page não encontrada" };
      if (lp.draft_status === "generating")
        return { error: "a página ainda está sendo gerada; espere terminar para a gente revisar ao vivo" };
      // The overlay embeds the same-origin preview with ?review=1 so the ReviewBridge activates.
      const previewUrl = `/lp-preview/${id}?review=1`;
      return {
        start_review: true,
        landingPageId: id,
        previewUrl,
        at: new Date().toISOString(),
        subdomain: `${lp.subdomain}.b2tech.io`,
        message: "Beleza, vou abrir a página em tela cheia e revisar com você, seção por seção.",
      };
    },
  },

  get_recent_jobs: {
    spec: {
      name: "get_recent_jobs",
      description:
        "Estado dos pedidos recentes que o Ultron enfileirou para a VM (criação/ativação): status, erro e horários. Use para responder 'começou?', 'terminou?', 'deu certo?'. Filtra por cliente se informado.",
      input_schema: {
        type: "object",
        properties: {
          client_slug: { type: "string", description: "opcional" },
          limit: { type: "number", description: "padrão 10, máximo 25" },
        },
      },
    },
    handler: async (input) => {
      const slug = str(input, "client_slug");
      const rawLimit = typeof input.limit === "number" ? input.limit : 10;
      const limit = Math.min(Math.max(1, rawLimit), 25);
      let query = db()
        .from("agent_jobs")
        .select("kind, skill, status, error, exit_code, created_at, started_at, finished_at")
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

  start_autonomous_mode: {
    spec: {
      name: "start_autonomous_mode",
      description:
        "Liga o MODO AUTÔNOMO: o Ultron passa a monitorar sozinho uma tarefa longa que JÁ FOI enfileirada (hoje: a CRIAÇÃO de uma landing page) e vai te narrando o progresso por voz, periodicamente, até concluir. Use quando o operador disser algo como 'vou ter que sair, inicia o modo autônomo e monitora a execução'. PRÉ-REQUISITO: já deve existir um pedido de criação de landing page recente para o cliente (via request_landing_page_creation) — este tool NÃO cria nada, só passa a observar. Risco baixo, sem gasto: NÃO precisa de confirmação em dois passos.",
      input_schema: {
        type: "object",
        properties: {
          client_slug: { type: "string", description: "slug do cliente, ex.: brunobracaioli" },
        },
        required: ["client_slug"],
      },
    },
    handler: async (input, ctx) => {
      const slug = str(input, "client_slug");
      if (!slug) return { error: "client_slug é obrigatório" };
      const client = await resolveClientId(slug);
      if (!client) return { error: `cliente '${slug}' não encontrado` };
      if (!(await operatorOwnsClient(ctx.operatorId, client.id))) return { error: `cliente '${slug}' não encontrado` };

      // Find the landing-page creation job to watch: the most recent kind='landing' job for the
      // client that is still in flight or just completed. We watch the CREATION job; the tick
      // skill follows through to the publish job + deployed URL on its own.
      const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { data: job, error: jobErr } = await db()
        .from("agent_jobs")
        .select("id, status, args, created_at")
        .eq("client_id", client.id)
        .eq("kind", "landing")
        .in("status", ["pending", "claimed", "running", "completed"])
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (jobErr) throw jobErr;
      if (!job) {
        return {
          started: false,
          reason:
            "não encontrei uma criação de landing page recente para monitorar. Primeiro peça para criar a landing page; depois ative o modo autônomo.",
        };
      }

      const argsObj = (job.args && typeof job.args === "object" && !Array.isArray(job.args)
        ? job.args
        : {}) as Record<string, unknown>;
      const nome = str(argsObj, "nome");
      const { data: watch, error: insErr } = await db()
        .from("autonomous_watches")
        .insert({
          client_id: client.id,
          target_kind: "landing_page",
          agent_job_id: job.id,
          target_hint: nome ?? null,
          session_id: ctx.sessionId,
          started_by: "ultron",
        })
        .select("id")
        .single();
      if (insErr) {
        if (isUniqueViolation(insErr)) {
          return { started: false, reason: "já estou monitorando essa tarefa no modo autônomo" };
        }
        throw insErr;
      }
      await logLandingOp(client.id, job.id, "modo autônomo iniciado");
      return {
        started: true,
        watch_id: watch.id,
        target_hint: nome,
        client_slug: slug,
        message:
          "Modo autônomo ativado. Vou monitorar a criação da landing page e te narrar o progresso por voz a cada par de minutos; quando ficar pronta, eu te aviso. Pode sair tranquilo.",
      };
    },
  },

  stop_autonomous_mode: {
    spec: {
      name: "stop_autonomous_mode",
      description:
        "Desliga o MODO AUTÔNOMO desta sessão: para de monitorar e narrar. Use quando o operador disser 'pode sair do modo autônomo', 'para de monitorar', 'cancela o modo autônomo'.",
      input_schema: { type: "object", properties: {} },
    },
    handler: async (_input, ctx) => {
      const { data, error } = await db()
        .from("autonomous_watches")
        .update({ phase: "done", closed_at: new Date().toISOString() })
        .eq("session_id", ctx.sessionId)
        .in("phase", ["watching", "reviewing", "notifying"])
        .select("id");
      if (error) throw error;
      const stopped = data?.length ?? 0;
      return {
        stopped,
        message:
          stopped > 0
            ? "Saindo do modo autônomo. Parei de monitorar."
            : "Não havia nada sendo monitorado no momento.",
      };
    },
  },
};

export const toolSpecs: Anthropic.Tool[] = [
  ...Object.values(tools).map((t) => t.spec),
  CAPTURE_SCREEN_TOOL,
];

// --- Dynamic, operator-authored skill tools (SPEC-018 Wave 5) ---
// Skills flagged ultron_enabled+active are exposed to Ultron as function-callable tools, built per
// request from the DB (scoped to the operator). The handler only ENQUEUES an agent_jobs row
// (kind=custom) — it never touches Meta directly. Write-capability skills keep the two-turn confirm.

export type DynamicSkillTool = {
  spec: Anthropic.Tool;
  skillId: string;
  clientId: string;
  productId: string;
  slug: string;
  capability: "read" | "write";
};

type UltronFunction = { name: string; description: string; parameters: Record<string, unknown> };

const DYNAMIC_TOOL_PREFIX = "skill_";

function buildDynamicSpec(fn: UltronFunction, capability: "read" | "write"): Anthropic.Tool {
  // Namespace the tool so it can never collide with a static tool name.
  const name = `${DYNAMIC_TOOL_PREFIX}${fn.name}`;
  const base = (fn.parameters && typeof fn.parameters === "object" ? fn.parameters : {}) as Record<string, unknown>;
  const properties = { ...((base.properties as Record<string, unknown>) ?? {}) };
  let description = fn.description;
  if (capability === "write") {
    // Mirror the static write-tool convention: confirm=false first, read to operator, then confirm=true.
    properties.confirm = {
      type: "boolean",
      description: "false = devolve os detalhes para confirmar; true = enfileira de fato (só após 'sim' explícito)",
    };
    description +=
      " A skill faz ESCRITA (pode gerar gasto). FLUXO OBRIGATÓRIO: chame com confirm=false, leia ao operador e peça confirmação; só chame com confirm=true após um 'sim' explícito. Sobe PAUSED.";
  }
  return {
    name,
    description,
    input_schema: { type: "object", properties, ...(base.required ? { required: base.required as string[] } : {}) },
  };
}

/** Build the operator's Ultron-callable skill tools from the DB (active + ultron_enabled). */
export async function loadDynamicSkillTools(operatorId: string | null): Promise<DynamicSkillTool[]> {
  if (!operatorId) return [];
  const { data, error } = await db()
    .from("client_skills")
    .select("id, client_id, product_id, slug, capability, ultron_function")
    .eq("operator_id", operatorId)
    .eq("ultron_enabled", true)
    .eq("status", "active");
  if (error) throw error;
  const out: DynamicSkillTool[] = [];
  for (const row of data ?? []) {
    const fn = row.ultron_function as UltronFunction | null;
    if (!fn || typeof fn.name !== "string") continue;
    const capability = row.capability === "write" ? "write" : "read";
    out.push({
      spec: buildDynamicSpec(fn, capability),
      skillId: row.id,
      clientId: row.client_id,
      productId: row.product_id,
      slug: row.slug,
      capability,
    });
  }
  return out;
}

/** Enqueue a custom-skill job from an Ultron tool call. Mirrors the static write-tool flow. */
async function enqueueDynamicSkill(
  tool: DynamicSkillTool,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  if (!(await operatorRunnerReady(ctx.operatorId))) return { error: RUNNER_NOT_READY };

  if (tool.capability === "write" && input.confirm !== true) {
    return {
      confirmation_required: true,
      action: `executar a skill ${tool.slug}`,
      note: "A skill faz escrita e sobe PAUSED (gasto só com ativação explícita). Confirme com o operador antes de chamar com confirm=true.",
    };
  }

  // Pass the model-provided args through (minus the control flag) for the skill to read.
  const args: Record<string, unknown> = { ...input };
  delete args.confirm;

  const { data, error } = await db()
    .from("agent_jobs")
    .insert({
      client_id: tool.clientId,
      product_id: tool.productId,
      operator_id: ctx.operatorId,
      skill: tool.slug,
      skill_id: tool.skillId,
      kind: "custom",
      args: args as Json,
      requested_by: "ultron",
    })
    .select("id")
    .single();
  if (error) {
    if (isUniqueViolation(error)) {
      return { enqueued: false, reason: `já existe uma execução em andamento da skill ${tool.slug}` };
    }
    throw error;
  }
  return {
    enqueued: true,
    job_id: data.id,
    skill: tool.slug,
    kind: "custom",
    queued_at: new Date().toISOString(),
    message: "Pedido enfileirado. Os agents começam em até um minuto.",
  };
}

export async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext = { sessionId: "", operatorId: null },
  dynamicTools: DynamicSkillTool[] = [],
): Promise<unknown> {
  const tool = tools[name];
  if (!tool) {
    const dyn = dynamicTools.find((t) => t.spec.name === name);
    if (dyn) {
      try {
        return await enqueueDynamicSkill(dyn, input, ctx);
      } catch (err) {
        console.warn(JSON.stringify({ level: "warn", event: "ultron_dynamic_tool_error", tool: name, message: err instanceof Error ? err.message : "unknown" }));
        return { error: "falha ao enfileirar a skill" };
      }
    }
    return { error: `tool desconhecida: ${name}` };
  }
  try {
    return await tool.handler(input, ctx);
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
