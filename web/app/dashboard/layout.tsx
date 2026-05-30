import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";
import { UltronWidget } from "@/components/ultron/ultron-widget";

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-[var(--color-navy)]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--color-orange)]" />
            <span className="font-semibold text-white">Agência de Agents</span>
          </Link>
          <nav className="flex items-center gap-6 text-sm text-white/70">
            <Link href="/dashboard" className="hover:text-white">
              Visão geral
            </Link>
            <Link href="/dashboard/live" className="hover:text-white">
              Ao vivo
            </Link>
            <LogoutButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      <UltronWidget />
    </div>
  );
}
