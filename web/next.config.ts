import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

// Reuse the repo-root .env.local (canonical secrets home) during local dev/build
// so we don't duplicate secrets into web/. On Vercel, env comes from project
// settings and this load is a no-op (the file isn't deployed).
const dir = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(dir, "../.env.local") });

// The agents' env uses CLAUDE_API_KEY; the Anthropic SDK expects ANTHROPIC_API_KEY.
if (!process.env.ANTHROPIC_API_KEY && process.env.CLAUDE_API_KEY) {
  process.env.ANTHROPIC_API_KEY = process.env.CLAUDE_API_KEY;
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Signed image URLs from Supabase Storage (private bucket previews).
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
};

export default nextConfig;
