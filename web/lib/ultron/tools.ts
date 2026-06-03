import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db/client";
import type { Json } from "@/lib/db/types";
import { rateLimiters, enforceLimit } from "@/lib/ratelimit";
import { validateSectionFields, themeSchema } from "@/lib/landing/validate";
import { applyScalarEdit } from "@/lib/landing/edit-path";

/**
 * Tools the Ultron assistant can call. The data tools run parameterized SELECTs
 * and return plain JSON. The two write tools (request_campaign_creation,
 * request_campaign_activation) do NOT touch the Meta API directly — they only
 * enqueue a job into `agent_jobs` for the Fly.io runner to execute. The skill name
 * is resolved server-side from a fixed allowlist below (never free-form user text),
 * and both require an explicit two-turn confirmation (see prompt.ts).
 */

type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>;

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
const ACTIVATE_SKILL_BY_SLUG: Record<string, string> = {
  brunobracaioli: "activate-campaign-brunobracaioli",
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
    handler: async (input) => {
      const slug = str(input, "client_slug");
      const confirm = input.confirm === true;
      if (!slug) return { error: "client_slug é obrigatório" };
      const client = await resolveClientId(slug);
      if (!client) return { error: `cliente '${slug}' não encontrado` };
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
    handler: async (input) => {
      const slug = str(input, "client_slug");
      const campaignMetaId = str(input, "campaign_meta_id");
      const confirm = input.confirm === true;
      if (!slug) return { error: "client_slug é obrigatório" };
      if (!campaignMetaId) return { error: "campaign_meta_id é obrigatório" };
      const client = await resolveClientId(slug);
      if (!client) return { error: `cliente '${slug}' não encontrado` };
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
    handler: async (input) => {
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
      const check = validateSectionFields(res.fields);
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
          return {
            applied: true,
            section: type,
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
      return { applied: true, token, value, message: "Tema ajustado no rascunho. Quer que eu publique?" };
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
    handler: async (input) => {
      const id = str(input, "landing_page_id");
      if (!id) return { error: "landing_page_id é obrigatório" };
      const confirm = input.confirm === true;
      const lp = await resolveLanding(id);
      if (!lp) return { error: "landing page não encontrada" };

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
};

export const toolSpecs: Anthropic.Tool[] = [
  ...Object.values(tools).map((t) => t.spec),
  CAPTURE_SCREEN_TOOL,
];

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
