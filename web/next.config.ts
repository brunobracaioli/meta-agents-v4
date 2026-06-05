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
  // The live landing-page preview (/lp-preview/[id]) renders the same React section
  // components the static template uses, imported from the shared @b2tech/lp-render
  // package (a file: dependency, not pre-compiled). Next must transpile it. See ADR 0017.
  transpilePackages: ["@b2tech/lp-render"],
  // Signed image URLs from Supabase Storage (private bucket previews).
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
  // @b2tech/lp-render is a symlinked file: dep. By default webpack resolves it to its realpath
  // (packages/lp-render/), where a clean Vercel install has NO node_modules — so its deep deps
  // (three + three/examples/jsm/* addons in Stage3D) fail to resolve. Disabling symlink
  // resolution makes webpack resolve them from THIS app's node_modules (where three lives),
  // mirroring the TS-side preserveSymlinks fix. See ADR 0017.
  webpack: (config) => {
    config.resolve.symlinks = false;
    // With symlinks=false, webpack sees @b2tech/lp-render at its node_modules symlink path,
    // so Next's persistent webpack cache treats it as a "managed" (immutable) package and
    // invalidates it ONLY on a version bump — never on source content changes. As a `file:`
    // workspace dep it changes constantly without a version bump, so cached transpiled modules
    // were reused across Vercel builds and shipped STALE code (a render-guard fix in
    // lp-render never reached the deployed bundle → 500 on /lp-preview). Excluding the
    // package from managedPaths makes webpack content-snapshot it, so it rebuilds whenever
    // its source changes. See ADR 0017.
    config.snapshot = {
      ...(config.snapshot ?? {}),
      managedPaths: [/^(.+?[\\/]node_modules[\\/](?!@b2tech[\\/]lp-render))/],
    };
    return config;
  },
};

export default nextConfig;
