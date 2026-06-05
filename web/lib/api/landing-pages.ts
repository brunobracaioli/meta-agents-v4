import { Hono } from "hono";
import type { Json } from "@/lib/db/types";
import { db } from "@/lib/db/client";
import { getLandingPageFull } from "@/lib/services/landing-page";
import { rateLimiters, enforceLimit } from "@/lib/ratelimit";
import {
  themeSchema,
  settingsPatchSchema,
  trackingSecretsSchema,
  trackingSecretDeleteSchema,
} from "@/lib/landing/validate";
import { validateSection } from "@/lib/landing/section-schemas";

// Editor API for the landing-page DRAFT (SPEC-012 §5). All routes sit behind the session
// gate (middleware) and operate on the Supabase source-of-truth; cheap edits are written
// synchronously here, while publish (heavy build+deploy) is enqueued for the Fly runner.

const SECTION_TYPES = new Set([
  "hero", "urgency", "problem", "comparison", "solution", "features", "curriculum",
  "stats", "proof", "logos", "persona", "authority", "offer", "guarantee", "faq",
  "finalCta", "footer",
]);

// Per-client publish skill (allowlist — never free-form). Mirrors the Ultron tools map.
const PUBLISH_SKILL_BY_SLUG: Record<string, string> = {
  brunobracaioli: "publish-landing-page-brunobracaioli",
};

// Public base of the multi-tenant tagging server (ADR 0021). Not a secret — it ends up in the
// public content-spec. Overridable per environment; defaults to the production Worker.
const TRACK_ENDPOINT = process.env.TRACK_ENDPOINT ?? "https://track.b2tech.io";

const ASSETS_BUCKET = "landing-assets";
const MAX_ASSET_BYTES = 5_000_000; // 5MB
// Raster only. SVG is excluded on purpose: it can embed <script>, and the bucket is public —
// a hostile SVG opened directly from the Storage origin would execute there (Wave 6 hardening).
const ASSET_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}

/** Append-only audit trail for consequential landing-page actions (Repudiation — STRIDE).
 * Best-effort: a logging failure must never break the operation. */
async function logLandingOp(clientId: string, lpId: string, summary: string, actor = "operator"): Promise<void> {
  const res = await db()
    .from("operation_logs")
    .insert({ client_id: clientId, entity_type: "landing_page", entity_id: lpId, action: "update", actor, summary });
  if (res.error) {
    console.error(JSON.stringify({ level: "error", event: "landing_oplog_failed", message: res.error.message }));
  }
}

/** Reads the LP's edit-relevant state; null if the LP does not exist. */
async function loadEditState(id: string) {
  const res = await db()
    .from("landing_pages")
    .select("client_id, draft_status, noindex")
    .eq("id", id)
    .maybeSingle();
  if (res.error) throw res.error;
  return res.data;
}

/** Keep settings.tracking.server in sync with whether the LP has ANY server-side secret.
 * Present ⇒ the published page POSTs events to the tagging server (the serializer passes it
 * through verbatim; it activates on the next publish). This is the ONLY thing that writes the
 * public `server` pointer — it never carries a secret. See ADR 0021 / SPEC-015 §7.1. */
async function syncServerPointer(id: string): Promise<void> {
  const cnt = await db()
    .from("lp_tracking_secrets")
    .select("id", { count: "exact", head: true })
    .eq("landing_page_id", id);
  if (cnt.error) throw cnt.error;
  const hasSecrets = (cnt.count ?? 0) > 0;

  const cur = await db().from("landing_pages").select("settings").eq("id", id).maybeSingle();
  if (cur.error) throw cur.error;
  const settings = (cur.data?.settings ?? {}) as Record<string, unknown>;
  const tracking = { ...((settings.tracking as Record<string, unknown>) ?? {}) };
  if (hasSecrets) tracking.server = { endpoint: TRACK_ENDPOINT, lp_id: id };
  else delete tracking.server;
  settings.tracking = tracking;

  const upd = await db().from("landing_pages").update({ settings: settings as Json }).eq("id", id);
  if (upd.error) throw upd.error;
}

export const landingPages = new Hono();

// ---------- GET ContentDoc (preview + polling) ----------
landingPages.get("/:id", async (c) => {
  const id = c.req.param("id");
  const full = await getLandingPageFull(id);
  if (!full) return c.json({ error: "not_found" }, 404);
  return c.json(full);
});

