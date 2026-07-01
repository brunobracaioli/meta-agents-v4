import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import { TOOL_GROUPS, isValidGroupId, selectionHasWrite } from "@/lib/skills/catalog";

// SPEC-018 Wave 3 — AI-assisted skill authoring. The operator describes a goal in plain language;
// Claude drafts a SKILL.md (instructions), picks the MINIMAL tool groups from the curated catalog,
// and sets the capability tier. The draft is NOT persisted — the operator reviews/edits it in the
// wizard, then POST /api/skills creates it. We force a tool call so the output is structured and
// validated, never free-form prose we have to parse.

const MODEL = process.env.SKILL_DRAFT_MODEL ?? "claude-sonnet-5";
const MAX_TOKENS = 2048;

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: env.anthropicApiKey() });
  return client;
}

export type SkillDraft = {
  name: string;
  description: string;
  body: string;
  tool_groups: string[];
  capability: "read" | "write";
};

const CATALOG_TEXT = TOOL_GROUPS.map((g) => `- ${g.id} (${g.tier}): ${g.label} — ${g.description}`).join("\n");

const SYSTEM_PROMPT = `Você projeta "skills" para uma agência de tráfego Meta Ads operada por IA.
Uma skill é um arquivo de instruções (markdown) que um agente autônomo executa via \`claude -p\`,
usando ferramentas MCP da Meta. Você recebe o OBJETIVO do operador e o cliente alvo, e produz um
rascunho de skill.

Regras:
- Escreva o corpo (body) em pt-BR, em markdown, com passos NUMERADOS, claros e determinísticos.
  Comece com uma linha de objetivo, depois "## Passos", e inclua uma seção "## Critério de sucesso".
- Refira-se ao cliente e ao PRODUTO pelos slugs fornecidos. A skill é específica do produto:
  adapte os passos ao contexto do produto (oferta, preço, público). Resolva constantes
  (ad account etc.) em runtime consultando o banco — não invente IDs.
- Escolha o MENOR conjunto de grupos de ferramentas necessário, apenas do catálogo abaixo (use os ids).
- capability = "write" SOMENTE se a skill cria/ativa/pausa campanhas (qualquer grupo "write").
  Caso contrário "read". Skills de escrita devem subir tudo PAUSADO e respeitar o budget cap.
- NUNCA inclua segredos, tokens ou credenciais no corpo.
- name: título curto e humano. description: uma frase.

Catálogo de grupos de ferramentas (id (tier): rótulo — descrição):
${CATALOG_TEXT}`;

const DRAFT_TOOL: Anthropic.Tool = {
  name: "emit_skill_draft",
  description: "Emite o rascunho estruturado da skill.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Título curto e humano da skill." },
      description: { type: "string", description: "Uma frase descrevendo o que a skill faz." },
      body: { type: "string", description: "O corpo do SKILL.md em markdown (pt-BR, passos numerados)." },
      tool_groups: {
        type: "array",
        items: { type: "string" },
        description: "Ids dos grupos de ferramentas do catálogo (mínimo necessário).",
      },
      capability: { type: "string", enum: ["read", "write"] },
    },
    required: ["name", "description", "body", "tool_groups", "capability"],
  },
};

export async function buildSkillDraft(input: {
  goal: string;
  clientSlug: string;
  clientName: string;
  productSlug: string;
  productName: string;
  productBrief?: string;
}): Promise<SkillDraft> {
  // Keep the brief excerpt bounded so a large product brief can't blow the prompt budget.
  const briefExcerpt = (input.productBrief ?? "").trim().slice(0, 2000);
  const productLine = `Produto: ${input.productName} (slug: ${input.productSlug}).${
    briefExcerpt ? `\nContexto do produto:\n${briefExcerpt}` : ""
  }`;

  const res = await anthropic().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: [DRAFT_TOOL],
    tool_choice: { type: "tool", name: "emit_skill_draft" },
    messages: [
      {
        role: "user",
        content: `Cliente: ${input.clientName} (slug: ${input.clientSlug}).\n${productLine}\nObjetivo do operador:\n${input.goal}`,
      },
    ],
  });

  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) throw new Error("model did not emit a skill draft");
  const raw = block.input as Partial<SkillDraft>;

  // Defence in depth: the model is instructed to use catalog ids, but we never trust it — drop any
  // unknown group id, and force capability='write' if any surviving group is write-tier.
  const groups = Array.isArray(raw.tool_groups) ? raw.tool_groups.filter((g) => typeof g === "string" && isValidGroupId(g)) : [];
  const capability: "read" | "write" = selectionHasWrite(groups) ? "write" : raw.capability === "write" ? "write" : "read";

  return {
    name: (raw.name ?? "").toString().slice(0, 120) || "Nova skill",
    description: (raw.description ?? "").toString().slice(0, 500),
    body: (raw.body ?? "").toString().slice(0, 20_000),
    tool_groups: groups,
    capability,
  };
}
