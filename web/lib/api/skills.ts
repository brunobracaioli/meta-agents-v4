import { Hono } from "hono";
import type { Context } from "hono";
import { db } from "@/lib/db/client";
import { getReadClient } from "@/lib/db/read-client";
import type { Database, Json } from "@/lib/db/types";

type SkillUpdate = Database["public"]["Tables"]["client_skills"]["Update"];
type ScheduleUpdate = Database["public"]["Tables"]["skill_schedules"]["Update"];
import { honoCookieAdapter } from "@/lib/auth/hono-cookies";
import { getCurrentOperatorId, assertOperatorOwnsClient, operatorRunnerReady } from "@/lib/auth/current-operator";
import { skillCreateSchema, skillPatchSchema, scheduleInputSchema, recurrenceToCron } from "@/lib/skills/validate";
import { expandAllowedTools } from "@/lib/skills/catalog";
import { buildSkillDraft } from "@/lib/skills/draft";
import { rateLimiters, enforceLimit } from "@/lib/ratelimit";
import { z } from "zod";

const draftSchema = z.object({
  productId: z.string().uuid(),
  goal: z.string().trim().min(8).max(2000),
});

// SPEC-018 §3.2 (re-scoped per SPEC-018.1) — operator-authored skills, now scoped to a PRODUCT.
// client_id is derived server-side from the product (never trusted from the body). Reads via the
// authenticated client (RLS). Writes via service_role + explicit ownership guard. The wizard speaks
// catalog group ids; we expand them to concrete `allowed-tools` here.

const COLUMNS =
  "id, client_id, product_id, operator_id, slug, name, description, body, allowed_tools, capability, ultron_enabled, ultron_function, status, version";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}

/** Resolve a product to its client_id, or null if it does not exist OR the operator does not own
 * its client. Returning null → callers answer 404 (never reveals a cross-tenant product). */
async function loadProductClient(productId: string, c: Context): Promise<string | null> {
  const res = await db().from("products").select("client_id").eq("id", productId).maybeSingle();
  if (res.error) throw res.error;
  if (!res.data) return null;
  if (!(await assertOperatorOwnsClient(res.data.client_id, honoCookieAdapter(c)))) return null;
  return res.data.client_id;
}

/** Load a skill's guard-relevant state, or null if it does not exist OR the operator does not own
 * its client. Returning null → every caller answers 404 (never reveals a cross-tenant skill). */
async function loadSkill(id: string, c: Context) {
  const res = await db()
    .from("client_skills")
    .select("id, client_id, product_id, slug, status")
    .eq("id", id)
    .maybeSingle();
  if (res.error) throw res.error;
  if (!res.data) return null;
  if (!(await assertOperatorOwnsClient(res.data.client_id, honoCookieAdapter(c)))) return null;
  return res.data;
}

export const skills = new Hono();

// ---------- POST draft (AI-assisted authoring; does NOT persist) ----------
skills.post("/draft", async (c) => {
  const parsed = draftSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_request", detail: parsed.error.issues[0]?.message }, 400);

  const operatorId = await getCurrentOperatorId(honoCookieAdapter(c));
  if (!operatorId) return c.json({ error: "unauthorized" }, 401);

  // Load the product (+ its client + brief) and verify ownership transitively via the client.
  const product = await db()
    .from("products")
    .select("client_id, slug, name, brief")
    .eq("id", parsed.data.productId)
    .maybeSingle();
  if (product.error) throw product.error;
  if (!product.data) return c.json({ error: "not_found" }, 404);
  if (!(await assertOperatorOwnsClient(product.data.client_id, honoCookieAdapter(c)))) {
    return c.json({ error: "not_found" }, 404);
  }

  const { allowed } = await enforceLimit(rateLimiters.skillDraft(), operatorId, "skill-draft");
  if (!allowed) return c.json({ error: "rate_limited" }, 429, { "Retry-After": "10" });

  const client = await db().from("clients").select("slug, name").eq("id", product.data.client_id).maybeSingle();
  if (client.error) throw client.error;
  if (!client.data) return c.json({ error: "not_found" }, 404);

  try {
    const draft = await buildSkillDraft({
      goal: parsed.data.goal,
      clientSlug: client.data.slug,
      clientName: client.data.name,
      productSlug: product.data.slug,
      productName: product.data.name,
      ...(product.data.brief ? { productBrief: JSON.stringify(product.data.brief) } : {}),
    });
    return c.json(draft);
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "skill_draft_failed", message: err instanceof Error ? err.message : "unknown" }));
    return c.json({ error: "draft_failed" }, 502);
  }
});

