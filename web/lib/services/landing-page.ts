import "server-only";
import { db } from "@/lib/db/client";
import type { ContentDoc, Settings, Theme } from "@b2tech/lp-render/content-doc";
import type { SectionType } from "@b2tech/lp-render/content-types";

// Read/assembly layer for the editable landing-page DRAFT. The ContentDoc is built from
// `landing_pages.settings` + `.theme` + the ordered `landing_page_sections` rows — the
// same shape the publish runner serializes. See SPEC-012 §3 / ADR 0015.

/** Editor-facing landing page metadata (deploy + draft state), separate from the ContentDoc. */
export type LandingPageMeta = {
  id: string;
  client_id: string;
  product_id: string | null;
  name: string;
  subdomain: string;
  url: string;
  status: string; // Cloudflare deploy state: draft|building|deployed|failed
  draft_status: string; // Supabase draft state: empty|generating|ready|editing|publishing
  noindex: boolean;
  published_at: string | null;
  updated_at: string;
};

export type LandingPageFull = {
  meta: LandingPageMeta;
  doc: ContentDoc;
  /** Per-section optimistic-concurrency version, keyed by section type (editor uses it on PATCH). */
  versions: Record<string, number>;
};

export type ProductSummary = {
  id: string;
  slug: string;
  name: string;
  status: string;
  landingPageCount: number;
};

const EMPTY_SETTINGS: Settings = {
  subdomain: "",
  name: "",
  product: "",
  site_url: "",
  seo: { title: "", description: "", ogAlt: "" },
  tracking: { fb_pixel_id: "", ga4_id: "", consent_key: "" },
  checkout_url: "",
  price_cents: 0,
  cart_state: "open",
  noindex: true,
  cartClosed: { headline: "", subhead: "", waitlistCtaLabel: "" },
};

/** Coerce the stored settings JSON into a complete Settings, filling any gaps so the
 * serializer/PageBody never read undefined nested objects (a half-generated draft). */
function coerceSettings(raw: unknown): Settings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<Settings>;
  return {
    ...EMPTY_SETTINGS,
    ...s,
    seo: { ...EMPTY_SETTINGS.seo, ...(s.seo ?? {}) },
    tracking: { ...EMPTY_SETTINGS.tracking, ...(s.tracking ?? {}) },
    cartClosed: { ...EMPTY_SETTINGS.cartClosed, ...(s.cartClosed ?? {}) },
  };
}

function metaFromRow(row: {
  id: string;
  client_id: string;
  product_id: string | null;
  name: string;
  subdomain: string;
  url: string;
  status: string;
  draft_status: string;
  noindex: boolean;
  published_at: string | null;
  updated_at: string;
}): LandingPageMeta {
  return {
    id: row.id,
    client_id: row.client_id,
    product_id: row.product_id,
    name: row.name,
    subdomain: row.subdomain,
    url: row.url,
    status: row.status,
    draft_status: row.draft_status,
    noindex: row.noindex,
    published_at: row.published_at,
    updated_at: row.updated_at,
  };
}

/**
 * Full editor read: the LP metadata + the assembled ContentDoc (settings, theme, ordered
 * sections). Returns null if the id does not exist. Read-only.
 */
export async function getLandingPageFull(id: string): Promise<LandingPageFull | null> {
  const supabase = db();
  const pageRes = await supabase
    .from("landing_pages")
    .select(
      "id, client_id, product_id, name, subdomain, url, status, draft_status, noindex, published_at, updated_at, settings, theme",
    )
    .eq("id", id)
    .maybeSingle();
  if (pageRes.error) throw pageRes.error;
  if (!pageRes.data) return null;
  const page = pageRes.data;

  const sectionsRes = await supabase
    .from("landing_page_sections")
    .select("type, position, enabled, fields, version")
    .eq("landing_page_id", id)
    .order("position", { ascending: true });
  if (sectionsRes.error) throw sectionsRes.error;

  const rows = sectionsRes.data ?? [];
  const versions: Record<string, number> = {};
  for (const r of rows) versions[r.type] = r.version;

  const doc: ContentDoc = {
    settings: coerceSettings(page.settings),
    theme: (page.theme && typeof page.theme === "object" ? page.theme : {}) as Theme,
    sections: rows.map((r) => ({
      type: r.type as SectionType,
      position: r.position,
      enabled: r.enabled,
      fields: (r.fields && typeof r.fields === "object" ? r.fields : {}) as Record<string, unknown>,
    })),
  };

  return { meta: metaFromRow(page), doc, versions };
}

/**
 * Route-scoped editor read: like getLandingPageFull, but verifies the LP actually belongs to
 * the client `slug` and `product` in the URL before returning it (SPEC-012 §5 — "valida que a
 * LP pertence ao slug da rota"). Defense in depth on top of the session gate: a valid id for a
 * different client/product is treated as not-found rather than served. Null if no match.
 */
export async function getLandingPageFullForRoute(
  clientSlug: string,
  productSlug: string,
  id: string,
): Promise<LandingPageFull | null> {
  const supabase = db();
  const clientRes = await supabase.from("clients").select("id").eq("slug", clientSlug).maybeSingle();
  if (clientRes.error) throw clientRes.error;
  if (!clientRes.data) return null;

  const productRes = await supabase
    .from("products")
    .select("id")
    .eq("client_id", clientRes.data.id)
    .eq("slug", productSlug)
    .maybeSingle();
  if (productRes.error) throw productRes.error;
  if (!productRes.data) return null;

  const full = await getLandingPageFull(id);
  if (!full) return null;
  // The id must resolve to a LP under this exact client + product, or it's not ours to edit.
  if (full.meta.client_id !== clientRes.data.id || full.meta.product_id !== productRes.data.id) return null;
  return full;
}

