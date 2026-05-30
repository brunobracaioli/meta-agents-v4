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
  healthy: "bg-green-500/15 text-green-300",
  watch: "bg-yellow-500/15 text-yellow-300",
  underperforming: "bg-red-500/15 text-red-300",
  learning: "bg-blue-500/15 text-blue-300",
  no_data: "bg-white/10 text-white/50",
  error: "bg-red-500/20 text-red-200",
};

export const SEVERITY_STYLES: Record<string, string> = {
  info: "bg-white/10 text-white/60",
  low: "bg-blue-500/15 text-blue-300",
  medium: "bg-yellow-500/15 text-yellow-300",
  high: "bg-orange-500/15 text-orange-300",
  critical: "bg-red-500/20 text-red-200",
};
