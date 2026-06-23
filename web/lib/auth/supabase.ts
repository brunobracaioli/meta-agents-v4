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
