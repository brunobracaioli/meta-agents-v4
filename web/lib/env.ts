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
} as const;
