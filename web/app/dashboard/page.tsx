import Link from "next/link";
import { getOverview } from "@/lib/services/dashboard";
import { formatCents, formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "border-emerald-300/25 bg-emerald-400/10 text-emerald-200",
  PAUSED: "border-amber-300/25 bg-amber-400/10 text-amber-200",
};

export default async function DashboardPage() {
  const { clients, recentActions } = await getOverview();
  const campaignCount = clients.reduce((total, item) => total + item.campaigns.length, 0);
  const activeCampaigns = clients.reduce(
    (total, item) => total + item.campaigns.filter((campaign) => campaign.status === "ACTIVE").length,
    0,
  );
  const dailyCapCents = clients.reduce((total, item) => total + item.client.daily_budget_cap_cents, 0);
  const currency = clients[0]?.client.currency ?? "BRL";

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-cyan-200/55">Centro de comando</p>
            <h1 className="mt-1 text-2xl font-semibold text-white">Painel operacional</h1>
          </div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-white/35">
            {formatDateTime(new Date().toISOString())}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="tech-panel rounded-lg p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">Clientes</p>
            <p className="mt-2 text-2xl font-semibold text-white">{clients.length}</p>
          </div>
          <div className="tech-panel rounded-lg p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">Campanhas</p>
            <p className="mt-2 text-2xl font-semibold text-cyan-100">{campaignCount}</p>
          </div>
          <div className="tech-panel rounded-lg p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">Ativas</p>
            <p className="mt-2 text-2xl font-semibold text-emerald-200">{activeCampaigns}</p>
          </div>
          <div className="tech-panel rounded-lg p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">Cap diário</p>
            <p className="mt-2 text-2xl font-semibold text-orange-200">
              {formatCents(dailyCapCents, currency)}
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">Campanhas por cliente</h2>
          <span className="tech-chip rounded px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/45">
            {campaignCount} total
          </span>
        </div>

        {clients.length === 0 && (
          <p className="text-sm text-white/50">
            Nenhum cliente cadastrado ainda. Os agents populam isto ao rodar.
          </p>
        )}

        <div className="grid gap-4">
          {clients.map(({ client, campaigns }) => (
            <div
              key={client.id}
              className="tech-panel rounded-lg p-4 sm:p-5"
            >
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <Link
                  href={`/dashboard/clients/${client.slug}`}
                  className="group min-w-0 font-medium text-white hover:text-cyan-100"
                >
                  <span className="mr-2 inline-block h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,0.8)] transition group-hover:bg-orange-300" />
                  {client.name}
                </Link>
                <span className="font-mono text-xs uppercase tracking-[0.12em] text-white/40">
                  cap {formatCents(client.daily_budget_cap_cents, client.currency)}/dia
                </span>
              </div>

              {campaigns.length === 0 ? (
                <p className="text-sm text-white/40">Sem campanhas.</p>
              ) : (
                <ul className="space-y-1">
                  {campaigns.map((campaign) => (
                    <li
                      key={campaign.id}
                      className="flex items-center justify-between gap-3 border-t border-white/5 py-2 first:border-t-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-white/90">{campaign.name}</p>
                        <p className="text-xs text-white/40">
                          {campaign.objective} · {campaign.budget_mode} ·{" "}
                          {formatCents(campaign.daily_budget_cents, client.currency)}/dia
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${
                          STATUS_STYLES[campaign.status] ?? "border-white/10 bg-white/5 text-white/55"
                        }`}
                      >
                        {campaign.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">Atividade recente</h2>
          <span className="tech-chip rounded px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/45">
            {recentActions.length} logs
          </span>
        </div>
        {recentActions.length === 0 ? (
          <p className="text-sm text-white/50">Sem ações registradas.</p>
        ) : (
          <ul className="space-y-2">
            {recentActions.map((log) => (
              <li
                key={log.id}
                className="tech-panel flex items-start gap-3 rounded-lg px-4 py-3"
              >
                <span className="mt-0.5 shrink-0 rounded border border-violet-300/20 bg-violet-400/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-violet-100/80">
                  {log.action}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white/80">{log.summary ?? log.entity_type}</p>
                  <p className="text-xs text-white/35">
                    {log.actor} · {formatDateTime(log.created_at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