// ---------- PATCH a section's fields (optimistic concurrency) ----------
landingPages.patch("/:id/sections/:type", async (c) => {
  const id = c.req.param("id");
  const type = c.req.param("type");
  if (!SECTION_TYPES.has(type)) return c.json({ error: "invalid_section_type" }, 400);

  const { allowed } = await enforceLimit(rateLimiters.landingEdit(), id, "landing-edit");
  if (!allowed) return c.json({ error: "rate_limited" }, 429, { "Retry-After": "5" });

  const body = (await c.req.json().catch(() => null)) as { fields?: unknown; version?: unknown } | null;
  if (!body || typeof body.version !== "number") return c.json({ error: "invalid_request" }, 400);
  const fieldCheck = validateSection(type, body.fields);
  if (!fieldCheck.ok) return c.json({ error: "invalid_fields", detail: fieldCheck.error }, 400);

  const state = await loadEditState(id);
  if (!state) return c.json({ error: "not_found" }, 404);
  if (state.draft_status === "generating" || state.draft_status === "publishing") {
    return c.json({ error: "draft_busy", draft_status: state.draft_status }, 423);
  }

  const upd = await db()
    .from("landing_page_sections")
    .update({ fields: body.fields as Json, version: body.version + 1, updated_by: "operator" })
    .eq("landing_page_id", id)
    .eq("type", type)
    .eq("version", body.version)
    .select("version")
    .maybeSingle();
  if (upd.error) throw upd.error;
  if (!upd.data) {
    // No row matched the (id, type, version) guard: either gone or a concurrent write bumped
    // the version. Return the current row so the editor can reconcile (last-write-wins).
    const cur = await db()
      .from("landing_page_sections")
      .select("version, fields")
      .eq("landing_page_id", id)
      .eq("type", type)
      .maybeSingle();
    if (cur.error) throw cur.error;
    if (!cur.data) return c.json({ error: "not_found" }, 404);
    return c.json({ error: "version_conflict", current: cur.data }, 409);
  }
  return c.json({ ok: true, version: upd.data.version });
});

// ---------- PATCH design theme (validated tokens) ----------
landingPages.patch("/:id/theme", async (c) => {
  const id = c.req.param("id");
  const { allowed } = await enforceLimit(rateLimiters.landingEdit(), id, "landing-edit");
  if (!allowed) return c.json({ error: "rate_limited" }, 429, { "Retry-After": "5" });

  const parsed = themeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_theme", detail: parsed.error.issues[0]?.message }, 400);

  const state = await loadEditState(id);
  if (!state) return c.json({ error: "not_found" }, 404);
  if (state.draft_status === "generating" || state.draft_status === "publishing") {
    return c.json({ error: "draft_busy", draft_status: state.draft_status }, 423);
  }

  const upd = await db().from("landing_pages").update({ theme: parsed.data as Json }).eq("id", id);
  if (upd.error) throw upd.error;
  return c.json({ ok: true });
});

// ---------- PATCH page settings (editable subset, merged) ----------
landingPages.patch("/:id/settings", async (c) => {
  const id = c.req.param("id");
  const { allowed } = await enforceLimit(rateLimiters.landingEdit(), id, "landing-edit");
  if (!allowed) return c.json({ error: "rate_limited" }, 429, { "Retry-After": "5" });

  const parsed = settingsPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_settings", detail: parsed.error.issues[0]?.message }, 400);

  const cur = await db().from("landing_pages").select("settings, draft_status").eq("id", id).maybeSingle();
  if (cur.error) throw cur.error;
  if (!cur.data) return c.json({ error: "not_found" }, 404);
  if (cur.data.draft_status === "generating" || cur.data.draft_status === "publishing") {
    return c.json({ error: "draft_busy", draft_status: cur.data.draft_status }, 423);
  }

  const current = (cur.data.settings ?? {}) as Record<string, unknown>;
  const patch = parsed.data;
  const merged: Record<string, unknown> = { ...current, ...patch };
  // Deep-merge the nested objects so a partial seo/cartClosed patch doesn't drop siblings.
  if (patch.seo) merged.seo = { ...((current.seo as object) ?? {}), ...patch.seo };
  if (patch.cartClosed) merged.cartClosed = { ...((current.cartClosed as object) ?? {}), ...patch.cartClosed };
  // Tracking is shallow-merged (one level) so a patch of the public ID arrays preserves
  // consent_key + the legacy single fields. Each *_ids array is a whole value, so it REPLACES
  // the prior array — removing a pixel actually shrinks it. No secrets ever reach here.
  if (patch.tracking) merged.tracking = { ...((current.tracking as object) ?? {}), ...patch.tracking };
  // Keep the mirrored top-level columns consistent with settings for downstream reads.
  const columnSync: Record<string, unknown> = {};
  if (patch.cart_state !== undefined) columnSync.cart_state = patch.cart_state;
  if (patch.checkout_url !== undefined) columnSync.checkout_url = patch.checkout_url;
  if (patch.price_cents !== undefined) columnSync.price_cents = patch.price_cents;

  const upd = await db()
    .from("landing_pages")
    .update({ settings: merged as Json, ...columnSync })
    .eq("id", id);
  if (upd.error) throw upd.error;
  return c.json({ ok: true });
});

