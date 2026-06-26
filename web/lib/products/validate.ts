import { z } from "zod";

// SPEC-018.1 — validation for product management. A product belongs to a client (client_id),
// scoped per operator via the client. slug is unique per client and becomes part of URLs
// (/dashboard/clients/<client>/<product>) and the landing subdomain, so charset is constrained.

const SLUG_RE = /^[a-z0-9-]{2,40}$/;

export const productInputSchema = z.object({
  clientId: z.string().uuid(),
  slug: z.string().regex(SLUG_RE, "slug deve ser [a-z0-9-], 2-40 chars"),
  name: z.string().trim().min(1).max(120),
  default_subdomain: z.string().trim().max(63).nullish(),
  status: z.enum(["active", "archived"]).default("active"),
});

// PATCH: slug + clientId immutable (slug is baked into product URLs / the landing flow).
export const productPatchSchema = productInputSchema.partial().omit({ clientId: true, slug: true });

export type ProductInput = z.infer<typeof productInputSchema>;
