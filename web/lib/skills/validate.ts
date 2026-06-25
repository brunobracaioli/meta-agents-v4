import { z } from "zod";
import { isValidGroupId, selectionHasWrite } from "@/lib/skills/catalog";

// SPEC-018 §3.2 — validation for operator-authored skills. Every external field is bounded.
// The wizard/API speak in catalog GROUP IDS (not raw tool names); the API expands them to concrete
// `allowed-tools` server-side. capability must be 'write' iff a write-tier group was picked.

const SLUG_RE = /^[a-z0-9-]{2,40}$/;

// Slugs of baked, slug-specific skills shipped in the runner image. A custom skill may not shadow
// them (the runner also refuses to overwrite an on-disk skill, this is the earlier, clearer guard).
export const RESERVED_SLUGS = new Set<string>([
  "activate-campaign-brunobracaioli",
  "analytic-traffic-brunobracaioli-campaign",
  "autonomous-watch-tick",
  "commit",
  "create-landing-page-brunobracaioli",
  "create-sales-brunobracaioli-campaign",
  "create-traffic-brunobracaioli-campaign",
  "daily-summary-brunobracaioli",
  "funnel-analytics-brunobracaioli-campaign",
  "image-generate",
  "lista-de-clientes",
  "lista-de-produtos",
  "publish-landing-page-brunobracaioli",
]);

// JSON-schema-ish object for an Ultron function. We don't validate the full JSON Schema spec —
// just that it's an object with the expected top-level shape and bounded sizes.
const ultronFunctionSchema = z.object({
  name: z.string().regex(/^[a-z0-9_]{2,48}$/, "function name deve ser [a-z0-9_], 2-48"),
  description: z.string().trim().min(1).max(500),
  parameters: z.record(z.unknown()),
});

const baseSkillFields = {
  clientId: z.string().uuid(),
  slug: z
    .string()
    .regex(SLUG_RE, "slug deve ser [a-z0-9-], 2-40 chars")
    .refine((s) => !RESERVED_SLUGS.has(s), "slug reservado (skill embutida)"),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  body: z.string().trim().min(1).max(20_000),
  tool_groups: z.array(z.string()).max(40).refine((g) => g.every(isValidGroupId), "grupo de tool inválido"),
  capability: z.enum(["read", "write"]).default("read"),
  ultron_enabled: z.boolean().default(false),
  ultron_function: ultronFunctionSchema.nullish(),
  status: z.enum(["draft", "active", "disabled"]).default("draft"),
};

// Shared cross-field rules: write tools require capability='write'; Ultron exposure requires a
// function definition; a function name must not be empty when exposed.
function refineSkill<T extends z.ZodTypeAny>(schema: T): z.ZodEffects<T> {
  return schema.superRefine((val: unknown, ctx) => {
    const v = val as {
      tool_groups?: string[];
      capability?: string;
      ultron_enabled?: boolean;
      ultron_function?: unknown;
    };
    if (v.tool_groups && selectionHasWrite(v.tool_groups) && v.capability !== "write") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "tools de escrita exigem capability='write'", path: ["capability"] });
    }
    if (v.ultron_enabled && !v.ultron_function) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "exposição ao Ultron exige ultron_function", path: ["ultron_function"] });
    }
  });
}

export const skillCreateSchema = refineSkill(z.object(baseSkillFields));

// PATCH: slug + clientId immutable; everything else optional + a version for optimistic concurrency.
export const skillPatchSchema = refineSkill(
  z.object({
    name: baseSkillFields.name.optional(),
    description: baseSkillFields.description,
    body: baseSkillFields.body.optional(),
    tool_groups: baseSkillFields.tool_groups.optional(),
    capability: z.enum(["read", "write"]).optional(),
    ultron_enabled: z.boolean().optional(),
    ultron_function: baseSkillFields.ultron_function,
    status: z.enum(["draft", "active", "disabled"]).optional(),
    version: z.number().int().min(1),
  }),
);

export type SkillCreateInput = z.infer<typeof skillCreateSchema>;
export type SkillPatchInput = z.infer<typeof skillPatchSchema>;
