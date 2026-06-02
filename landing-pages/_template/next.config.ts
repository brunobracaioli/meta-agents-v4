import type { NextConfig } from "next";

// Static export → flat `out/` (index.html, sitemap.xml, robots.txt, _next/, og.png).
// This is exactly what `wrangler pages deploy out` expects. See ADR 0012.
//
// HARD CONSTRAINTS of output:'export' — do NOT add API routes, server actions,
// middleware, ISR, or dynamic server rendering. They break the build in export mode.
const noindex = process.env.NEXT_PUBLIC_NOINDEX === "1";

const nextConfig: NextConfig = {
  output: "export",
  // next/image optimizer requires a running server; mandatory for static export.
  images: { unoptimized: true },
  // CF Pages serves /sec/ → /sec/index.html cleanly with trailing slashes.
  trailingSlash: true,
  // Re-export so client components and metadata can read it at build time.
  env: { NEXT_PUBLIC_NOINDEX: noindex ? "1" : "0" },
};

export default nextConfig;
