import type { MetadataRoute } from "next";
import { contentSpec } from "@/lib/content";

// Static sitemap.xml emitted into out/.
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: contentSpec.site_url,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
