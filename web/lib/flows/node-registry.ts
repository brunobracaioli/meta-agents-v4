import { z } from "zod";

// SPEC-020 §4 — single source of truth for the Flow Builder cards. Each node type declares
// its config contract (Zod), typed input ports and output payload type. The editor renders
// the palette/config panel from this registry and graph-validate.ts enforces it; Wave 2
// mirrors these contracts as JSON Schemas in .claude/skills/flow-step-runner/contracts/
// (CI parity test is a Wave 4 deliverable). The graph NEVER chooses a skill — node types
// are code-owned here and CHECKed in the DB (§7).

export type PayloadType =
  | "ScrapeResult"
  | "CopyVariations"
  | "ImageAssets"
  | "MetaCampaignRef"
  | "Approval"
  | "VideoAssets"
  | "LandingPageRef";

export type NodeKind = "trigger" | "action" | "gate";

export type NodeType = "scrape" | "copy" | "image_creative" | "approval" | "meta_campaign";

export type InputPort = {
  key: string; // = edge.targetHandle
  label: string;
  accepts: PayloadType[];
  required: boolean;
};

export type NodeTypeDef = {
  type: NodeType;
  kind: NodeKind;
  label: string;
  description: string;
  configSchema: z.ZodType;
  inputPorts: InputPort[];
  outputType: PayloadType;
  /** Gates forward their input payload untouched — the effective downstream type is the
   * upstream's (resolved by graph-validate). `outputType` is the fallback when unwired. */
  passthrough?: boolean;
};

/** The single source handle every node emits on (one output port per node in v1). */
export const OUTPUT_HANDLE = "out";

export const MAX_GRAPH_NODES = 30;
export const MAX_REFERENCE_ASSETS = 16;

const ALL_PAYLOAD_TYPES: PayloadType[] = [
  "ScrapeResult",
  "CopyVariations",
  "ImageAssets",
  "MetaCampaignRef",
  "Approval",
  "VideoAssets",
  "LandingPageRef",
];

// --- SSRF guard (string layer — SPEC-020 §4.1) -------------------------------------------
// First of two layers: the scrape-extractor subagent re-validates after DNS resolution.
// Rejects non-https, explicit ports, IP-literal hosts and obviously-internal hostnames.

const PRIVATE_HOST_SUFFIXES = [".local", ".localhost", ".internal", ".lan"];

export function isSafePublicHttpsUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.port !== "") return false; // default port only
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || PRIVATE_HOST_SUFFIXES.some((s) => host.endsWith(s))) return false;
  if (host.startsWith("[") || /^[0-9a-f:]+$/i.test(host)) return false; // IPv6 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false; // any IPv4 literal — scrape targets are DNS names
  if (!host.includes(".")) return false; // bare intranet names
  return true;
}

const safeHttpsUrl = z
  .string()
  .trim()
  .max(2000)
  .url({ message: "URL inválida" })
  .refine(isSafePublicHttpsUrl, {
    message: "Use uma URL https pública (sem IP, localhost ou porta não-padrão)",
  });

// --- Config schemas (SPEC-020 §4.1–§4.5) --------------------------------------------------

const scrapeConfigSchema = z.object({
  url: safeHttpsUrl,
});

const copyConfigSchema = z.object({
  objective: z.enum(["traffic", "sales", "leads"]),
  // Literal 3 in v1 (the operator's ask); widening to 1..5 later is non-breaking.
  variations: z.literal(3).default(3),
  toneHints: z.string().trim().max(200).optional(),
  language: z.enum(["pt-BR", "en-US"]).default("pt-BR"),
});

const imageCreativeConfigSchema = z.object({
  aspect: z.enum(["1:1", "9:16", "1.91:1"]),
  variants: z.number().int().min(1).max(3).default(1),
  // FKs into flow_assets; refs are passed to image-generate as `refs=` which forces the
  // /v1/images/edits route — the mechanism that guarantees logos/references appear.
  referenceAssetIds: z.array(z.string().uuid()).max(MAX_REFERENCE_ASSETS).default([]),
  brandNotes: z.string().trim().max(300).optional(),
});

