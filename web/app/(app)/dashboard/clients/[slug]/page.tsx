import Link from "next/link";
import { notFound } from "next/navigation";
import { getClientDetail } from "@/lib/services/client-detail";
import { getClientProducts } from "@/lib/services/landing-page";
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
    <div className="tech-panel rounded-lg p-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">{label}</p>
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
  const [detail, products] = await Promise.all([getClientDetail(slug), getClientProducts(slug)]);
  if (!detail) notFound();

  const { client, campaigns, creatives, latestAnalysis } = detail;
  // North-star view: the campaign-level snapshot with the most spend, if any.
  const top = latestAnalysis?.snapshots.find((s) => s.level === "campaign") ?? latestAnalysis?.snapshots[0];

  return (
    <div className="space-y-9">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Link
            href="/dashboard"
            className="inline-flex rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 text-sm text-white/55 transition hover:border-cyan-200/25 hover:text-white"
          >
          ← Visão geral
          </Link>
          <h1 className="mt-3 truncate text-2xl font-semibold text-white">{client.name}</h1>
          <p className="mt-1 text-sm text-white/40">
            conta {client.ad_account_id} · cap {formatCents(client.daily_budget_cap_cents, client.currency)}/dia
            {client.default_landing_url ? ` · ${client.default_landing_url}` : ""}
          </p>
        </div>
        <span className="tech-chip w-fit rounded px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-100/70">
          Nó cliente
        </span>
      </div>

      {/* Latest performance analysis */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-white">Performance</h2>
          {latestAnalysis && (
            <span
              className={`rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${
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
                  <li key={f.id} className="tech-panel rounded-lg px-4 py-3">
                    <div className="mb-1 flex items-center gap-2">
                      <span
                        className={`rounded border border-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${SEVERITY_STYLES[f.severity] ?? "bg-white/10"}`}
                      >
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

      {/* Products & landing pages */}
      {products && products.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-white">Produtos &amp; landing pages</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => (
              <Link
                key={p.id}
                href={`/dashboard/clients/${slug}/${p.slug}`}
                className="tech-panel block rounded-xl border border-white/8 p-4 transition hover:border-cyan-200/25"
              >
                <p className="truncate text-sm font-medium text-white/90">{p.name}</p>
                <p className="mt-1 font-mono text-xs text-white/40">{p.slug}</p>
                <p className="mt-2 text-[11px] text-cyan-200/60">
                  {p.landingPageCount} landing page{p.landingPageCount === 1 ? "" : "s"} →
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Campaigns */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">Campanhas ({campaigns.length})</h2>
        {campaigns.length === 0 ? (
          <p className="text-sm text-white/50">Sem campanhas.</p>
        ) : (
          <ul className="tech-panel divide-y divide-white/5 rounded-lg">
            {campaigns.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
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
                    className="shrink-0 rounded border border-orange-300/20 bg-orange-400/10 px-2 py-1 text-xs text-orange-200 hover:border-orange-300/40"
                  >
                    Ads Manager ↗
                  </a>
                ) : (
                  <span className="shrink-0 font-mono text-xs uppercase tracking-[0.12em] text-white/40">{c.status}</span>
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
              <div key={cr.id} className="tech-panel overflow-hidden rounded-lg">
                {cr.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cr.image_url} alt={cr.headline ?? "criativo"} className="aspect-square w-full object-cover" />
                )}
                <div className="space-y-1 p-3">
                  {cr.headline && <p className="text-sm font-medium text-white/90">{cr.headline}</p>}
                  {cr.primary_text && <p className="line-clamp-3 text-xs text-white/50">{cr.primary_text}</p>}
                  {cr.call_to_action_type && (
                    <span className="inline-block rounded border border-orange-300/20 bg-orange-400/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-orange-200">
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
