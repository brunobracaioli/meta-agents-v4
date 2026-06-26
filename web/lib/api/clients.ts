import { Hono } from "hono";
import { db } from "@/lib/db/client";
import { getReadClient } from "@/lib/db/read-client";
import type { Database } from "@/lib/db/types";
import { honoCookieAdapter } from "@/lib/auth/hono-cookies";
import { getCurrentOperatorId, assertOperatorOwnsClient } from "@/lib/auth/current-operator";
import { clientInputSchema, clientPatchSchema } from "@/lib/clients/validate";

type ClientUpdate = Database["public"]["Tables"]["clients"]["Update"];

// SPEC-018 §3.2 — client management. Reads run through the authenticated client (RLS isolates by
// operator). Writes run via service_role (`db()`, RLS bypassed) and MUST guard ownership
// explicitly. operator_id is always stamped from auth.uid() on create — never taken from the body.

const CLIENT_COLUMNS =
  "id, operator_id, slug, name, ad_account_id, business_manager_id, facebook_page_id, default_landing_url, daily_budget_cap_cents, currency, materials_path";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}

export const clients = new Hono();

// ---------- GET list (operator's own clients via RLS) ----------
clients.get("/", async (c) => {
  const supabase = await getReadClient();
  const res = await supabase.from("clients").select(CLIENT_COLUMNS).order("created_at", { ascending: true });
  if (res.error) throw res.error;
  return c.json(res.data ?? []);
});

// ---------- POST create ----------
clients.post("/", async (c) => {
  const operatorId = await getCurrentOperatorId(honoCookieAdapter(c));
  // Client creation requires an operator identity (supabase mode). Never stamp a null operator_id
  // into a NOT NULL column; in password mode there is no operator to own the row.
  if (!operatorId) return c.json({ error: "unauthorized" }, 401);

  const parsed = clientInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_request", detail: parsed.error.issues[0]?.message }, 400);

  // Build the row explicitly: nullish optionals become null (never undefined) to satisfy
  // exactOptionalPropertyTypes, and operator_id comes from the session — never from the body.
  const d = parsed.data;
  const ins = await db()
    .from("clients")
    .insert({
      operator_id: operatorId,
      slug: d.slug,
      name: d.name,
      ad_account_id: d.ad_account_id,
      business_manager_id: d.business_manager_id ?? null,
      facebook_page_id: d.facebook_page_id ?? null,
      default_landing_url: d.default_landing_url ?? null,
      daily_budget_cap_cents: d.daily_budget_cap_cents,
      currency: d.currency,
      materials_path: d.materials_path ?? null,
    })
    .select(CLIENT_COLUMNS)
    .single();
  if (ins.error) {
    if (isUniqueViolation(ins.error)) return c.json({ error: "slug_or_ad_account_in_use" }, 409);
    throw ins.error;
  }
  return c.json(ins.data, 201);
});

// ---------- PATCH update ----------
clients.patch("/:id", async (c) => {
  const id = c.req.param("id");
  // Ownership guard before any service_role write; 404 on cross-tenant never reveals existence.
  if (!(await assertOperatorOwnsClient(id, honoCookieAdapter(c)))) return c.json({ error: "not_found" }, 404);

  const parsed = clientPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_request", detail: parsed.error.issues[0]?.message }, 400);

  // Only include keys the caller actually sent; map nullish optionals to null (no undefined).
  const d = parsed.data;
  const patch: ClientUpdate = {};
  if (d.name !== undefined) patch.name = d.name;
  if (d.ad_account_id !== undefined) patch.ad_account_id = d.ad_account_id;
  if (d.business_manager_id !== undefined) patch.business_manager_id = d.business_manager_id ?? null;
  if (d.facebook_page_id !== undefined) patch.facebook_page_id = d.facebook_page_id ?? null;
  if (d.default_landing_url !== undefined) patch.default_landing_url = d.default_landing_url ?? null;
  if (d.daily_budget_cap_cents !== undefined) patch.daily_budget_cap_cents = d.daily_budget_cap_cents;
  if (d.currency !== undefined) patch.currency = d.currency;
  if (d.materials_path !== undefined) patch.materials_path = d.materials_path ?? null;
  if (Object.keys(patch).length === 0) return c.json({ error: "empty_patch" }, 400);

  const upd = await db().from("clients").update(patch).eq("id", id).select(CLIENT_COLUMNS).single();
  if (upd.error) {
    if (isUniqueViolation(upd.error)) return c.json({ error: "slug_or_ad_account_in_use" }, 409);
    throw upd.error;
  }
  return c.json(upd.data);
});

// ---------- DELETE ----------
clients.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!(await assertOperatorOwnsClient(id, honoCookieAdapter(c)))) return c.json({ error: "not_found" }, 404);

  const del = await db().from("clients").delete().eq("id", id);
  if (del.error) throw del.error;
  return c.json({ ok: true });
});
