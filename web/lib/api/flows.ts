import { Hono } from "hono";
import type { Context } from "hono";
import { db } from "@/lib/db/client";
import { getReadClient } from "@/lib/db/read-client";
import type { Database, Json } from "@/lib/db/types";
import { operatorIdFromRequest } from "@/lib/auth/hono-cookies";
import { operatorOwnsClient } from "@/lib/auth/current-operator";
import { rateLimiters, enforceLimit } from "@/lib/ratelimit";
import { flowCreateSchema, flowPatchSchema, type FlowGraph } from "@/lib/flows/validate";
import { findUnsafeUrls, validateGraph } from "@/lib/flows/graph-validate";
import { defaultTemplateGraph } from "@/lib/flows/template";

type FlowUpdate = Database["public"]["Tables"]["flows"]["Update"];

// SPEC-020 §6.1 (Wave 1) — flow definition CRUD + image/logo reference uploads. Execution
// endpoints (/run, /flow-runs/*) land with the engine in Wave 2. Pattern per route: auth
// (session middleware) → ownership guard → Zod → write via db() service_role; UI reads via
// getReadClient() (RLS by operator).

const COLUMNS = "id, client_id, operator_id, name, description, status, graph, version, created_at, updated_at";

const ASSETS_BUCKET = "flow-assets";
const MAX_ASSET_BYTES = 5_000_000; // 5MB — mirrors the flow_assets CHECK
// Raster only; SVG excluded on purpose (can embed <script> and the bucket is public).
const ASSET_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}

/** Load a flow's guard-relevant state, or null if it does not exist OR the operator does not
 * own its client. Returning null → every caller answers 404 (never reveals cross-tenant flows). */
async function loadFlow(id: string, c: Context) {
  const res = await db().from("flows").select("id, client_id, operator_id, status, version").eq("id", id).maybeSingle();
  if (res.error) throw res.error;
  if (!res.data) return null;
  if (!(await operatorOwnsClient(operatorIdFromRequest(c), res.data.client_id))) return null;
  return res.data;
}

function assetPublicUrl(path: string): string {
  return db().storage.from(ASSETS_BUCKET).getPublicUrl(path).data.publicUrl;
}

export const flows = new Hono();

// ---------- GET list (operator's flows; archived hidden unless asked) ----------
flows.get("/", async (c) => {
  const supabase = await getReadClient();
  let q = supabase
    .from("flows")
    .select(`${COLUMNS}, client:clients(slug, name)`)
    .order("updated_at", { ascending: false });
  if (c.req.query("includeArchived") !== "1") q = q.neq("status", "archived");
  const res = await q;
  if (res.error) throw res.error;
  return c.json(res.data ?? []);
});

// ---------- POST create (starts from the default template — approval before Meta) ----------
flows.post("/", async (c) => {
  const parsed = flowCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_request", detail: parsed.error.issues[0]?.message }, 400);
  const d = parsed.data;

  const operatorId = operatorIdFromRequest(c);
  if (!operatorId) return c.json({ error: "unauthorized" }, 401);
  if (!(await operatorOwnsClient(operatorId, d.clientId))) return c.json({ error: "not_found" }, 404);

  const ins = await db()
    .from("flows")
    .insert({
      operator_id: operatorId,
      client_id: d.clientId,
      name: d.name,
      description: d.description ?? null,
      graph: defaultTemplateGraph() as unknown as Json,
    })
    .select(COLUMNS)
    .single();
  if (ins.error) throw ins.error;
  return c.json(ins.data, 201);
});

// ---------- GET one ----------
flows.get("/:id", async (c) => {
  const id = c.req.param("id");
  const guard = await loadFlow(id, c);
  if (!guard) return c.json({ error: "not_found" }, 404);

  const res = await db().from("flows").select(`${COLUMNS}, client:clients(slug, name)`).eq("id", id).single();
  if (res.error) throw res.error;
  return c.json(res.data);
});

