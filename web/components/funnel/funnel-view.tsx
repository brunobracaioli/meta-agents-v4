"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FunnelClientOption, FunnelData, FunnelEntity } from "@/lib/services/funnel";
import { HudPanel } from "@/components/live/hud/hud-panel";
import { useAnimatedNumber } from "@/components/live/hud/animated-counter";
import { formatCents, formatNumber, formatPercent, formatRatio, VERDICT_STYLES } from "@/lib/format";

// ---------------------------------------------------------------------------
// Event vocabulary + small visual helpers
// ---------------------------------------------------------------------------
const STEP_META: Record<string, { label: string; tag: string }> = {
  impression: { label: "Impressões", tag: "IMPR" },
  link_click: { label: "Cliques no link", tag: "LINK" },
  landing_page_view: { label: "View da página", tag: "LPV" },
  view_content: { label: "View content", tag: "VC" },
  add_to_cart: { label: "Adicionou ao carrinho", tag: "ATC" },
  initiate_checkout: { label: "Iniciou checkout", tag: "IC" },
  purchase: { label: "Compra", tag: "BUY" },
};

// Funnel silhouette: the bar width tapers monotonically from the top stage
// (widest) down to the last stage (narrowest), so it always reads as a funnel
// even when the real drop-off is extreme (e.g. 45k impressions → 22 purchases).
// Each width blends the stage's rank — which guarantees the taper — with a light
// perceptual nudge for its real magnitude; the exact figures live in the labels.
const FUNNEL_MAX_WIDTH = 100;
const FUNNEL_MIN_WIDTH = 46;
const FUNNEL_RANK_WEIGHT = 0.7;

function computeFunnelWidths(counts: number[]): number[] {
  const n = counts.length;
  if (n === 0) return [];
  const top = counts[0] ?? 0;
  let prev = FUNNEL_MAX_WIDTH;
  return counts.map((count, i) => {
    const rank = n > 1 ? 1 - i / (n - 1) : 1; // 1 at the top stage → 0 at the last
    const prop = top > 0 ? Math.pow(Math.max(count, 0) / top, 0.34) : 0; // [0,1]
    const blend = FUNNEL_RANK_WEIGHT * rank + (1 - FUNNEL_RANK_WEIGHT) * prop;
    // Clamp to the stage above so the silhouette never widens going down.
    const width = Math.min(prev, FUNNEL_MIN_WIDTH + (FUNNEL_MAX_WIDTH - FUNNEL_MIN_WIDTH) * blend);
    prev = width;
    return width;
  });
}

function roasTone(roas: number | null): string {
  if (roas == null) return "text-white/40";
  if (roas >= 2) return "text-emerald-300";
  if (roas >= 1) return "text-amber-300";
  return "text-red-300";
}

function cvrTone(pct: number, isLeak: boolean): string {
  if (isLeak) return "text-orange-300";
  if (pct >= 66) return "text-emerald-300";
  if (pct >= 33) return "text-cyan-200";
  return "text-amber-300";
}

function entityKey(e: FunnelEntity): string {
  return `${e.level}:${e.meta_entity_id}`;
}

// ---------------------------------------------------------------------------
// Animated number primitives (roll on value change — incl. when you switch entity)
// ---------------------------------------------------------------------------
function AnimatedMoney({ cents, currency }: { cents: number | null; currency: string }) {
  const v = useAnimatedNumber(cents ?? 0);
  return <>{cents == null ? "—" : formatCents(v, currency)}</>;
}
function AnimatedInt({ value }: { value: number }) {
  return <>{formatNumber(useAnimatedNumber(value))}</>;
}

// ---------------------------------------------------------------------------
// KPI strip
// ---------------------------------------------------------------------------
function Kpi({
  label,
  children,
  tone = "text-white",
}: {
  label: string;
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="hud-chip hud-clip-sm px-3 py-2.5">
      <p className="font-hud text-[9px] uppercase tracking-[0.22em] text-cyan-100/50">{label}</p>
      <p className={`mt-1 font-hud text-lg leading-none tabular-nums ${tone}`}>{children}</p>
    </div>
  );
}

