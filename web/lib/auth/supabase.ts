/**
 * Per-operator Supabase Auth client (ADR 0026, AUTH_MODE=supabase).
 *
 * Edge-safe by design: this module imports ONLY @supabase/ssr and reads env directly, so
 * it can run in middleware (Edge) as well as in Node route handlers. It does NOT import the
 * server-only `env` module. Callers supply a cookie adapter bound to their runtime (Hono
 * context in route handlers, NextRequest/NextResponse in middleware).
 *
 * The client uses the publishable (anon) key + the operator's session cookies, so every
 * query runs as role `authenticated` and RLS isolates rows to the operator's own clients.
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { Database } from "@/lib/db/types";

export type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Internal request header the middleware stamps with the verified operator id (auth.uid()) after
 * its single `getUser()` refresh, so route handlers read identity from here instead of calling
 * `getUser()` a second time. A second call would try to refresh with an already-rotated refresh
 * token and silently resolve to null (orphaned, unclaimable agent_jobs). The middleware MUST strip
 * any inbound value of this header before stamping — it is server-trusted, never client-supplied.
 */
export const OPERATOR_ID_HEADER = "x-operator-id";

export interface CookieAdapter {
  getAll(): { name: string; value: string }[];
  setAll(cookies: CookieToSet[]): void;
}

function supabaseUrl(): string {
  const u = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!u) throw new Error("Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL");
  return u;
}

function publishableKey(): string {
  const k = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!k) throw new Error("Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  return k;
}

export function createSupabaseServerClient(cookies: CookieAdapter) {
  return createServerClient<Database>(supabaseUrl(), publishableKey(), { cookies });
}
