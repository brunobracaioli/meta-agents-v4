/**
 * Per-request READ client for the dashboard (ADR 0026, Phase 3).
 *
 * - AUTH_MODE=password (legacy/default): returns the service-role `db()` singleton — same
 *   behaviour as today (single-tenant, RLS bypassed). Production is untouched until Phase 7.
 * - AUTH_MODE=supabase: returns an AUTHENTICATED client bound to the operator's session
 *   cookies, so every read runs as role `authenticated` and the per-operator RLS SELECT
 *   policies isolate rows to the operator's own clients.
 *
 * `next/headers` is imported DYNAMICALLY and only in the supabase branch, so password-mode
 * callers (current prod + every unit test, where AUTH_MODE is unset) never load it — keeping
 * the services importable outside a request scope.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "@/lib/db/client";
import { env } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/auth/supabase";
import type { Database } from "@/lib/db/types";

export async function getReadClient(): Promise<SupabaseClient<Database>> {
  if (env.authMode() !== "supabase") return db();
  // RSC and Route Handlers (where the dashboard services run) both support next/headers.
  const { cookies } = await import("next/headers");
  const store = await cookies();
  return createSupabaseServerClient({
    getAll: () => store.getAll().map(({ name, value }) => ({ name, value })),
    // RSC cannot set cookies; the middleware already refreshes the session. No-op is correct.
    setAll: () => {},
  });
}
