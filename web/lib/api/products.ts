import { Hono } from "hono";
import type { Context } from "hono";
import { db } from "@/lib/db/client";
import { getReadClient } from "@/lib/db/read-client";
import type { Database } from "@/lib/db/types";
import { operatorIdFromRequest } from "@/lib/auth/hono-cookies";
import { operatorOwnsClient } from "@/lib/auth/current-operator";
import { productInputSchema, productPatchSchema } from "@/lib/products/validate";

// SPEC-018.1 §Backend — product management. Products have no operator_id; ownership is transitive
// through the client (operatorOwnsClient on the product's client_id). Reads via the
// authenticated client (RLS products_select_own); writes via service_role + ownership guard.

type ProductUpdate = Database["public"]["Tables"]["products"]["Update"];

const COLUMNS = "id, client_id, slug, name, default_subdomain, status";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}

/** Load a product's guard-relevant state, or null if it doesn't exist OR the operator does not own
 * its client. Returning null → callers answer 404 (never reveals a cross-tenant product). */
async function loadProduct(id: string, c: Context) {
  const res = await db().from("products").select("id, client_id").eq("id", id).maybeSingle();
  if (res.error) throw res.error;
  if (!res.data) return null;
  if (!(await operatorOwnsClient(operatorIdFromRequest(c), res.data.client_id))) return null;
  return res.data;
}

export const products = new Hono();

// ---------- GET list (a client's products; RLS-scoped) ----------
products.get("/", async (c) => {
  const clientId = c.req.query("clientId");
  const supabase = await getReadClient();
  let q = supabase.from("products").select(COLUMNS).order("created_at", { ascending: true });
  if (clientId) q = q.eq("client_id", clientId);
  const res = await q;
  if (res.error) throw res.error;
  return c.json(res.data ?? []);
});

// ---------- POST create ----------
products.post("/", async (c) => {
  const parsed = productInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_request", detail: parsed.error.issues[0]?.message }, 400);
  const d = parsed.data;

  if (!(await operatorOwnsClient(operatorIdFromRequest(c), d.clientId))) return c.json({ error: "not_found" }, 404);

  const ins = await db()
    .from("products")
    .insert({
      client_id: d.clientId,
      slug: d.slug,
      name: d.name,
      default_subdomain: d.default_subdomain ?? null,
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

// ---------- PATCH update ----------
products.patch("/:id", async (c) => {
  const id = c.req.param("id");
  if (!(await loadProduct(id, c))) return c.json({ error: "not_found" }, 404);

  const parsed = productPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_request", detail: parsed.error.issues[0]?.message }, 400);

  const patch: ProductUpdate = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.default_subdomain !== undefined) patch.default_subdomain = parsed.data.default_subdomain ?? null;
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;
  if (Object.keys(patch).length === 0) return c.json({ error: "empty_patch" }, 400);

  const upd = await db().from("products").update(patch).eq("id", id).select(COLUMNS).single();
  if (upd.error) throw upd.error;
  return c.json(upd.data);
});

// ---------- DELETE ----------
products.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!(await loadProduct(id, c))) return c.json({ error: "not_found" }, 404);
  const del = await db().from("products").delete().eq("id", id);
  if (del.error) throw del.error;
  return c.json({ ok: true });
});
