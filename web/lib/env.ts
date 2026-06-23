/**
 * Centralized, validated access to server-only environment variables.
 * Never import this from a Client Component — these values must stay server-side.
 */
import "server-only";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export const env = {
  supabaseUrl: () => required("SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseSecretKey: () => required("SUPABASE_SECRET_KEY"),
  // Publishable (anon) key for the authenticated, per-operator Supabase client used in
  // AUTH_MODE=supabase. Public by design (RLS enforces isolation).
  supabasePublishableKey: () => required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  authSecret: () => required("AUTH_SECRET"),
  dashboardPasswordHash: () => required("DASHBOARD_PASSWORD"),
  // Auth strategy. "password" = legacy single-password gate (ADR 0006, default, keeps the
  // live login untouched). "supabase" = per-operator Supabase Auth (ADR 0026). The cutover
  // to "supabase" happens in Phase 7 once brunobracaioli exists as operator #1.
  authMode: (): "password" | "supabase" =>
    process.env.AUTH_MODE === "supabase" ? "supabase" : "password",
  // Open signup is off by default; onboarding is invite/admin-gated (threat model).
  allowSignup: () => process.env.AUTH_ALLOW_SIGNUP === "true",
  anthropicApiKey: () => required("ANTHROPIC_API_KEY", process.env.CLAUDE_API_KEY),
  openaiApiKey: () => required("OPENAI_API_KEY"),
  elevenLabsApiKey: () => required("ELEVENLABS_API_KEY"),
  elevenLabsVoiceId: () => required("ELEVENLABS_VOICE_ID"),
  upstashRedisUrl: () => required("UPSTASH_REDIS_REST_URL"),
  upstashRedisToken: () => required("UPSTASH_REDIS_REST_TOKEN"),
  // Cloudflare Turnstile (bot/brute-force protection on login). Optional: when the
  // secret is absent the login endpoint skips the captcha check (e.g. local/tests).
  // The site key is public by design — read server-side and passed to the client.
  turnstileSiteKey: () => optional("CLOUDFLARE_TURNSTILE_SITE_KEY"),
  turnstileSecretKey: () => optional("CLOUDFLARE_TURNSTILE_SECRET_KEY"),
} as const;
