"use client";

// SPEC-019 — funnel panel body. Renders the account-level funnel (the data the show_funnel
// render-tool resolved via getLatestFunnel) as a compact holographic readout: a KPI strip
// (ROAS / spend / purchases) over the canonical funnel steps with per-step counts and the
// conversion rate from the previous step. `data` arrives as `unknown` (the transport schema
// carries payloads opaquely), so we narrow defensively and fall back to a notice if the shape
// is unexpected — a bad payload must never crash the stage.
import type { FunnelData, FunnelEntity, FunnelStep } from "@/lib/services/funnel";

const STEP_LABELS: Record<string, string> = {
  impression: "Impressões",
  link_click: "Cliques no link",
  landing_page_view: "Visitas à página",
  view_content: "Viu conteúdo",
  add_to_cart: "Add. ao carrinho",
  initiate_checkout: "Checkout iniciado",
  purchase: "Compras",
};

function isFunnelData(data: unknown): data is FunnelData {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return "campaigns" in d && Array.isArray(d.campaigns) && "currency" in d;
}

function fmtMoney(cents: number | null | undefined, currency: string): string {
  if (cents == null) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)}`;
  }
}

function fmtInt(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("pt-BR").format(n);
}

function fmtPct(ratio: number | null | undefined): string {
  if (ratio == null) return "—";
  return `${(ratio * 100).toFixed(1).replace(".", ",")}%`;
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-hud text-[0.65rem] uppercase tracking-[0.18em] text-cyan-100/45">{label}</div>
      <div className="truncate font-hud text-base text-cyan-50">{value}</div>
    </div>
  );
}

export function FunnelPanel({ data }: { data: unknown }) {
  if (!isFunnelData(data)) {
    return <p className="font-hud text-xs text-cyan-100/60">Sem dados de funil para mostrar.</p>;
  }

  const currency = data.currency || "BRL";
  const entity: FunnelEntity | null = data.account ?? data.campaigns[0] ?? null;
  const steps: FunnelStep[] = entity ? [...entity.steps].sort((a, b) => a.step_order - b.step_order) : [];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3 border-b border-cyan-300/15 pb-3">
        <Kpi label="ROAS" value={entity?.roas != null ? `${entity.roas.toFixed(2).replace(".", ",")}x` : "—"} />
        <Kpi label="Gasto" value={fmtMoney(entity?.spend_cents, currency)} />
        <Kpi label="Compras" value={fmtInt(entity?.purchases)} />
      </div>

      {steps.length === 0 ? (
        <p className="font-hud text-xs text-cyan-100/60">Funil sem passos registrados.</p>
      ) : (
        <ul className="space-y-1.5">
          {steps.map((step) => (
            <li key={step.event_type} className="flex items-center justify-between gap-3">
              <span className="truncate font-hud text-xs text-cyan-100/70">
                {STEP_LABELS[step.event_type] ?? step.event_type}
              </span>
              <span className="flex shrink-0 items-baseline gap-2 font-hud">
                <span className="text-sm text-cyan-50">{fmtInt(step.count)}</span>
                <span className="w-12 text-right text-[0.65rem] text-cyan-100/40">{fmtPct(step.cvr_from_prev)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="truncate pt-1 font-hud text-[0.65rem] uppercase tracking-[0.16em] text-cyan-100/35">
        {data.clientName}
      </div>
    </div>
  );
}
