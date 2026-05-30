import Link from "next/link";
import { notFound } from "next/navigation";
import { getClientDetail } from "@/lib/services/client-detail";
import {
  formatCents,
  formatDateTime,
  formatPercent,
  formatRatio,
  SEVERITY_STYLES,
  VERDICT_STYLES,
} from "@/lib/format";

export const dynamic = "force-dynamic";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <p className="text-xs uppercase tracking-wide text-white/40">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const detail = await getClientDetail(slug);
  if (!detail) notFound();

  const { client, campaigns, creatives, latestAnalysis } = detail;
  // North-star view: the campaign-level snapshot with the most spend, if any.
  const top = latestAnalysis?.snapshots.find((s) => s.level === "campaign") ?? latestAnalysis?.snapshots[0];

  return (
    <div className="space-y-10">
      <div>
        <Link href="/dashboard" className="text-sm text-white/50 hover:text-white">
          ← Visão geral
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-white">{client.name}</h1>
        <p className="text-sm text-white/40">
          conta {client.ad_account_id} · cap {formatCents(client.daily_budget_cap_cents, client.currency)}/dia
          {client.default_landing_url ? ` · ${client.default_landing_url}` : ""}
        </p>
      </div>

      {/* Latest performance analysis */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-white">Performance</h2>
          {latestAnalysis && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                VERDICT_STYLES[latestAnalysis.analysis.overall_verdict] ?? "bg-white/10 text-white/60"
              }`}
            >
              {latestAnalysis.analysis.overall_verdict}
            </span>
          )}
        </div>

        {!latestAnalysis ? (
          <p className="text-sm text-white/50">
            Nenhuma análise ainda. A skill de análise roda a cada 3 dias.
          </p>
        ) : (
          <div className="space-y-4">
            {latestAnalysis.analysis.summary && (
              <p className="text-sm text-white/70">{latestAnalysis.analysis.summary}</p>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Metric label="CPLPV" value={formatCents(top?.cplpv_cents, client.currency)} />
              <Metric label="CTR" value={formatPercent(top?.ctr)} />
              <Metric label="CPC" value={formatCents(top?.cpc_cents, client.currency)} />
              <Metric label="CPM" value={formatCents(top?.cpm_cents, client.currency)} />
              <Metric label="Freq." value={formatRatio(top?.frequency)} />
              <Metric label="Gasto" value={formatCents(top?.spend_cents, client.currency)} />
            </div>

            {latestAnalysis.findings.length > 0 && (
              <ul className="space-y-2">
                {latestAnalysis.findings.map((f) => (
                  <li key={f.id} className="rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3">
                    <div className="mb-1 flex items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${SEVERITY_STYLES[f.severity] ?? "bg-white/10"}`}>
                        {f.severity}
                      </span>
                      {f.entity_name && <span className="text-xs text-white/40">{f.entity_name}</span>}
                    </div>
                    <p className="text-sm text-white/80">{f.diagnosis}</p>
                    {f.recommended_action && (
                      <p className="mt-1 text-xs text-white/50">→ {f.recommended_action}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-white/30">
              Analisado em {formatDateTime(latestAnalysis.analysis.created_at)}
            </p>
          </div>
        )}
      </section>

      {/* Campaigns */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">Campanhas ({campaigns.length})</h2>
        {campaigns.length === 0 ? (
          <p className="text-sm text-white/50">Sem campanhas.</p>
        ) : (
          <ul className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-[var(--color-navy-soft)]">
            {campaigns.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-white/90">{c.name}</p>
                  <p className="text-xs text-white/40">
                    {c.objective} · {c.budget_mode} · {formatCents(c.daily_budget_cents, client.currency)}/dia
                  </p>
                </div>
                {c.ads_manager_url ? (
                  <a
                    href={c.ads_manager_url}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-3 shrink-0 text-xs text-[var(--color-orange)] hover:underline"
                  >
                    Ads Manager ↗
                  </a>
                ) : (
                  <span className="ml-3 shrink-0 text-xs text-white/40">{c.status}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Creatives */}
      {creatives.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-white">Criativos ({creatives.length})</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {creatives.map((cr) => (
              <div key={cr.id} className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
                {cr.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cr.image_url} alt={cr.headline ?? "criativo"} className="aspect-square w-full object-cover" />
                )}
                <div className="space-y-1 p-3">
                  {cr.headline && <p className="text-sm font-medium text-white/90">{cr.headline}</p>}
                  {cr.primary_text && <p className="line-clamp-3 text-xs text-white/50">{cr.primary_text}</p>}
                  {cr.call_to_action_type && (
                    <span className="inline-block rounded bg-[var(--color-orange)]/20 px-1.5 py-0.5 text-xs text-[var(--color-orange)]">
                      {cr.call_to_action_type}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
