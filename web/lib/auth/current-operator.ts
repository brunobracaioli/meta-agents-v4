/**
 * Per-operator identity + ownership checks (ADR 0026, AUTH_MODE=supabase).
 *
 * Deliberately runtime-agnostic: callers pass a `CookieAdapter` bound to their runtime (Hono
 * context in route handlers, next/headers in RSC). This module never imports `next/headers`,
 * so it is safe to import from unit-tested code (Ultron tools) and from the edge middleware.
 *
 * SECURITY MODEL (Phase 3):
 * - In AUTH_MODE=password (legacy, single-tenant) there is no operator identity, so every
 *   check is a no-op: `getCurrentOperatorId` returns null and the ownership guards return true.
 *   Production behaviour is unchanged until the Phase 7 cutover flips the flag.
 * - In AUTH_MODE=supabase the operator's session (auth.uid()) IS the operator id, because
 *   `public.operators.id === auth.users.id` (1:1). Reads lean on RLS; WRITES via service_role
 *   bypass RLS and MUST call an ownership guard here explicitly.
 */
import "server-only";
import { db } from "@/lib/db/client";
import { env } from "@/lib/env";
import { createSupabaseServerClient, type CookieAdapter } from "@/lib/auth/supabase";

export type { CookieAdapter };

/** The current operator's id, or null in password mode (single-tenant) / when unauthenticated. */
export async function getCurrentOperatorId(cookies: CookieAdapter): Promise<string | null> {
  if (env.authMode() !== "supabase") return null;
  const supabase = createSupabaseServerClient(cookies);
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/**
 * Authoritative ownership check used by service_role write paths (RLS does NOT protect them).
 * Uses the service-role client on purpose: it is the source of truth for `clients.operator_id`,
 * independent of the caller's RLS view. Returns true in password mode (operatorId === null).
 */
export async function operatorOwnsClient(operatorId: string | null, clientId: string): Promise<boolean> {
  if (operatorId === null) return true; // password mode: single tenant, nothing to scope
  const { data, error } = await db()
    .from("clients")
    .select("operator_id")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw error;
  return data?.operator_id === operatorId;
}

/** Convenience: resolve the operator from cookies, then check ownership of `clientId`. */
export async function assertOperatorOwnsClient(clientId: string, cookies: CookieAdapter): Promise<boolean> {
  const operatorId = await getCurrentOperatorId(cookies);
  return operatorOwnsClient(operatorId, clientId);
}

export type OperatorStatus = {
  status: string;
  runner_status: string;
  connectors_status: Record<string, unknown>;
  fly_app_name: string | null;
};

/** The operator's onboarding state (service_role). null in password mode or when no row exists. */
export async function getOperatorStatus(operatorId: string | null): Promise<OperatorStatus | null> {
  if (operatorId === null) return null;
  const { data, error } = await db()
    .from("operators")
    .select("status, runner_status, connectors_status, fly_app_name")
    .eq("id", operatorId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    status: data.status,
    runner_status: data.runner_status,
    connectors_status: (data.connectors_status ?? {}) as Record<string, unknown>,
    fly_app_name: data.fly_app_name,
  };
}

/**
 * Enqueue gate (Phase 6): a job may only be queued once the operator's runner can run it.
 * Returns true in password mode (operatorId === null — single-tenant, no gate); otherwise
 * requires the operator to be active AND its Fly runner provisioned + ready (ADR 0027).
 */
export async function operatorRunnerReady(operatorId: string | null): Promise<boolean> {
  if (operatorId === null) return true; // password mode: no gate
  const st = await getOperatorStatus(operatorId);
  return st !== null && st.status === "active" && st.runner_status === "ready";
}
