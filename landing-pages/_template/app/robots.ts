import type { MetadataRoute } from "next";
import { contentSpec } from "@/lib/content";

// Static robots.txt emitted into out/. Honors NEXT_PUBLIC_NOINDEX (build-time):
// noindex=1 → Disallow: / (preview); noindex=0 → indexable (go-live). See ADR 0012.
const noindex = process.env.NEXT_PUBLIC_NOINDEX === "1";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  if (noindex) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${contentSpec.site_url}/sitemap.xml`,
  };
}
