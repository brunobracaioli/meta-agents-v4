import { z } from "zod";

// SPEC-018 §3.2 — input validation for the client-management surface. Every external field is
// bounded (anti-DoS) and typed. `slug`/`ad_account_id` are the runner+Meta identifiers, so their
// charset is constrained to what the poller args and Graph API accept.

const SLUG_RE = /^[a-z0-9-]{2,40}$/;

export const clientInputSchema = z.object({
  slug: z.string().regex(SLUG_RE, "slug deve ser [a-z0-9-], 2-40 chars"),
  name: z.string().trim().min(1).max(120),
  ad_account_id: z.string().trim().min(1).max(64),
  business_manager_id: z.string().trim().max(64).nullish(),
  facebook_page_id: z.string().trim().max(64).nullish(),
  default_landing_url: z.string().trim().url().max(500).nullish(),
  daily_budget_cap_cents: z.number().int().min(0).max(100_000_000),
  currency: z.string().trim().length(3),
  materials_path: z.string().trim().max(200).nullish(),
});

// PATCH allows a partial update; slug stays immutable post-creation (it is baked into runner args,
// Cloudflare project names and skill workspaces — renaming would orphan those references).
export const clientPatchSchema = clientInputSchema.partial().omit({ slug: true });

export type ClientInput = z.infer<typeof clientInputSchema>;
