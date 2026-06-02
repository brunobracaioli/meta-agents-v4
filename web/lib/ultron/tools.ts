import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db/client";
import { rateLimiters, enforceLimit } from "@/lib/ratelimit";

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
