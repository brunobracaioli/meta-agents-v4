import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agência de Agents — Dashboard",
  description: "Dashboard operacional + assistente de voz Ultron.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
