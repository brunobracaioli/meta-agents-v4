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
  authSecret: () => required("AUTH_SECRET"),
  dashboardPasswordHash: () => required("DASHBOARD_PASSWORD"),
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
