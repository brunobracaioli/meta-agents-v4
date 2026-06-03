import type { Metadata } from "next";
import { headers } from "next/headers";
// Second ROOT layout (route group). The live landing-page preview is a visually
// independent surface from the dashboard: it must render with the landing-page
// design system only — NOT the dashboard's globals.css (Tailwind preflight + dark
// grid background would bleed in). Route groups let us give it its own <html>.
// Self-hosted fonts mirror the static template so the preview matches the published
// page byte-for-byte. See SPEC-012 §2 / ADR 0017.
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/700.css";
import "@b2tech/lp-render/globals.css";

export const metadata: Metadata = {
  title: "Pré-visualização — Landing page",
  // The preview is an internal authoring surface; never index it.
  robots: { index: false, follow: false },
};

export default async function PreviewRootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Reading headers opts into dynamic rendering so Next stamps its hydration scripts
  // with the per-request CSP nonce set in middleware (the preview is fully hydrated).
  await headers();
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