// ---------- GET list (operator's own skills, optional product/client filter) ----------
skills.get("/", async (c) => {
  const productId = c.req.query("productId");
  const clientId = c.req.query("clientId");
  const supabase = await getReadClient();
  let q = supabase.from("client_skills").select(COLUMNS).order("created_at", { ascending: true });
  if (productId) q = q.eq("product_id", productId);
  else if (clientId) q = q.eq("client_id", clientId);
  const res = await q;
  if (res.error) throw res.error;
  return c.json(res.data ?? []);
});

// ---------- POST create ----------
skills.post("/", async (c) => {
  const parsed = skillCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_request", detail: parsed.error.issues[0]?.message }, 400);
  const d = parsed.data;

  const operatorId = await getCurrentOperatorId(honoCookieAdapter(c));
  if (!operatorId) return c.json({ error: "unauthorized" }, 401);
  // client_id is derived from the product, never trusted from the body.
  const clientId = await loadProductClient(d.productId, c);
  if (!clientId) return c.json({ error: "not_found" }, 404);

  const ins = await db()
    .from("client_skills")
    .insert({
      client_id: clientId,
      product_id: d.productId,
      operator_id: operatorId,
      slug: d.slug,
      name: d.name,
      description: d.description ?? null,
      body: d.body,
      allowed_tools: expandAllowedTools(d.tool_groups),
      capability: d.capability,
      ultron_enabled: d.ultron_enabled,
      ultron_function: (d.ultron_function ?? null) as Json,
      status: d.status,
    })
    .select(COLUMNS)
    .single();
  if (ins.error) {
    if (isUniqueViolation(ins.error)) return c.json({ error: "slug_in_use" }, 409);
    throw ins.error;
  }
  return c.json(ins.data, 201);
});

// ---------- PATCH update (optimistic version check) ----------
skills.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const parsed = skillPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_request", detail: parsed.error.issues[0]?.message }, 400);
  const d = parsed.data;

  const skill = await loadSkill(id, c);
  if (!skill) return c.json({ error: "not_found" }, 404);

  // Build the patch with only sent fields; expand tool groups when provided.
  const patch: SkillUpdate = { version: d.version + 1 };
  if (d.name !== undefined) patch.name = d.name;
  if (d.description !== undefined) patch.description = d.description ?? null;
  if (d.body !== undefined) patch.body = d.body;
  if (d.tool_groups !== undefined) patch.allowed_tools = expandAllowedTools(d.tool_groups);
  if (d.capability !== undefined) patch.capability = d.capability;
  if (d.ultron_enabled !== undefined) patch.ultron_enabled = d.ultron_enabled;
  if (d.ultron_function !== undefined) patch.ultron_function = (d.ultron_function ?? null) as Json;
  if (d.status !== undefined) patch.status = d.status;

  const upd = await db()
    .from("client_skills")
    .update(patch)
    .eq("id", id)
    .eq("version", d.version)
    .select(COLUMNS)
    .maybeSingle();
  if (upd.error) {
    if (isUniqueViolation(upd.error)) return c.json({ error: "slug_in_use" }, 409);
    throw upd.error;
  }
  if (!upd.data) {
    // No row matched (id, version): a concurrent write bumped it. Return current for reconciliation.
    const cur = await db().from("client_skills").select(COLUMNS).eq("id", id).maybeSingle();
    if (cur.error) throw cur.error;
    if (!cur.data) return c.json({ error: "not_found" }, 404);
    return c.json({ error: "version_conflict", current: cur.data }, 409);
  }
  return c.json(upd.data);
});

// ---------- DELETE ----------
skills.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const skill = await loadSkill(id, c);
  if (!skill) return c.json({ error: "not_found" }, 404);

  const del = await db().from("client_skills").delete().eq("id", id);
  if (del.error) throw del.error;
  return c.json({ ok: true });
});