// ---------- PATCH save (autosave; optimistic version) ----------
flows.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const { allowed } = await enforceLimit(rateLimiters.flowEdit(), id, "flow-edit");
  if (!allowed) return c.json({ error: "rate_limited" }, 429, { "Retry-After": "5" });

  const parsed = flowPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_request", detail: parsed.error.issues[0]?.message }, 400);
  const d = parsed.data;

  const guard = await loadFlow(id, c);
  if (!guard) return c.json({ error: "not_found" }, 404);
  if (guard.status === "archived") return c.json({ error: "flow_archived" }, 409);

  // Saving an in-progress draft is fine (Run re-validates everything), but a PRESENT URL
  // pointing at a private/unsafe host is rejected at save time (SPEC-020 §8.8 — SSRF layer 1).
  if (d.graph) {
    const unsafe = findUnsafeUrls(d.graph);
    if (unsafe.length > 0) return c.json({ error: "unsafe_url", issues: unsafe }, 400);
  }

  const patch: FlowUpdate = { version: d.version + 1 };
  if (d.name !== undefined) patch.name = d.name;
  if (d.description !== undefined) patch.description = d.description ?? null;
  if (d.status !== undefined) patch.status = d.status;
  if (d.graph !== undefined) patch.graph = d.graph as unknown as Json;

  const upd = await db().from("flows").update(patch).eq("id", id).eq("version", d.version).select(COLUMNS).maybeSingle();
  if (upd.error) throw upd.error;
  if (!upd.data) {
    // No row matched (id, version): a concurrent write bumped it. Return current for reconciliation.
    const cur = await db().from("flows").select(COLUMNS).eq("id", id).maybeSingle();
    if (cur.error) throw cur.error;
    if (!cur.data) return c.json({ error: "not_found" }, 404);
    return c.json({ error: "version_conflict", current: cur.data }, 409);
  }
  // Advisory (non-blocking) run-readiness — the editor shows these next to the Run button.
  const issues = d.graph ? validateGraph(d.graph) : validateGraph(upd.data.graph as unknown as FlowGraph);
  return c.json({ ...upd.data, issues });
});

// ---------- DELETE = soft archive ----------
flows.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const guard = await loadFlow(id, c);
  if (!guard) return c.json({ error: "not_found" }, 404);

  const upd = await db().from("flows").update({ status: "archived" }).eq("id", id);
  if (upd.error) throw upd.error;
  return c.json({ ok: true });
});

// ---------- Assets (image/logo references for image_creative) ----------

flows.get("/:id/assets", async (c) => {
  const id = c.req.param("id");
  const guard = await loadFlow(id, c);
  if (!guard) return c.json({ error: "not_found" }, 404);

  const res = await db()
    .from("flow_assets")
    .select("id, path, mime, size_bytes, created_at")
    .eq("flow_id", id)
    .order("created_at", { ascending: false });
  if (res.error) throw res.error;
  return c.json((res.data ?? []).map((a) => ({ ...a, url: assetPublicUrl(a.path) })));
});

flows.post("/:id/assets", async (c) => {
  const id = c.req.param("id");
  const { allowed } = await enforceLimit(rateLimiters.flowEdit(), id, "flow-edit");
  if (!allowed) return c.json({ error: "rate_limited" }, 429, { "Retry-After": "5" });

  const guard = await loadFlow(id, c);
  if (!guard) return c.json({ error: "not_found" }, 404);
  const operatorId = operatorIdFromRequest(c);
  if (!operatorId) return c.json({ error: "unauthorized" }, 401);

  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return c.json({ error: "missing_file" }, 400);
  if (file.size === 0 || file.size > MAX_ASSET_BYTES) return c.json({ error: "file_too_large" }, 413);
  if (!ASSET_MIME.has(file.type)) return c.json({ error: "unsupported_media_type" }, 415);

  const supabase = db();
  // Public bucket (runner downloads by URL; brand refs are not secret). Idempotent create.
  await supabase.storage.createBucket(ASSETS_BUCKET, { public: true }).catch(() => undefined);

  const ext = file.type.split("/")[1] ?? "bin";
  const path = `${id}/${Date.now()}-${crypto.getRandomValues(new Uint32Array(1))[0]}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const up = await supabase.storage.from(ASSETS_BUCKET).upload(path, buf, { contentType: file.type, upsert: false });
  if (up.error) {
    console.error(JSON.stringify({ level: "error", event: "flow_asset_upload_failed", message: up.error.message }));
    return c.json({ error: "upload_failed" }, 502);
  }

  const ins = await supabase
    .from("flow_assets")
    .insert({ flow_id: id, operator_id: operatorId, path, mime: file.type, size_bytes: file.size })
    .select("id, path, mime, size_bytes, created_at")
    .single();
  if (ins.error) {
    // Keep Storage consistent with the table (best-effort).
    await supabase.storage.from(ASSETS_BUCKET).remove([path]).catch(() => undefined);
    if (isUniqueViolation(ins.error)) return c.json({ error: "conflict" }, 409);
    throw ins.error;
  }
  return c.json({ ...ins.data, url: assetPublicUrl(path) }, 201);
});

flows.delete("/:id/assets/:assetId", async (c) => {
  const id = c.req.param("id");
  const assetId = c.req.param("assetId");
  const guard = await loadFlow(id, c);
  if (!guard) return c.json({ error: "not_found" }, 404);

  const res = await db().from("flow_assets").select("id, path").eq("id", assetId).eq("flow_id", id).maybeSingle();
  if (res.error) throw res.error;
  if (!res.data) return c.json({ error: "not_found" }, 404);

  const del = await db().from("flow_assets").delete().eq("id", assetId);
  if (del.error) throw del.error;
  await db().storage.from(ASSETS_BUCKET).remove([res.data.path]).catch(() => undefined);
  return c.json({ ok: true });
});
