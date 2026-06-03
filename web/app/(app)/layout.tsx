import type { Metadata } from "next";
import { headers } from "next/headers";
import "../globals.css";

export const metadata: Metadata = {
  title: "Agência de Agents — Dashboard",
  description: "Dashboard operacional + assistente de voz Ultron.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Reading headers opts every route into dynamic rendering, which is what lets
  // Next.js stamp its scripts with the per-request CSP nonce set in middleware.
  await headers();
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
