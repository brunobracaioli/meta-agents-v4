export function formatCents(cents: number | null | undefined, currency = "BRL"): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));
}

export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (value == null) return "—";
  return `${value.toFixed(digits)}%`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("pt-BR").format(value);
}

export function formatRatio(value: number | null | undefined, digits = 2): string {
  if (value == null) return "—";
  return value.toFixed(digits);
}

// Verdict / severity → tailwind chip classes, shared by dashboard views.
export const VERDICT_STYLES: Record<string, string> = {
  healthy: "border-emerald-300/25 bg-emerald-400/10 text-emerald-200",
  watch: "border-amber-300/25 bg-amber-400/10 text-amber-200",
  underperforming: "border-red-300/25 bg-red-500/10 text-red-200",
  learning: "border-cyan-300/25 bg-cyan-400/10 text-cyan-200",
  no_data: "border-white/10 bg-white/5 text-white/50",
  error: "border-red-300/30 bg-red-500/15 text-red-200",
};

export const SEVERITY_STYLES: Record<string, string> = {
  info: "border-white/10 bg-white/5 text-white/60",
  low: "border-cyan-300/25 bg-cyan-400/10 text-cyan-200",
  medium: "border-amber-300/25 bg-amber-400/10 text-amber-200",
  high: "border-orange-300/25 bg-orange-400/10 text-orange-200",
  critical: "border-red-300/30 bg-red-500/15 text-red-200",
};
