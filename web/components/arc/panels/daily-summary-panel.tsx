"use client";

// SPEC-019 — daily-summary panel body. Renders the AI-written daily summaries the
// show_daily_summary render-tool resolved (one block per day, newest first). `data` arrives
// as `unknown`; we narrow defensively and fall back to a notice for an unexpected shape.

type SummaryRow = { summary_date: string; summary: string | null };
type SummaryData = { client_name?: string; summaries: SummaryRow[] };

function isSummaryData(data: unknown): data is SummaryData {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return Array.isArray(d.summaries);
}

function isRow(row: unknown): row is SummaryRow {
  return !!row && typeof row === "object" && typeof (row as Record<string, unknown>).summary_date === "string";
}

function fmtDate(iso: string): string {
  // summary_date is YYYY-MM-DD; render as DD/MM without timezone surprises.
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}` : iso;
}

export function DailySummaryPanel({ data }: { data: unknown }) {
  if (!isSummaryData(data)) {
    return <p className="font-hud text-xs text-cyan-100/60">Sem resumo do dia para mostrar.</p>;
  }

  const rows = data.summaries.filter(isRow);
  if (rows.length === 0) {
    return <p className="font-hud text-xs text-cyan-100/60">Nenhum resumo diário registrado.</p>;
  }

  return (
    <div className="max-h-72 space-y-3 overflow-auto">
      {rows.map((row) => (
        <div key={row.summary_date} className="space-y-1 border-b border-cyan-300/10 pb-2 last:border-0">
          <div className="font-hud text-[0.65rem] uppercase tracking-[0.18em] text-cyan-100/45">
            {fmtDate(row.summary_date)}
          </div>
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-cyan-50/85">
            {row.summary?.trim() || "Sem texto de resumo."}
          </p>
        </div>
      ))}
      {data.client_name ? (
        <div className="truncate pt-1 font-hud text-[0.65rem] uppercase tracking-[0.16em] text-cyan-100/35">
          {data.client_name}
        </div>
      ) : null}
    </div>
  );
}
