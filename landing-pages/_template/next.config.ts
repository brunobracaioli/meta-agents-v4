import type { NextConfig } from "next";

// Static export → flat `out/` (index.html, sitemap.xml, robots.txt, _next/, og.png).
// This is exactly what `wrangler pages deploy out` expects. See ADR 0012.
//
// HARD CONSTRAINTS of output:'export' — do NOT add API routes, server actions,
// middleware, ISR, or dynamic server rendering. They break the build in export mode.
const noindex = process.env.NEXT_PUBLIC_NOINDEX === "1";

const nextConfig: NextConfig = {
  output: "export",
  // The shared render package ships untranspiled TS/TSX (no build step); Next compiles
  // it as part of this app. See ADR 0017.
  transpilePackages: ["@b2tech/lp-render"],
  // next/image optimizer requires a running server; mandatory for static export.
  images: { unoptimized: true },
  // CF Pages serves /sec/ → /sec/index.html cleanly with trailing slashes.
  trailingSlash: true,
  // Re-export so client components and metadata can read it at build time.
  env: { NEXT_PUBLIC_NOINDEX: noindex ? "1" : "0" },
  // This template is a GENERATED artifact: it's cloned per landing page and built
  // headlessly on the Fly runner, where only the JSON content changes — the TypeScript
  // (this shell + @b2tech/lp-render) is identical across every build. Type/lint checking
  // is gated once at the SOURCE (`npm run type-check` in the template + package, run in
  // dev/CI) instead of on every per-LP headless build, which also avoids shipping the
  // shared package's node_modules into the Fly image just to resolve its React types.
  // See ADR 0017.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
