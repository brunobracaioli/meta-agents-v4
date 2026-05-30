/**
 * Server-only Supabase client using the secret (service) key. It talks to
 * PostgREST over HTTPS and bypasses RLS — so it must NEVER reach the browser.
 * All dashboard reads go through here (read-only by convention).
 */
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { Database } from "@/lib/db/types";

let cached: SupabaseClient<Database> | null = null;

export function db(): SupabaseClient<Database> {
  if (cached) return cached;
  cached = createClient<Database>(env.supabaseUrl(), env.supabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
