"use client";

import { useMemo, useState } from "react";
import type { AnalysisRound } from "@/lib/services/analyses";
import {
  formatCents,
  formatDateTime,
  formatNumber,
  formatPercent,
  SEVERITY_STYLES,
  VERDICT_STYLES,
} from "@/lib/format";
import {
  compareSnapshots,
  RECOMMENDATION_LABELS,
  snapshotDisplayName,
  SORT_OPTIONS,
  type SortKey,
} from "./analyses-table-utils";

// window_start/stop are plain dates ("2026-06-03"); format in UTC so the
// America/Sao_Paulo offset doesn't shift them to the previous day.
function formatDateOnly(date: string | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "UTC" }).format(
    new Date(date),
  );
}

const SELECT_CLASSES =
  "rounded-md border border-white/10 bg-[#0a0f1f] px-3 py-2 text-sm text-white/80 outline-none transition focus:border-cyan-200/40";

const HEADER_CELL_CLASSES =
  "px-3 py-2.5 text-left font-mono text-[10px] font-normal uppercase tracking-[0.14em] text-white/40";

export function AnalysesTable({ rounds }: { rounds: AnalysisRound[] }) {
  const [roundId, setRoundId] = useState(rounds[0]?.analysis.id ?? "");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("spend_desc");

  const round = rounds.find((r) => r.analysis.id === roundId) ?? rounds[0];

  const visible = useMemo(() => {
    if (!round) return [];
    const q = query.trim().toLowerCase();
    const filtered = round.campaigns.filter(
      (c) => !q || snapshotDisplayName(c.snapshot).toLowerCase().includes(q),
    );
    return [...filtered].sort((a, b) => compareSnapshots(sort)(a.snapshot, b.snapshot));
  }, [round, query, sort]);

  if (!round) return null;
  const { analysis } = round;

  return (
    <div className="space-y-4">
      {/* Toolbar: round selector, campaign filter, metric sort */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={round.analysis.id}
          onChange={(e) => setRoundId(e.target.value)}
          className={SELECT_CLASSES}
          aria-label="Rodada de análise"
        >
          {rounds.map((r) => (
            <option key={r.analysis.id} value={r.analysis.id}>
              {r.clientName} · {formatDateTime(r.analysis.created_at)}
            </option>
          ))}
        </select>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filtrar por campanha…"
          className={`${SELECT_CLASSES} min-w-0 flex-1 sm:max-w-xs`}
          aria-label="Filtrar por nome de campanha"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className={SELECT_CLASSES}
          aria-label="Ordenar por métrica"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* Round header: verdict + summary + window */}
      <div className="tech-panel rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${
              VERDICT_STYLES[analysis.overall_verdict] ?? "bg-white/10 text-white/60"
            }`}
          >
            {analysis.overall_verdict}
          </span>
          <span className="text-xs text-white/40">
            {round.clientName} · janela {formatDateOnly(analysis.window_start)} –{" "}
            {formatDateOnly(analysis.window_stop)}
            {analysis.objective ? ` · ${analysis.objective}` : ""} · {analysis.triggered_by}
          </span>
        </div>
        {analysis.summary && <p className="mt-2 text-sm text-white/70">{analysis.summary}</p>}
        <p className="mt-2 text-xs text-white/30">
          Analisado em {formatDateTime(analysis.created_at)}
        </p>
      </div>

      {/* Account-wide findings (not tied to a single campaign) */}
      {round.globalFindings.length > 0 && (
        <ul className="space-y-2">
          {round.globalFindings.map((f) => (
            <li key={f.id} className="tech-panel rounded-lg px-4 py-3">
              <div className="mb-1 flex items-center gap-2">
                <span
                  className={`rounded border border-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${
                    SEVERITY_STYLES[f.severity] ?? "bg-white/10"
                  }`}
                >
                  {f.severity}
                </span>
                <span className="text-xs text-white/40">conta inteira</span>
              </div>
              <p className="text-sm text-white/80">{f.diagnosis}</p>
              {f.recommended_action && (
                <p className="mt-1 text-xs text-white/50">→ {f.recommended_action}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Campaign metrics + AI recommendation */}
      {round.campaigns.length === 0 ? (
        <p className="tech-panel rounded-xl p-4 text-sm text-white/50">
          Esta rodada não tem snapshots de campanha.
        </p>
      ) : (
        <div className="tech-panel overflow-x-auto rounded-xl">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-white/8">
                <th className={HEADER_CELL_CLASSES}>Campanha</th>
                <th className={HEADER_CELL_CLASSES}>Gasto</th>
                <th className={HEADER_CELL_CLASSES}>CTR</th>
                <th className={HEADER_CELL_CLASSES}>CPC</th>
                <th className={HEADER_CELL_CLASSES}>CPLPV</th>
                <th className={HEADER_CELL_CLASSES}>CPM</th>
                <th className={HEADER_CELL_CLASSES}>Impressões</th>
                <th className={HEADER_CELL_CLASSES}>Resultados</th>
                <th className={HEADER_CELL_CLASSES}>Recomendação da IA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-4 text-sm text-white/50">
                    Nenhuma campanha corresponde ao filtro &quot;{query}&quot;.
                  </td>
                </tr>
              ) : (
                visible.map(({ snapshot, finding, extraFindingsCount }) => (
                  <tr key={snapshot.id}>
                    <td className="max-w-[280px] px-3 py-3">
                      <span className="block truncate text-white/90" title={snapshotDisplayName(snapshot)}>
                        {snapshotDisplayName(snapshot)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-white/80">
                      {formatCents(snapshot.spend_cents, round.currency)}
                    </td>
                    <td className="px-3 py-3 text-white/80">{formatPercent(snapshot.ctr)}</td>
                    <td className="px-3 py-3 text-white/80">
                      {formatCents(snapshot.cpc_cents, round.currency)}
                    </td>
                    <td className="px-3 py-3 text-white/80">
                      {formatCents(snapshot.cplpv_cents, round.currency)}
                    </td>
                    <td className="px-3 py-3 text-white/80">
                      {formatCents(snapshot.cpm_cents, round.currency)}
                    </td>
                    <td className="px-3 py-3 text-white/80">
                      {formatNumber(snapshot.impressions)}
                    </td>
                    <td className="px-3 py-3 text-white/80">{formatNumber(snapshot.results)}</td>
                    <td className="max-w-[320px] px-3 py-3">
                      {finding ? (
                        <div title={finding.diagnosis}>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ${
                                SEVERITY_STYLES[finding.severity] ?? "bg-white/10"
                              }`}
                            >
                              {finding.severity}
                            </span>
                            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-cyan-200/70">
                              {RECOMMENDATION_LABELS[finding.recommendation_type] ??
                                finding.recommendation_type}
                            </span>
                            {extraFindingsCount > 0 && (
                              <span className="text-[10px] text-white/35">
                                +{extraFindingsCount}
                              </span>
                            )}
                          </div>
                          {finding.recommended_action && (
                            <p className="mt-1 line-clamp-2 text-xs text-white/55">
                              {finding.recommended_action}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-white/30">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