/** Products for a client slug, each with a count of its landing pages. Null if no client. */
export async function getClientProducts(slug: string): Promise<ProductSummary[] | null> {
  const supabase = db();
  const clientRes = await supabase.from("clients").select("id").eq("slug", slug).maybeSingle();
  if (clientRes.error) throw clientRes.error;
  if (!clientRes.data) return null;

  const productsRes = await supabase
    .from("products")
    .select("id, slug, name, status")
    .eq("client_id", clientRes.data.id)
    .order("created_at", { ascending: true });
  if (productsRes.error) throw productsRes.error;
  const products = productsRes.data ?? [];
  if (products.length === 0) return [];

  const countsRes = await supabase
    .from("landing_pages")
    .select("product_id")
    .in(
      "product_id",
      products.map((p) => p.id),
    );
  if (countsRes.error) throw countsRes.error;
  const counts = new Map<string, number>();
  for (const row of countsRes.data ?? []) {
    if (row.product_id) counts.set(row.product_id, (counts.get(row.product_id) ?? 0) + 1);
  }

  return products.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    status: p.status,
    landingPageCount: counts.get(p.id) ?? 0,
  }));
}

export type LandingPageListItem = LandingPageMeta;

/** A landing page enriched with its client + product labels, for the global index view. */
export type LandingPageListRow = LandingPageMeta & {
  clientSlug: string;
  clientName: string;
  productSlug: string | null;
  productName: string | null;
};

/**
 * Every landing page across all clients/products, newest first — feeds the top-level
 * "Landing pages" dashboard tab. Joins client + product in two bulk lookups (no N+1).
 * `product_id` may be null (orphan LP) → productSlug/productName come back null and the row
 * has no editor route (the editor lives under /clients/<slug>/<product>/…). Read-only.
 */
export async function getAllLandingPages(): Promise<LandingPageListRow[]> {
  const supabase = db();
  const lpRes = await supabase
    .from("landing_pages")
    .select(
      "id, client_id, product_id, name, subdomain, url, status, draft_status, noindex, published_at, updated_at",
    )
    .order("updated_at", { ascending: false });
  if (lpRes.error) throw lpRes.error;
  const rows = lpRes.data ?? [];
  if (rows.length === 0) return [];

  const clientIds = [...new Set(rows.map((r) => r.client_id))];
  const productIds = [...new Set(rows.map((r) => r.product_id).filter((x): x is string => Boolean(x)))];

  const clientsRes = await supabase.from("clients").select("id, slug, name").in("id", clientIds);
  if (clientsRes.error) throw clientsRes.error;
  const clientMap = new Map((clientsRes.data ?? []).map((c) => [c.id, c]));

  const productMap = new Map<string, { id: string; slug: string; name: string }>();
  if (productIds.length > 0) {
    const productsRes = await supabase.from("products").select("id, slug, name").in("id", productIds);
    if (productsRes.error) throw productsRes.error;
    for (const p of productsRes.data ?? []) productMap.set(p.id, p);
  }

  return rows.map((r) => {
    const c = clientMap.get(r.client_id);
    const p = r.product_id ? productMap.get(r.product_id) : undefined;
    return {
      ...metaFromRow(r),
      clientSlug: c?.slug ?? "",
      clientName: c?.name ?? "—",
      productSlug: p?.slug ?? null,
      productName: p?.name ?? null,
    };
  });
}

/** A product (by client slug + product slug) and its landing pages. Null if not found. */
export async function getProductWithLandingPages(
  clientSlug: string,
  productSlug: string,
): Promise<{ product: { id: string; slug: string; name: string }; landingPages: LandingPageListItem[] } | null> {
  const supabase = db();
  const clientRes = await supabase.from("clients").select("id").eq("slug", clientSlug).maybeSingle();
  if (clientRes.error) throw clientRes.error;
  if (!clientRes.data) return null;

  const productRes = await supabase
    .from("products")
    .select("id, slug, name")
    .eq("client_id", clientRes.data.id)
    .eq("slug", productSlug)
    .maybeSingle();
  if (productRes.error) throw productRes.error;
  if (!productRes.data) return null;
  const product = productRes.data;

  const lpRes = await supabase
    .from("landing_pages")
    .select(
      "id, client_id, product_id, name, subdomain, url, status, draft_status, noindex, published_at, updated_at",
    )
    .eq("product_id", product.id)
    .order("updated_at", { ascending: false });
  if (lpRes.error) throw lpRes.error;

  return {
    product: { id: product.id, slug: product.slug, name: product.name },
    landingPages: (lpRes.data ?? []).map(metaFromRow),
  };
}

export type AutoReviewCandidate = {
  landingPageId: string;
  subdomain: string;
  previewUrl: string;
  createdAt: string;
};

/**
 * The most recent landing page whose CREATION just finished (draft ready), within a short
 * window. Powers the "auto-review on completion" trigger (SPEC-014 v1): the dashboard polls
 * this and, when a fresh candidate appears, opens the Live Review. Bounded by created_at (not
 * updated_at) so plain draft edits don't re-trigger, and capped to a recent window so old pages
 * never fire on page load. Dedup by id is the client's responsibility.
 */
export async function getAutoReviewCandidate(windowMinutes = 20): Promise<AutoReviewCandidate | null> {
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  const { data, error } = await db()
    .from("landing_pages")
    .select("id, subdomain, created_at")
    .eq("draft_status", "ready")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    landingPageId: data.id,
    subdomain: data.subdomain,
    previewUrl: `/lp-preview/${data.id}?review=1`,
    createdAt: data.created_at,
  };
}