// ---------- Tracking SECRETS (write-only; Phase 2 — ADR 0021 / SPEC-015 §7.5) ----------
// These write to the RLS-locked `lp_tracking_secrets` table, NEVER to settings/content-spec.
// The Worker (track.b2tech.io) is the only reader. No endpoint here ever returns a secret value.

// GET status: which providers/ids have a secret configured. NEVER returns the secret itself.
landingPages.get("/:id/tracking-secrets/status", async (c) => {
  const id = c.req.param("id");
  const state = await loadEditState(id);
  if (!state) return c.json({ error: "not_found" }, 404);

  // Select ONLY non-secret columns — the `secret` jsonb is never read here.
  const res = await db()
    .from("lp_tracking_secrets")
    .select("provider, public_id, test_event_code, updated_at")
    .eq("landing_page_id", id);
  if (res.error) throw res.error;
  const secrets = (res.data ?? []).map((r) => ({
    provider: r.provider,
    public_id: r.public_id,
    configured: true,
    has_test_code: !!r.test_event_code,
    updated_at: r.updated_at,
  }));
  return c.json({ secrets });
});

// PUT: upsert one or more secrets. Write-only — responds with a count, never the values.
landingPages.put("/:id/tracking-secrets", async (c) => {
  const id = c.req.param("id");
  const { allowed } = await enforceLimit(rateLimiters.landingEdit(), id, "landing-edit");
  if (!allowed) return c.json({ error: "rate_limited" }, 429, { "Retry-After": "5" });

  const parsed = trackingSecretsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_secrets", detail: parsed.error.issues[0]?.message }, 400);

  const state = await loadEditState(id);
  if (!state) return c.json({ error: "not_found" }, 404);

  const rows = parsed.data.entries.map((e) => ({
    landing_page_id: id,
    provider: e.provider,
    public_id: e.public_id,
    secret: e.secret as Json,
    test_event_code: e.provider === "meta" ? e.test_event_code ?? null : null,
  }));
  const upd = await db()
    .from("lp_tracking_secrets")
    .upsert(rows, { onConflict: "landing_page_id,provider,public_id" });
  if (upd.error) throw upd.error;

  // Audit WITHOUT the secret value (Repudiation/Info-disclosure — STRIDE).
  const summary = parsed.data.entries.map((e) => `${e.provider}/${e.public_id}`).join(", ");
  await logLandingOp(state.client_id, id, `tracking secret(s) configurado(s): ${summary}`, "operator");
  await syncServerPointer(id); // turn on the public server pointer (activates on next publish)
  return c.json({ ok: true, count: rows.length });
});

// DELETE: remove one secret (clean lifecycle — avoids orphan server-only firing).
landingPages.delete("/:id/tracking-secrets", async (c) => {
  const id = c.req.param("id");
  const { allowed } = await enforceLimit(rateLimiters.landingEdit(), id, "landing-edit");
  if (!allowed) return c.json({ error: "rate_limited" }, 429, { "Retry-After": "5" });

  const parsed = trackingSecretDeleteSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_request", detail: parsed.error.issues[0]?.message }, 400);

  const state = await loadEditState(id);
  if (!state) return c.json({ error: "not_found" }, 404);

  const del = await db()
    .from("lp_tracking_secrets")
    .delete()
    .eq("landing_page_id", id)
    .eq("provider", parsed.data.provider)
    .eq("public_id", parsed.data.public_id);
  if (del.error) throw del.error;
  await logLandingOp(state.client_id, id, `tracking secret removido: ${parsed.data.provider}/${parsed.data.public_id}`, "operator");
  await syncServerPointer(id); // drop the server pointer if that was the last secret
  return c.json({ ok: true });
});