// ---------- POST run now (enqueue agent_jobs kind=custom) ----------
skills.post("/:id/run", async (c) => {
  const id = c.req.param("id");
  const skill = await loadSkill(id, c);
  if (!skill) return c.json({ error: "not_found" }, 404);
  if (skill.status === "disabled") return c.json({ error: "skill_disabled" }, 409);

  const operatorId = await getCurrentOperatorId(honoCookieAdapter(c));
  // Enqueue gate (ADR 0027): the operator's runner must be ready, else the job sits unclaimed.
  if (!(await operatorRunnerReady(operatorId))) return c.json({ error: "runner_not_ready" }, 422);

  const ins = await db()
    .from("agent_jobs")
    .insert({
      client_id: skill.client_id,
      product_id: skill.product_id,
      operator_id: operatorId,
      skill: skill.slug,
      skill_id: skill.id,
      kind: "custom",
      args: {},
      requested_by: "operator",
    })
    .select("id, status")
    .single();
  if (ins.error) {
    if (isUniqueViolation(ins.error)) return c.json({ error: "already_in_flight" }, 409);
    throw ins.error;
  }
  return c.json({ jobId: ins.data.id, status: ins.data.status }, 202);
});

// ---------- Schedule (one recurrence per skill) ----------

/** Compute next_run_at via the DB function (single source of truth, same logic the poller uses). */
async function nextRunAt(recurrence: Json, timezone: string): Promise<string> {
  const res = await db().rpc("compute_next_run", {
    p_recurrence: recurrence,
    p_tz: timezone,
    p_from: new Date().toISOString(),
  });
  if (res.error) throw res.error;
  return res.data as unknown as string;
}

// POST: create or replace the skill's schedule.
skills.post("/:id/schedule", async (c) => {
  const id = c.req.param("id");
  const skill = await loadSkill(id, c);
  if (!skill) return c.json({ error: "not_found" }, 404);
  const operatorId = await getCurrentOperatorId(honoCookieAdapter(c));
  if (!operatorId) return c.json({ error: "unauthorized" }, 401);

  const parsed = scheduleInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_request", detail: parsed.error.issues[0]?.message }, 400);
  const { recurrence, timezone, enabled } = parsed.data;

  const next = await nextRunAt(recurrence as Json, timezone);
  const up = await db()
    .from("skill_schedules")
    .upsert(
      {
        skill_id: id,
        client_id: skill.client_id,
        product_id: skill.product_id,
        operator_id: operatorId,
        recurrence: recurrence as Json,
        cron_expression: recurrenceToCron(recurrence),
        timezone,
        enabled,
        next_run_at: next,
      },
      { onConflict: "skill_id" },
    )
    .select("id, recurrence, cron_expression, timezone, enabled, next_run_at, last_run_at")
    .single();
  if (up.error) throw up.error;
  return c.json(up.data);
});

// PATCH: update the recurrence and/or enabled flag; recompute next_run_at when recurrence changes.
skills.patch("/:id/schedule", async (c) => {
  const id = c.req.param("id");
  const skill = await loadSkill(id, c);
  if (!skill) return c.json({ error: "not_found" }, 404);

  const parsed = scheduleInputSchema.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_request", detail: parsed.error.issues[0]?.message }, 400);

  const patch: ScheduleUpdate = {};
  if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
  if (parsed.data.recurrence !== undefined) {
    const tz = parsed.data.timezone ?? "America/Sao_Paulo";
    patch.recurrence = parsed.data.recurrence as Json;
    patch.cron_expression = recurrenceToCron(parsed.data.recurrence);
    patch.timezone = tz;
    patch.next_run_at = await nextRunAt(parsed.data.recurrence as Json, tz);
  }
  if (Object.keys(patch).length === 0) return c.json({ error: "empty_patch" }, 400);

  const upd = await db()
    .from("skill_schedules")
    .update(patch)
    .eq("skill_id", id)
    .select("id, recurrence, cron_expression, timezone, enabled, next_run_at, last_run_at")
    .maybeSingle();
  if (upd.error) throw upd.error;
  if (!upd.data) return c.json({ error: "not_found" }, 404);
  return c.json(upd.data);
});

// DELETE: remove the skill's schedule.
skills.delete("/:id/schedule", async (c) => {
  const id = c.req.param("id");
  const skill = await loadSkill(id, c);
  if (!skill) return c.json({ error: "not_found" }, 404);
  const del = await db().from("skill_schedules").delete().eq("skill_id", id);
  if (del.error) throw del.error;
  return c.json({ ok: true });
});