const approvalConfigSchema = z.object({
  notifyTelegram: z.boolean().default(true),
});

const metaCampaignConfigSchema = z
  .object({
    campaignType: z.enum(["OUTCOME_TRAFFIC", "OUTCOME_SALES", "OUTCOME_LEADS"]),
    pixelId: z.string().trim().regex(/^\d{5,20}$/, "pixelId numérico").optional(),
    pageId: z.string().trim().regex(/^\d{5,20}$/, "pageId numérico"),
    linkUrl: safeHttpsUrl,
    dailyBudgetCents: z.number().int().positive(),
    campaignName: z.string().trim().max(80).optional(),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.campaignType !== "OUTCOME_TRAFFIC" && !cfg.pixelId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pixelId"],
        message: "Pixel é obrigatório para campanhas de vendas/leads",
      });
    }
  });

// --- Registry ------------------------------------------------------------------------------

export const NODE_REGISTRY: Record<NodeType, NodeTypeDef> = {
  scrape: {
    type: "scrape",
    kind: "action",
    label: "Scraping",
    description: "Extrai o brief (tema, proposta de valor, CTA, tom, paleta) de uma URL pública.",
    configSchema: scrapeConfigSchema,
    inputPorts: [],
    outputType: "ScrapeResult",
  },
  copy: {
    type: "copy",
    kind: "action",
    label: "Copy",
    description: "Gera 3 variações de copy de anúncio, cada uma com um gatilho mental distinto.",
    configSchema: copyConfigSchema,
    inputPorts: [{ key: "scrape", label: "Scrape", accepts: ["ScrapeResult"], required: true }],
    outputType: "CopyVariations",
  },
  image_creative: {
    type: "image_creative",
    kind: "action",
    label: "Criativo de imagem",
    description:
      "Gera imagens (gpt-image-2) alinhadas ao brief/copy; referências e logos anexados SEMPRE aparecem.",
    configSchema: imageCreativeConfigSchema,
    // Multi-input: ≥1 connected (extra graph rule in graph-validate.ts).
    inputPorts: [
      { key: "scrape", label: "Scrape", accepts: ["ScrapeResult"], required: false },
      { key: "copy", label: "Copy", accepts: ["CopyVariations"], required: false },
    ],
    outputType: "ImageAssets",
  },
  approval: {
    type: "approval",
    kind: "gate",
    label: "Aprovação humana",
    description: "Pausa o run até o operador revisar e aprovar; repassa o payload intacto.",
    configSchema: approvalConfigSchema,
    inputPorts: [{ key: "payload", label: "Payload", accepts: ALL_PAYLOAD_TYPES, required: true }],
    outputType: "Approval",
    passthrough: true,
  },
  meta_campaign: {
    type: "meta_campaign",
    kind: "action",
    label: "Meta MCP B2 Tech",
    description:
      "Cria campanha + ad set + creatives + ads via connector Meta — tudo nasce PAUSED.",
    configSchema: metaCampaignConfigSchema,
    inputPorts: [
      { key: "copy", label: "Copy", accepts: ["CopyVariations"], required: true },
      { key: "images", label: "Imagens", accepts: ["ImageAssets"], required: true },
    ],
    outputType: "MetaCampaignRef",
  },
};

export const NODE_TYPES = Object.keys(NODE_REGISTRY) as [NodeType, ...NodeType[]];

export function nodeDef(type: string): NodeTypeDef | null {
  return (NODE_REGISTRY as Record<string, NodeTypeDef>)[type] ?? null;
}

/** Default config for a freshly dropped node — schema defaults where they exist,
 * empty object otherwise (the config panel guides the operator through the rest). */
export function defaultConfig(type: NodeType): Record<string, unknown> {
  const parsed = NODE_REGISTRY[type].configSchema.safeParse({});
  if (parsed.success) return parsed.data as Record<string, unknown>;
  switch (type) {
    case "copy":
      return { objective: "traffic", variations: 3, language: "pt-BR" };
    case "image_creative":
      return { aspect: "1:1", variants: 1, referenceAssetIds: [] };
    default:
      return {};
  }
}