// ---------- GET tracking health (reads the lp_events mirror; Phase 2) ----------
// Aggregates the last 7 days of server-side events for the dashboard. Reads only non-PII
// columns (the mirror has no raw PII by design). Bounded scan, aggregated in-process.
landingPages.get("/:id/tracking-health", async (c) => {
  const id = c.req.param("id");
  const state = await loadEditState(id);
  if (!state) return c.json({ error: "not_found" }, 404);

  const sinceIso = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  const res = await db()
    .from("lp_events")
    .select("event_name, meta_status, has_email, has_phone, utm_source, event_time")
    .eq("landing_page_id", id)
    .gte("event_time", sinceIso)
    .order("event_time", { ascending: false })
    .limit(2000);
  if (res.error) throw res.error;

  const rows = res.data ?? [];
  const total = rows.length;
  const byName: Record<string, number> = {};
  let capiAttempted = 0;
  let capiOk = 0;
  let email = 0;
  let phone = 0;
  let utm = 0;
  let last: string | null = null;
  for (const r of rows) {
    byName[r.event_name] = (byName[r.event_name] ?? 0) + 1;
    if (typeof r.meta_status === "number" && r.meta_status > 0) {
      capiAttempted += 1;
      if (r.meta_status === 200) capiOk += 1;
    }
    if (r.has_email) email += 1;
    if (r.has_phone) phone += 1;
    if (r.utm_source) utm += 1;
    if (!last) last = r.event_time;
  }
  return c.json({
    windowDays: 7,
    total,
    byName,
    capi: { attempted: capiAttempted, ok: capiOk },
    match: { email, phone },
    utmCoverage: utm,
    lastEventAt: last,
  });
});

// ---------- POST publish (enqueue landing_publish job) ----------
landingPages.post("/:id/publish", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as { noindex?: unknown };

  const state = await loadEditState(id);
  if (!state) return c.json({ error: "not_found" }, 404);

  const clientRes = await db().from("clients").select("slug").eq("id", state.client_id).maybeSingle();
  if (clientRes.error) throw clientRes.error;
  const slug = clientRes.data?.slug;
  const skill = slug ? PUBLISH_SKILL_BY_SLUG[slug] : undefined;
  if (!slug || !skill) return c.json({ error: "publish_not_enabled" }, 400);

  const { allowed } = await enforceLimit(rateLimiters.landingPublish(), slug, "landing-publish");
  if (!allowed) return c.json({ error: "rate_limited" }, 429, { "Retry-After": "60" });

  // Default to the LP's current noindex; allow an explicit override (go-live = noindex:0).
  const noindex = typeof body.noindex === "boolean" ? (body.noindex ? 1 : 0) : state.noindex ? 1 : 0;

  const ins = await db()
    .from("agent_jobs")
    .insert({
      client_id: state.client_id,
      skill,
      kind: "landing_publish",
      landing_page_id: id,
      args: { landing_page_id: id, noindex },
      requested_by: "operator",
    })
    .select("id")
    .single();
  if (ins.error) {
    if (isUniqueViolation(ins.error)) {
      return c.json({ enqueued: false, reason: "já existe uma publicação em andamento para esta página" }, 409);
    }
    throw ins.error;
  }
  await logLandingOp(state.client_id, id, `publish enfileirado (noindex=${noindex})`, "operator");
  return c.json({ enqueued: true, job_id: ins.data.id, noindex });
});

// ---------- POST asset upload (Storage) ----------
landingPages.post("/:id/assets", async (c) => {
  const id = c.req.param("id");
  const { allowed } = await enforceLimit(rateLimiters.landingEdit(), id, "landing-edit");
  if (!allowed) return c.json({ error: "rate_limited" }, 429, { "Retry-After": "5" });

  const state = await loadEditState(id);
  if (!state) return c.json({ error: "not_found" }, 404);

  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return c.json({ error: "invalid_request" }, 400);
  if (file.size === 0 || file.size > MAX_ASSET_BYTES) return c.json({ error: "file_too_large" }, 413);
  if (!ASSET_MIME.has(file.type)) return c.json({ error: "unsupported_media_type" }, 415);

  const supabase = db();
  // Best-effort: ensure the public bucket exists (idempotent — ignore "already exists").
  await supabase.storage.createBucket(ASSETS_BUCKET, { public: true }).catch(() => undefined);

  const ext = file.type.split("/")[1]?.replace("+xml", "") ?? "bin";
  const path = `${id}/${Date.now()}-${Math.round(crypto.getRandomValues(new Uint32Array(1))[0]!)}.${ext}`;
  const buf = new Uint8Array(await file.arrayBuffer());
  const up = await supabase.storage.from(ASSETS_BUCKET).upload(path, buf, {
    contentType: file.type,
    upsert: false,
  });
  if (up.error) {
    console.error(JSON.stringify({ level: "error", event: "asset_upload_failed", message: up.error.message }));
    return c.json({ error: "upload_failed" }, 502);
  }
  const { data } = supabase.storage.from(ASSETS_BUCKET).getPublicUrl(path);
  return c.json({ ok: true, url: data.publicUrl, path });
});
