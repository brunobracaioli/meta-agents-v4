import Link from "next/link";
import { getOverview } from "@/lib/services/dashboard";
import { formatCents, formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-green-500/15 text-green-300",
  PAUSED: "bg-yellow-500/15 text-yellow-300",
};

export default async function DashboardPage() {
  const { clients, recentActions } = await getOverview();

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h1 className="text-lg font-semibold text-white">Campanhas por cliente</h1>

        {clients.length === 0 && (
          <p className="text-sm text-white/50">
            Nenhum cliente cadastrado ainda. Os agents populam isto ao rodar.
          </p>
        )}

        <div className="grid gap-4">
          {clients.map(({ client, campaigns }) => (
            <div
              key={client.id}
              className="rounded-2xl border border-white/10 bg-[var(--color-navy-soft)] p-5"
            >
              <div className="mb-3 flex items-baseline justify-between">
                <Link
                  href={`/dashboard/clients/${client.slug}`}
                  className="font-medium text-white hover:text-[var(--color-orange)]"
                >
                  {client.name}
                </Link>
                <span className="text-xs text-white/40">
                  cap {formatCents(client.daily_budget_cap_cents, client.currency)}/dia
                </span>
              </div>

              {campaigns.length === 0 ? (
                <p className="text-sm text-white/40">Sem campanhas.</p>
              ) : (
                <ul className="divide-y divide-white/5">
                  {campaigns.map((campaign) => (
                    <li key={campaign.id} className="flex items-center justify-between py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-white/90">{campaign.name}</p>
                        <p className="text-xs text-white/40">
                          {campaign.objective} · {campaign.budget_mode} ·{" "}
                          {formatCents(campaign.daily_budget_cents, client.currency)}/dia
                        </p>
                      </div>
                      <span
                        className={`ml-3 shrink-0 rounded-full px-2 py-0.5 text-xs ${
                          STATUS_STYLES[campaign.status] ?? "bg-white/10 text-white/60"
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
        <h2 className="text-lg font-semibold text-white">Atividade recente</h2>
        {recentActions.length === 0 ? (
          <p className="text-sm text-white/50">Sem ações registradas.</p>
        ) : (
          <ul className="space-y-2">
            {recentActions.map((log) => (
              <li
                key={log.id}
                className="flex items-start gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-4 py-2"
              >
                <span className="mt-0.5 rounded bg-white/10 px-1.5 py-0.5 text-xs text-white/60">
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
