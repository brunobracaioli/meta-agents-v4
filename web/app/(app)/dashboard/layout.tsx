import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";
import { UltronWidget } from "@/components/ultron/ultron-widget";

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-cyan-300/15 bg-[#050814]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/dashboard" className="flex min-w-0 items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-orange-300/35 bg-orange-400/10">
              <span className="h-2.5 w-2.5 rounded-full bg-orange-300 shadow-[0_0_16px_rgba(251,146,60,0.85)]" />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-mono text-sm font-semibold uppercase tracking-[0.18em] text-white">
                Agência de Agents
              </span>
              <span className="block truncate text-xs text-cyan-100/45">Operação Meta Ads</span>
            </span>
          </Link>
          <nav className="flex items-center gap-2 text-sm text-white/70">
            <Link
              href="/dashboard"
              className="rounded-md border border-transparent px-3 py-2 transition hover:border-cyan-200/20 hover:bg-white/[0.03] hover:text-white"
            >
              Visão geral
            </Link>
            <Link
              href="/dashboard/landing-pages"
              className="rounded-md border border-transparent px-3 py-2 transition hover:border-cyan-200/20 hover:bg-white/[0.03] hover:text-white"
            >
              Landing pages
            </Link>
            <Link
              href="/dashboard/live"
              className="rounded-md border border-transparent px-3 py-2 transition hover:border-cyan-200/20 hover:bg-white/[0.03] hover:text-white"
            >
              Ao vivo
            </Link>
            <LogoutButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      <UltronWidget />
    </div>
  );
}