function KpiStrip({ e, currency }: { e: FunnelEntity; currency: string }) {
  const cpa = e.steps.find((s) => s.event_type === "purchase")?.cost_per_event_cents ?? null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <Kpi label="Investimento">
        <AnimatedMoney cents={e.spend_cents} currency={currency} />
      </Kpi>
      <Kpi label="Receita" tone="text-emerald-200">
        <AnimatedMoney cents={e.revenue_cents} currency={currency} />
      </Kpi>
      <Kpi label="ROAS" tone={roasTone(e.roas)}>
        {e.roas == null ? "—" : `${formatRatio(e.roas)}×`}
      </Kpi>
      <Kpi label="CPA" tone={cpa != null && cpa > 0 ? "text-white" : "text-white/40"}>
        <AnimatedMoney cents={cpa} currency={currency} />
      </Kpi>
      <Kpi label="Compras" tone="text-orange-200">
        <AnimatedInt value={e.purchases} />
      </Kpi>
      <Kpi label="Impressões">
        <AnimatedInt value={e.impressions} />
      </Kpi>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The funnel itself
// ---------------------------------------------------------------------------
function FunnelChart({ e, currency }: { e: FunnelEntity; currency: string }) {
  const widths = useMemo(() => computeFunnelWidths(e.steps.map((s) => s.count)), [e.steps]);

  // Worst conversion between consecutive stages = the leak (only flag real drops).
  const leakIndex = useMemo(() => {
    let idx = -1;
    let worst = Infinity;
    e.steps.forEach((s, i) => {
      if (i === 0) return;
      const cvr = s.cvr_from_prev;
      if (cvr == null || s.count === 0) return;
      if (cvr < worst) {
        worst = cvr;
        idx = i;
      }
    });
    // Only call it a leak if it actually loses a meaningful share.
    return worst < 0.5 ? idx : -1;
  }, [e.steps]);

  return (
    <div className="space-y-0">
      {e.steps.map((s, i) => {
        const meta = STEP_META[s.event_type] ?? { label: s.event_type, tag: "" };
        const width = widths[i] ?? FUNNEL_MIN_WIDTH;
        const isPurchase = s.event_type === "purchase";
        const isLeak = i === leakIndex;
        const cvrPct = s.cvr_from_prev != null ? s.cvr_from_prev * 100 : null;
        const topPct = s.cvr_from_top != null ? s.cvr_from_top * 100 : i === 0 ? 100 : null;

        return (
          <div key={s.event_type}>
            {/* connector: conversion from previous stage */}
            {i > 0 && (
              <div className="flex items-center justify-center gap-2 py-1.5">
                <span className="h-3 w-px bg-gradient-to-b from-cyan-300/40 to-transparent" />
                <span
                  className={`font-hud text-[11px] tabular-nums ${cvrTone(cvrPct ?? 0, isLeak)}`}
                >
                  ▼ {cvrPct == null ? "—" : formatPercent(cvrPct, 1)}
                </span>
                {isLeak && (
                  <span className="hud-chip animate-pulse rounded-sm border-orange-300/40 px-1.5 py-0.5 font-hud text-[9px] uppercase tracking-[0.18em] text-orange-200">
                    ◉ vazamento
                  </span>
                )}
              </div>
            )}

            {/* stage bar (centered → funnel silhouette) */}
            <div className="flex justify-center">
              <div
                className="relative transition-[width] duration-700 ease-out"
                style={{ width: `${width}%` }}
              >
                <div
                  className={`hud-clip-sm relative overflow-hidden border px-3 py-2 ${
                    isPurchase
                      ? "border-orange-300/40 bg-gradient-to-r from-orange-500/20 via-orange-400/10 to-orange-500/15 shadow-[0_0_28px_rgba(251,146,60,0.18)]"
                      : isLeak
                        ? "border-orange-300/30 bg-gradient-to-r from-cyan-500/10 via-cyan-400/5 to-cyan-500/10"
                        : "border-cyan-300/25 bg-gradient-to-r from-cyan-500/15 via-cyan-400/7 to-cyan-500/12 shadow-[0_0_22px_rgba(103,232,249,0.10)]"
                  }`}
                >
                  <div className="hud-scanlines pointer-events-none absolute inset-0" aria-hidden />
                  <div className="relative flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={`shrink-0 border px-1.5 py-0.5 font-hud text-[9px] tabular-nums ${
                          isPurchase
                            ? "border-orange-300/40 bg-orange-400/10 text-orange-200"
                            : "border-cyan-300/30 bg-cyan-400/10 text-cyan-200/90"
                        }`}
                      >
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="truncate font-hud text-[11px] uppercase tracking-[0.16em] text-white/80">
                        {meta.label}
                      </span>
                    </div>
                    <span
                      className={`shrink-0 font-hud text-base tabular-nums ${
                        isPurchase ? "text-orange-100" : "text-white"
                      }`}
                    >
                      <AnimatedInt value={s.count} />
                    </span>
                  </div>
                </div>

                {/* sub-line: cost per event + share of top */}
                <div className="mt-0.5 flex items-center justify-between px-1 font-hud text-[9px] tabular-nums text-white/35">
                  <span>
                    {isPurchase && s.value_cents != null
                      ? `${formatCents(s.value_cents, currency)} receita`
                      : s.cost_per_event_cents != null
                        ? `${formatCents(s.cost_per_event_cents, currency)} / evento`
                        : ""}
                  </span>
                  <span>{topPct == null ? "" : `${formatPercent(topPct, topPct < 1 ? 2 : 1)} do topo`}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Campaign rail (selectable)
// ---------------------------------------------------------------------------
function RailItem({
  name,
  spend,
  roas,
  purchases,
  currency,
  active,
  onClick,
}: {
  name: string;
  spend: number | null;
  roas: number | null;
  purchases: number;
  currency: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`hud-clip-sm w-full border px-3 py-2 text-left transition ${
        active
          ? "border-cyan-300/50 bg-cyan-400/10 shadow-[0_0_18px_rgba(103,232,249,0.12)]"
          : "border-white/10 bg-white/[0.02] hover:border-cyan-200/30 hover:bg-white/[0.04]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-hud text-[11px] uppercase tracking-[0.08em] text-white/85">
          {name}
        </span>
        <span className={`shrink-0 font-hud text-xs tabular-nums ${roasTone(roas)}`}>
          {roas == null ? "—" : `${formatRatio(roas)}×`}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between font-hud text-[9px] tabular-nums text-white/40">
        <span>{formatCents(spend, currency)}</span>
        <span className="text-orange-200/70">{purchases} compra{purchases === 1 ? "" : "s"}</span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Client / account selectors (drive ?client=&account= → server refetch)
// ---------------------------------------------------------------------------
const SELECT_CLASSES =
  "hud-clip-sm border border-cyan-300/25 bg-[#0a0f1f] px-3 py-2 font-hud text-[11px] uppercase tracking-[0.1em] text-white/85 outline-none transition focus:border-cyan-200/50 disabled:opacity-50";

function FunnelSelectors({
  clients,
  selectedClientId,
  selectedAccountId,
}: {
  clients: FunnelClientOption[];
  selectedClientId: string;
  selectedAccountId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const current = clients.find((c) => c.clientId === selectedClientId) ?? clients[0];

  function go(clientId: string, accountId: string) {
    startTransition(() => {
      router.push(
        `/dashboard/funnel?client=${encodeURIComponent(clientId)}&account=${encodeURIComponent(accountId)}`,
      );
    });
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 transition-opacity ${pending ? "opacity-50" : ""}`}>
      <span className="font-hud text-[9px] uppercase tracking-[0.2em] text-cyan-100/40">Cliente</span>
      <select
        aria-label="Cliente"
        className={SELECT_CLASSES}
        value={selectedClientId}
        disabled={pending || clients.length <= 1}
        onChange={(e) => {
          const c = clients.find((x) => x.clientId === e.target.value);
          go(e.target.value, c?.accounts[0]?.accountId ?? "");
        }}
      >
        {clients.map((c) => (
          <option key={c.clientId} value={c.clientId}>
            {c.name}
          </option>
        ))}
      </select>
      <span className="font-hud text-[9px] uppercase tracking-[0.2em] text-cyan-100/40">Conta</span>
      <select
        aria-label="Conta de anúncios"
        className={SELECT_CLASSES}
        value={selectedAccountId}
        disabled={pending || (current?.accounts.length ?? 0) <= 1}
        onChange={(e) => go(selectedClientId, e.target.value)}
      >
        {current?.accounts.map((a) => (
          <option key={a.accountId} value={a.accountId}>
            {a.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-level view
// ---------------------------------------------------------------------------
export function FunnelView({
  data,
  clients,
  selectedClientId,
  selectedAccountId,
}: {
  data: FunnelData;
  clients: FunnelClientOption[];
  selectedClientId: string;
  selectedAccountId: string;
}) {
  const { analysis, account, campaigns, currency, clientName } = data;

  const entities = useMemo(
    () => (account ? [account, ...campaigns] : campaigns),
    [account, campaigns],
  );
  const [selectedKey, setSelectedKey] = useState(
    account ? entityKey(account) : entities[0] ? entityKey(entities[0]) : "",
  );
  const selected = entities.find((e) => entityKey(e) === selectedKey) ?? entities[0];

  if (!selected) {
    return <p className="text-sm text-white/50">Sem dados de funil para exibir.</p>;
  }

  const verdict = analysis.overall_verdict;
  const window =
    analysis.window_start && analysis.window_stop
      ? `${fmtDate(analysis.window_start)} – ${fmtDate(analysis.window_stop)}`
      : "—";
  const isAccount = selected.level === "account";

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-hud text-2xl uppercase tracking-[0.12em] text-white">
            Funil de conversão
          </h1>
          <p className="mt-1 font-hud text-[11px] uppercase tracking-[0.16em] text-cyan-100/45">
            {clientName} · janela {window} · {entities.length} entidade
            {entities.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <FunnelSelectors
            clients={clients}
            selectedClientId={selectedClientId}
            selectedAccountId={selectedAccountId}
          />
          <span
            className={`hud-clip-sm border px-2.5 py-1 font-hud text-[10px] uppercase tracking-[0.18em] ${
              VERDICT_STYLES[verdict] ?? VERDICT_STYLES.no_data
            }`}
          >
            {verdict}
          </span>
        </div>
      </div>

      <KpiStrip e={selected} currency={currency} />

      <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
        <HudPanel
          index="01"
          title={isAccount ? "Funil — conta (todas as campanhas)" : `Funil — ${selected.entity_name ?? "campanha"}`}
          className="hud-scan-host"
          actions={
            <span className="font-hud text-[10px] uppercase tracking-[0.18em] text-cyan-100/45">
              {selected.objective ?? "—"}
            </span>
          }
        >
          <FunnelChart e={selected} currency={currency} />
        </HudPanel>

        <HudPanel index="02" title="Entidades · ordenadas por investimento">
          <div className="max-h-[520px] space-y-1.5 overflow-y-auto pr-1">
            {account && (
              <RailItem
                name="◆ Conta (todas)"
                spend={account.spend_cents}
                roas={account.roas}
                purchases={account.purchases}
                currency={currency}
                active={entityKey(account) === selectedKey}
                onClick={() => setSelectedKey(entityKey(account))}
              />
            )}
            {campaigns.map((c) => (
              <RailItem
                key={entityKey(c)}
                name={c.entity_name ?? c.meta_entity_id}
                spend={c.spend_cents}
                roas={c.roas}
                purchases={c.purchases}
                currency={currency}
                active={entityKey(c) === selectedKey}
                onClick={() => setSelectedKey(entityKey(c))}
              />
            ))}
          </div>
        </HudPanel>
      </div>

      {analysis.summary && (
        <p className="font-hud text-[11px] leading-relaxed text-white/45">{analysis.summary}</p>
      )}
    </div>
  );
}

function fmtDate(date: string): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(
    new Date(date),
  );
}
