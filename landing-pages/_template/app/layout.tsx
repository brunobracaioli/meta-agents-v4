import type { Metadata } from "next";
import { contentSpec, messages } from "@/lib/content";
import { buildJsonLd } from "@/lib/jsonld";
import { Consent } from "@/components/Consent";
import { Tracking } from "@/components/Tracking";
// Self-hosted fonts (@fontsource) — bundled at build time, no network during `next build`
// on the headless Fly runner. Inter for titles, DM Sans for body. See ADR 0013.
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/700.css";
import "@b2tech/lp-render/globals.css";

const noindex = process.env.NEXT_PUBLIC_NOINDEX === "1";

export const metadata: Metadata = {
  metadataBase: new URL(contentSpec.site_url),
  title: messages.seo.title,
  description: messages.seo.description,
  openGraph: {
    title: messages.seo.title,
    description: messages.seo.description,
    url: contentSpec.site_url,
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: messages.seo.ogAlt }],
  },
  ...(noindex ? { robots: { index: false, follow: false } } : {}),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const jsonLd = buildJsonLd(contentSpec, messages.seo.title, messages.seo.description);
  return (
    <html lang="pt-BR">
      <head>
        <script
          type="application/ld+json"
          // JSON-LD is server-rendered into static HTML; safe (no user input).
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>
        {children}
        <Consent />
        <Tracking />
      </body>
    </html>
  );
}
